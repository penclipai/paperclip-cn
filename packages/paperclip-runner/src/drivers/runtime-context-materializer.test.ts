import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  NATIVE_RUNTIME_ASSET_SCHEMA,
  PAPERCLIP_EXECUTION_PROMPT,
  PAPERCLIP_EXECUTION_PROMPT_REVISION,
  canonicalNativeRuntimeContextDigest,
  nativeRuntimePromptDigest,
  parseNativeRuntimeContext,
  type NativeRuntimeContextSnapshot,
} from "../contracts/runtime-context.js";
import { nativeMcpLaunchBinding } from "./native-mcp.js";
import {
  assertNativeRuntimeSkillSealingSupported,
  materializeNativeRuntimeSkills,
  preflightIsolatedCodexHome,
  prepareIsolatedCodexHome,
  releaseMaterializedNativeRuntimeSkills,
} from "./runtime-context-materializer.js";

const roots: string[] = [];
const execFileAsync = promisify(execFile);
const WINDOWS_POWERSHELL_PATH = join(
  process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);

async function windowsPrivateAcl(path: string): Promise<{
  owner: string;
  protected: boolean;
  readers: string[];
  ruleCount: number;
  fullControl: boolean;
  current: string;
}> {
  const script = String.raw`
$path = $env:PAPERCLIP_RUNTIME_TEST_ACL_PATH
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$sections = [System.Security.AccessControl.AccessControlSections]::Access -bor [System.Security.AccessControl.AccessControlSections]::Owner
$item = Get-Item -LiteralPath $path -Force
$acl = if ($item.PSIsContainer) { [System.IO.Directory]::GetAccessControl($path, $sections) } else { [System.IO.File]::GetAccessControl($path, $sections) }
$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
$readers = @($rules | Where-Object { $_.AccessControlType -eq 'Allow' -and ($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::ReadData) -ne 0 } | ForEach-Object { $_.IdentityReference.Value })
$fullControl = $rules.Count -eq 1 -and $rules[0].AccessControlType -eq 'Allow' -and (($rules[0].FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl)
@{ owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; protected = $acl.AreAccessRulesProtected; readers = $readers; ruleCount = $rules.Count; fullControl = $fullControl; current = $sid } | ConvertTo-Json -Compress
`;
  const { stdout } = await execFileAsync(WINDOWS_POWERSHELL_PATH, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script,
  ], {
    env: { ...process.env, PAPERCLIP_RUNTIME_TEST_ACL_PATH: path },
    windowsHide: true,
  });
  return JSON.parse(stdout) as {
    owner: string;
    protected: boolean;
    readers: string[];
    ruleCount: number;
    fullControl: boolean;
    current: string;
  };
}

async function makeWritable(root: string): Promise<void> {
  const info = await lstat(root).catch(() => null);
  if (!info || info.isSymbolicLink()) return;
  if (info.isDirectory()) {
    await chmod(root, 0o700);
    for (const entry of await readdir(root)) {
      await makeWritable(join(root, entry));
    }
  } else {
    await chmod(root, 0o600);
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => {
    await makeWritable(root);
    await rm(root, { recursive: true, force: true });
  }));
});

function context(
  skillRoot: string,
  instructionRoot: string,
  runtimeName = "assigned",
): NativeRuntimeContextSnapshot {
  const digest = "0".repeat(64);
  const value = {
    prompt: {
      revision: PAPERCLIP_EXECUTION_PROMPT_REVISION,
      text: PAPERCLIP_EXECUTION_PROMPT,
      digest: nativeRuntimePromptDigest(),
    },
    instructions: {
      entryPath: "AGENTS.md",
      bundle: {
        schema: NATIVE_RUNTIME_ASSET_SCHEMA,
        digest,
        manifestDigest: digest,
        rootPath: instructionRoot,
        fileCount: 2,
        totalBytes: 2,
      },
    },
    skills: [{
      key: `company/${runtimeName}`,
      runtimeName,
      versionId: "version-1",
      bundle: {
        schema: NATIVE_RUNTIME_ASSET_SCHEMA,
        digest,
        manifestDigest: digest,
        rootPath: skillRoot,
        fileCount: 2,
        totalBytes: 2,
      },
    }],
    mcp: { assignmentSetId: runtimeName, digest, bindingId: "binding" },
  } satisfies Omit<NativeRuntimeContextSnapshot, "aggregateDigest">;
  return { ...value, aggregateDigest: canonicalNativeRuntimeContextDigest(value) };
}

describe("runtime context materialization", () => {
  it("allows empty runtime contexts on every supported platform", () => {
    expect(() => assertNativeRuntimeSkillSealingSupported(null)).not.toThrow();
    const empty = context("/skills", "/instructions");
    empty.skills = [];
    empty.aggregateDigest = canonicalNativeRuntimeContextDigest(empty);
    expect(() => assertNativeRuntimeSkillSealingSupported(empty)).not.toThrow();
  });

  (process.platform === "win32" ? it : it.skip)(
    "refuses Windows assigned skills before creating an isolated home",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "paperclip-runtime-win32-"));
      roots.push(root);
      const assigned = join(root, "assigned-source");
      const instructions = join(root, "instructions-source");
      const codexHome = join(root, "codex-home");
      await Promise.all([mkdir(assigned), mkdir(instructions)]);
      await writeFile(join(assigned, "SKILL.md"), "# Assigned\\n");
      await writeFile(join(instructions, "AGENTS.md"), "Instructions\\n");
      const sourceBytes = await readFile(join(assigned, "SKILL.md"));

      await expect(prepareIsolatedCodexHome({
        context: context(assigned, instructions),
        codexHome,
      })).rejects.toThrow("native_runtime_context_unsupported");

      expect(await readFile(join(assigned, "SKILL.md"))).toEqual(sourceBytes);
      await expect(lstat(codexHome)).rejects.toThrow();
      expect(
        (await readdir(root)).filter((entry) =>
          entry.startsWith(".paperclip-skills-staging-"),
        ),
      ).toEqual([]);
    },
  );

  (process.platform === "win32" ? it : it.skip)(
    "releases only an empty Windows skills home without recursive cleanup",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "paperclip-runtime-win32-release-"));
      roots.push(root);
      const empty = join(root, "empty", "skills");
      const retained = join(root, "retained", "skills");
      await materializeNativeRuntimeSkills(null, empty);
      await releaseMaterializedNativeRuntimeSkills(empty);
      await expect(lstat(empty)).rejects.toThrow();

      await mkdir(join(retained, "legacy"), { recursive: true });
      await writeFile(join(retained, "legacy", "SKILL.md"), "# Retained\\n");
      const retainedBytes = await readFile(join(retained, "legacy", "SKILL.md"));
      await expect(
        releaseMaterializedNativeRuntimeSkills(retained),
      ).rejects.toThrow("native_runtime_context_unsupported");
      expect(await readFile(join(retained, "legacy", "SKILL.md"))).toEqual(
        retainedBytes,
      );

      const external = join(root, "external");
      const reparse = join(root, "reparse", "skills");
      await mkdir(external);
      await writeFile(join(external, "sentinel.txt"), "must-not-remove\n");
      await mkdir(dirname(reparse), { recursive: true });
      await symlink(external, reparse, "junction");
      await expect(
        releaseMaterializedNativeRuntimeSkills(reparse),
      ).rejects.toThrow("native_runtime_context_unsupported");
      await expect(readFile(join(external, "sentinel.txt"), "utf8")).resolves.toBe(
        "must-not-remove\n",
      );
    },
  );

  it("restores the legacy working-copy contract without changing its digest or adding new fields", () => {
    const old = context("/skills", "/instructions");
    old.instructions.workingCopy = { rootPath: "/old-run/copy", entryPath: "AGENTS.md" };
    old.aggregateDigest = canonicalNativeRuntimeContextDigest(old);
    expect(parseNativeRuntimeContext(JSON.parse(JSON.stringify(old)))).toEqual(old);
    expect(parseNativeRuntimeContext(old).instructions.workingCopy).not.toHaveProperty("kind");
    const next = { ...old, instructions: { ...old.instructions, workingCopy: { ...old.instructions.workingCopy, kind: "agent_files" as const } } };
    next.aggregateDigest = canonicalNativeRuntimeContextDigest(next);
    expect(parseNativeRuntimeContext(next).instructions.workingCopy?.kind).toBe("agent_files");
  });

  it("validates native MCP launch bindings before they reach Codex", () => {
    expect(nativeMcpLaunchBinding({})).toBeNull();
    expect(() => nativeMcpLaunchBinding({
      PAPERCLIP_NATIVE_MCP_NAME: "paperclip",
      PAPERCLIP_NATIVE_MCP_URL: "http://paperclip.example/mcp",
      PAPERCLIP_NATIVE_MCP_TOKEN: "x".repeat(40),
    })).toThrow("requires HTTPS or loopback HTTP");
    expect(() => nativeMcpLaunchBinding({
      PAPERCLIP_NATIVE_MCP_NAME: "paperclip",
      PAPERCLIP_NATIVE_MCP_URL: "https://user:pass@paperclip.example/mcp#secret",
      PAPERCLIP_NATIVE_MCP_TOKEN: "x".repeat(40),
    })).toThrow("contains forbidden URL data");
  });

  (process.platform === "win32" ? it.skip : it)("copies only assigned skills and writes an isolated MCP config", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperclip-runtime-context-"));
    roots.push(root);
    const assigned = join(root, "assigned-source");
    const instructions = join(root, "instructions-source");
    const hostSkills = join(root, "host-home", "skills", "unassigned");
    const codexHome = join(root, "codex-home");
    await Promise.all([
      mkdir(join(assigned, "references"), { recursive: true }),
      mkdir(instructions),
      mkdir(hostSkills, { recursive: true }),
    ]);
    await writeFile(join(assigned, "SKILL.md"), "# Assigned\n");
    await writeFile(
      join(assigned, "references", "support.md"),
      "support\n",
    );
    await writeFile(join(instructions, "AGENTS.md"), "Instructions\n");
    await writeFile(join(hostSkills, "SKILL.md"), "# Must not leak\n");

    await prepareIsolatedCodexHome({
      context: context(assigned, instructions),
      codexHome,
      sourceCodexHome: join(root, "host-home"),
      nativeMcp: nativeMcpLaunchBinding({
        PAPERCLIP_NATIVE_MCP_NAME: "paperclip-assigned",
        PAPERCLIP_NATIVE_MCP_URL: "https://paperclip.example/mcp",
        PAPERCLIP_NATIVE_MCP_TOKEN: "x".repeat(40),
      }),
    });

    await expect(readFile(
      join(codexHome, "skills", "assigned", "references", "support.md"),
      "utf8",
    )).resolves.toBe("support\n");
    await expect(stat(join(codexHome, "skills", "unassigned"))).rejects.toThrow();
    expect(
      (await stat(join(codexHome, "skills", "assigned", "SKILL.md"))).mode
      & 0o222,
    ).toBe(0);
    const config = await readFile(join(codexHome, "config.toml"), "utf8");
    expect(config).toContain("shell_snapshot = false");
    expect(config).toContain("paperclip-assigned");
    expect(config).toContain('default_tools_approval_mode = "approve"');
    expect(config).toContain("Bearer ");
    expect(config).not.toContain("unassigned");
  });

  it("preserves a managed provider while excluding ambient auth, hooks, and tool configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperclip-routing-home-"));
    roots.push(root);
    const source = join(root, "source");
    const target = join(root, "isolated");
    await mkdir(source);
    await writeFile(join(source, "auth.json"), '{"OPENAI_API_KEY":"unrelated-key"}');
    await writeFile(join(source, "config.toml"), `model_provider = "paperclip"
[model_providers.paperclip]
name = "Selected connection"
base_url = "https://openrouter.ai/api/v1"
wire_api = "responses"
requires_openai_auth = false
env_key = "PAPERCLIP_AI_PROVIDER_KEY"
[features]
shell_snapshot = true
[mcp_servers.unassigned]
command = "untrusted-command"
`);
    await prepareIsolatedCodexHome({ context: null, codexHome: target, sourceCodexHome: source, apiKey: "also-unrelated" });
    const config = await readFile(join(target, "config.toml"), "utf8");
    expect(config).toContain('model_provider = "paperclip"');
    expect(config).toContain('base_url = "https://openrouter.ai/api/v1"');
    expect(config).toContain('env_key = "PAPERCLIP_AI_PROVIDER_KEY"');
    expect(config).toContain("shell_snapshot = false");
    expect(config).not.toMatch(/unrelated|untrusted|unassigned/);
    await expect(stat(join(target, "auth.json"))).rejects.toThrow();
  });

  (process.platform === "win32" ? it.skip : it)("rejects repeated assignments without changing the current assignment", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperclip-runtime-repeat-"));
    roots.push(root);
    const assigned = join(root, "assigned-source");
    const replacement = join(root, "replacement-source");
    const instructions = join(root, "instructions-source");
    const codexHome = join(root, "codex-home");
    await Promise.all([mkdir(assigned), mkdir(replacement), mkdir(instructions)]);
    await writeFile(join(assigned, "SKILL.md"), "# Assigned\n");
    await writeFile(join(replacement, "SKILL.md"), "# Replacement\n");
    await writeFile(join(instructions, "AGENTS.md"), "Instructions\n");

    await prepareIsolatedCodexHome({
      context: context(assigned, instructions),
      codexHome,
    });
    await expect(prepareIsolatedCodexHome({
      context: context(replacement, instructions, "replacement"),
      codexHome,
    })).rejects.toThrow("skills home must be a fresh destination");
    await expect(prepareIsolatedCodexHome({
      context: null,
      codexHome,
    })).rejects.toThrow("skills home must be a fresh destination");

    await expect(readFile(
      join(codexHome, "skills", "assigned", "SKILL.md"),
      "utf8",
    )).resolves.toBe("# Assigned\n");
    await expect(stat(join(codexHome, "skills", "replacement"))).rejects
      .toThrow();
  });

  it("rejects source symlinks before Windows capability admission", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperclip-runtime-symlink-"));
    roots.push(root);
    const assigned = join(root, "assigned-source");
    const unsafe = join(root, "unsafe-source");
    const instructions = join(root, "instructions-source");
    const external = join(root, "external.txt");
    const codexHome = join(root, "codex-home");
    await Promise.all([mkdir(assigned), mkdir(unsafe), mkdir(instructions)]);
    await writeFile(join(assigned, "SKILL.md"), "# Assigned\n");
    await writeFile(join(instructions, "AGENTS.md"), "Instructions\n");
    await writeFile(external, "secret\n");
    await symlink(external, join(unsafe, "SKILL.md"));

    if (process.platform !== "win32") {
      await prepareIsolatedCodexHome({
        context: context(assigned, instructions),
        codexHome,
      });
    }
    await expect(prepareIsolatedCodexHome({
      context: context(unsafe, instructions, "unsafe"),
      codexHome,
    })).rejects.toThrow("runtime context asset contains a symlink");
    if (process.platform === "win32") {
      await expect(lstat(codexHome)).rejects.toThrow();
    } else {
      await expect(readFile(
        join(codexHome, "skills", "assigned", "SKILL.md"),
        "utf8",
      )).resolves.toBe("# Assigned\n");
    }
  });

  it("rejects overlapping portable names before Windows capability admission", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperclip-runtime-atomic-"));
    roots.push(root);
    const assigned = join(root, "assigned-source");
    const replacement = join(root, "replacement-source");
    const instructions = join(root, "instructions-source");
    const codexHome = join(root, "codex-home");
    await Promise.all([mkdir(assigned), mkdir(replacement), mkdir(instructions)]);
    await writeFile(join(assigned, "SKILL.md"), "# Assigned\n");
    await writeFile(join(replacement, "SKILL.md"), "# Replacement\n");
    await writeFile(join(instructions, "AGENTS.md"), "Instructions\n");

    if (process.platform !== "win32") {
      await prepareIsolatedCodexHome({
        context: context(assigned, instructions),
        codexHome,
      });
    }
    const replacementContext = context(replacement, instructions, "group/child");
    for (const runtimeName of ["group", "GROUP", "group.", "group "]) {
      const collidingSkill = {
        ...replacementContext.skills[0]!,
        key: `company/${runtimeName}`,
        runtimeName,
      };
      for (const skills of [
        [...replacementContext.skills, collidingSkill],
        [collidingSkill, ...replacementContext.skills],
      ]) {
        const value = { ...replacementContext, skills };
        const collidingContext = {
          ...value,
          aggregateDigest: canonicalNativeRuntimeContextDigest(value),
        };

        await expect(prepareIsolatedCodexHome({
          context: collidingContext,
          codexHome,
        })).rejects.toThrow("skill names must not overlap");
        if (process.platform === "win32") {
          await expect(lstat(codexHome)).rejects.toThrow();
        } else {
          await expect(readFile(
            join(codexHome, "skills", "assigned", "SKILL.md"),
            "utf8",
          )).resolves.toBe("# Assigned\n");
          await expect(stat(join(codexHome, "skills", "group"))).rejects.toThrow();
        }
      }
    }

    const win32AliasedChild = {
      ...replacementContext.skills[0]!,
      key: "company/group-dot-child",
      runtimeName: "group./child",
    };
    const value = {
      ...replacementContext,
      skills: [...replacementContext.skills, win32AliasedChild],
    };
    await expect(prepareIsolatedCodexHome({
      context: {
        ...value,
        aggregateDigest: canonicalNativeRuntimeContextDigest(value),
      },
      codexHome,
    })).rejects.toThrow("skill names must not overlap");
  });

  (process.platform === "win32" ? it.skip : it)("rejects an existing destination before filesystem mutation", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperclip-runtime-existing-"));
    roots.push(root);
    const assigned = join(root, "assigned-source");
    const replacement = join(root, "replacement-source");
    const instructions = join(root, "instructions-source");
    const skillsHome = join(root, "codex-home", "skills");
    await Promise.all([
      mkdir(assigned),
      mkdir(replacement),
      mkdir(instructions),
    ]);
    await writeFile(join(assigned, "SKILL.md"), "# Assigned\n");
    await writeFile(join(replacement, "SKILL.md"), "# Replacement\n");
    await writeFile(join(instructions, "AGENTS.md"), "Instructions\n");

    await materializeNativeRuntimeSkills(
      context(assigned, instructions),
      skillsHome,
    );
    const originalBytes = await readFile(
      join(skillsHome, "assigned", "SKILL.md"),
    );
    let dependencyCalls = 0;
    await expect(
      materializeNativeRuntimeSkills(
        context(replacement, instructions, "replacement"),
        skillsHome,
        {
          renameTree: async () => {
            dependencyCalls += 1;
          },
          removeTree: async () => {
            dependencyCalls += 1;
          },
        },
      ),
    ).rejects.toThrow("skills home must be a fresh destination");

    expect(dependencyCalls).toBe(0);
    expect(await readFile(join(skillsHome, "assigned", "SKILL.md"))).toEqual(
      originalBytes,
    );
    await expect(stat(join(skillsHome, "replacement"))).rejects.toThrow();
    expect(
      (await readdir(dirname(skillsHome))).filter((entry) =>
        entry.startsWith(".paperclip-skills-"),
      ),
    ).toEqual([]);
  });

  (process.platform === "win32" ? it.skip : it)("cleans private staging when fresh publication fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperclip-runtime-publish-"));
    roots.push(root);
    const assigned = join(root, "assigned-source");
    const instructions = join(root, "instructions-source");
    const skillsHome = join(root, "codex-home", "skills");
    await Promise.all([mkdir(assigned), mkdir(instructions)]);
    await writeFile(join(assigned, "SKILL.md"), "# Assigned\n");
    await writeFile(join(instructions, "AGENTS.md"), "Instructions\n");

    await expect(materializeNativeRuntimeSkills(
      context(assigned, instructions),
      skillsHome,
      {
        renameTree: async (source) => {
          await expect(
            readFile(join(source, "assigned", "SKILL.md"), "utf8"),
          ).resolves.toBe("# Assigned\n");
          throw new Error("simulated publication failure");
        },
      },
    )).rejects.toThrow("simulated publication failure");

    await expect(stat(skillsHome)).rejects.toThrow();
    expect(
      (await readdir(dirname(skillsHome))).filter((entry) =>
        entry.startsWith(".paperclip-skills-staging-"),
      ),
    ).toEqual([]);
  });

  it("rejects skill names that can escape or alias the skills home", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperclip-runtime-name-"));
    roots.push(root);
    const assigned = join(root, "assigned-source");
    const instructions = join(root, "instructions-source");
    const codexHome = join(root, "codex-home");
    await Promise.all([mkdir(assigned), mkdir(instructions)]);
    await writeFile(join(assigned, "SKILL.md"), "# Assigned\n");
    await writeFile(join(instructions, "AGENTS.md"), "Instructions\n");

    await expect(prepareIsolatedCodexHome({
      context: context(assigned, instructions, "../outside"),
      codexHome,
    })).rejects.toThrow("skill name must be a safe relative path");
    for (const runtimeName of [
      "CON",
      "con.txt",
      "CON .txt",
      "aux .json",
      "COM1 .md",
      "group/AUX",
      "Lpt1.json",
      "group:name",
      "group?name",
      "group*name",
      'group"name',
      "group<name",
      "group>name",
      "group|name",
      "group\u0001name",
      "...",
      ". .",
      "group/...",
      "group/. . ",
    ]) {
      await expect(prepareIsolatedCodexHome({
        context: context(assigned, instructions, runtimeName),
        codexHome,
      })).rejects.toThrow("skill name must be a safe relative path");
    }
    await expect(stat(join(root, "outside"))).rejects.toThrow();
  });

  it("writes API login state as an owner-only file and removes stale auth", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperclip-runtime-auth-"));
    roots.push(root);
    const codexHome = join(root, "codex-home");
    const emptyCodexHome = join(root, "empty-codex-home");
    await Promise.all([
      mkdir(codexHome, { recursive: true }),
      mkdir(emptyCodexHome, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(codexHome, "auth.json"), "stale", { mode: 0o600 }),
      writeFile(join(emptyCodexHome, "auth.json"), "stale", { mode: 0o600 }),
    ]);

    await prepareIsolatedCodexHome({
      context: null,
      codexHome,
      apiKey: "fresh-ephemeral-key",
    });

    await expect(readFile(join(codexHome, "auth.json"), "utf8")).resolves.toBe(
      JSON.stringify({ OPENAI_API_KEY: "fresh-ephemeral-key" }),
    );
    const authPath = join(codexHome, "auth.json");
    if (process.platform === "win32") {
      const acl = await windowsPrivateAcl(authPath);
      expect(acl.protected).toBe(true);
      expect(acl.owner).toBe(acl.current);
      expect(acl.readers).toEqual([acl.current]);
      expect(acl.ruleCount).toBe(1);
      expect(acl.fullControl).toBe(true);
      const homeAcl = await windowsPrivateAcl(codexHome);
      expect(homeAcl.protected).toBe(true);
      expect(homeAcl.owner).toBe(homeAcl.current);
      expect(homeAcl.readers).toEqual([homeAcl.current]);
      expect(homeAcl.ruleCount).toBe(1);
      expect(homeAcl.fullControl).toBe(true);
    } else {
      expect((await stat(authPath)).mode & 0o777).toBe(0o600);
    }

    await prepareIsolatedCodexHome({ context: null, codexHome: emptyCodexHome });
    await expect(stat(join(emptyCodexHome, "auth.json"))).rejects.toThrow();
  });

  it("copies host auth only where source credential ownership is supported", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperclip-runtime-host-auth-"));
    roots.push(root);
    const codexHome = join(root, "codex-home");
    const symlinkCodexHome = join(root, "symlink-codex-home");
    const sourceHome = join(root, "source-home");
    const secret = join(root, "secret.json");
    await mkdir(sourceHome);
    await writeFile(join(sourceHome, "auth.json"), "host-auth", { mode: 0o600 });

    if (process.platform === "win32") {
      const sourceBytes = await readFile(join(sourceHome, "auth.json"));
      await expect(prepareIsolatedCodexHome({
        context: null,
        codexHome,
        sourceCodexHome: sourceHome,
      })).rejects.toThrow("native_runtime_context_unsupported");
      expect(await readFile(join(sourceHome, "auth.json"))).toEqual(sourceBytes);
      await expect(lstat(codexHome)).rejects.toThrow();
    } else {
      await prepareIsolatedCodexHome({
        context: null,
        codexHome,
        sourceCodexHome: sourceHome,
      });
      await expect(readFile(join(codexHome, "auth.json"), "utf8")).resolves.toBe(
        "host-auth",
      );
    }

    await rm(join(sourceHome, "auth.json"));
    await writeFile(secret, "must-not-copy");
    await symlink(secret, join(sourceHome, "auth.json"));
    if (process.platform === "win32") {
      await expect(prepareIsolatedCodexHome({
        context: null,
        codexHome: symlinkCodexHome,
        sourceCodexHome: sourceHome,
      })).rejects.toThrow("native_runtime_context_unsupported");
    } else {
      await prepareIsolatedCodexHome({
        context: null,
        codexHome: symlinkCodexHome,
        sourceCodexHome: sourceHome,
      });
    }
    await expect(stat(join(symlinkCodexHome, "auth.json"))).rejects.toThrow();
    await expect(readFile(secret, "utf8")).resolves.toBe("must-not-copy");
  });

  (process.platform === "win32" ? it : it.skip)(
    "keeps value-free managed config while refusing host auth links and unsafe config",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "paperclip-runtime-win32-source-"));
      roots.push(root);
      const managedSource = join(root, "managed-source");
      const managedTarget = join(root, "managed-target");
      const authSource = join(root, "auth-source");
      const junctionSource = join(root, "junction-source");
      const unsafeSource = join(root, "unsafe-source");
      const external = join(root, "external");
      await Promise.all([mkdir(managedSource), mkdir(authSource), mkdir(unsafeSource), mkdir(external)]);
      await writeFile(join(managedSource, "config.toml"), `model_provider = "paperclip"
[model_providers.paperclip]
name = "Selected connection"
base_url = "https://paperclip.example/api"
wire_api = "responses"
requires_openai_auth = false
`);
      await prepareIsolatedCodexHome({ context: null, codexHome: managedTarget, sourceCodexHome: managedSource });
      await expect(readFile(join(managedTarget, "config.toml"), "utf8")).resolves.toContain('model_provider = "paperclip"');

      await writeFile(join(authSource, "auth.json"), "host-auth");
      await expect(prepareIsolatedCodexHome({ context: null, codexHome: join(root, "auth-target"), sourceCodexHome: authSource })).rejects.toThrow("native_runtime_context_unsupported");
      await symlink(authSource, junctionSource, "junction");
      await expect(prepareIsolatedCodexHome({ context: null, codexHome: join(root, "junction-target"), sourceCodexHome: junctionSource })).rejects.toThrow("native_runtime_context_unsupported");

      await writeFile(join(external, "config.toml"), "host-owned");
      await symlink(join(external, "config.toml"), join(unsafeSource, "config.toml"));
      await expect(prepareIsolatedCodexHome({ context: null, codexHome: join(root, "unsafe-target"), sourceCodexHome: unsafeSource })).rejects.toThrow("native_runtime_context_unsupported");
      await expect(readFile(join(external, "config.toml"), "utf8")).resolves.toBe("host-owned");

      const absentSource = join(root, "absent-source");
      const absentTarget = join(root, "absent-target");
      await mkdir(absentSource);
      await prepareIsolatedCodexHome({ context: null, codexHome: absentTarget, sourceCodexHome: absentSource });
      await expect(readFile(join(absentTarget, "config.toml"), "utf8")).resolves.toContain("shell_snapshot = false");
      await expect(lstat(join(absentTarget, "auth.json"))).rejects.toThrow();

      const appearedAuthSource = join(root, "appeared-auth-source");
      const appearedAuthTarget = join(root, "appeared-auth-target");
      const appearedSecret = join(root, "appeared-secret.json");
      await mkdir(appearedAuthSource);
      const absentPreflight = await preflightIsolatedCodexHome({ sourceCodexHome: appearedAuthSource });
      await writeFile(appearedSecret, "must-not-read-or-copy");
      await symlink(appearedSecret, join(appearedAuthSource, "auth.json"));
      await prepareIsolatedCodexHome({ context: null, codexHome: appearedAuthTarget, sourceCodexHome: appearedAuthSource, preflight: absentPreflight });
      await expect(lstat(join(appearedAuthTarget, "auth.json"))).rejects.toThrow();
      await expect(readFile(appearedSecret, "utf8")).resolves.toBe("must-not-read-or-copy");

      const targetExternal = join(root, "target-external");
      const targetJunction = join(root, "target-junction");
      await mkdir(targetExternal);
      await writeFile(join(targetExternal, "sentinel.txt"), "must-not-mutate");
      await symlink(targetExternal, targetJunction, "junction");
      await expect(prepareIsolatedCodexHome({ context: null, codexHome: targetJunction, apiKey: "ephemeral" })).rejects.toThrow("native_runtime_context_unsupported");
      await expect(readFile(join(targetExternal, "sentinel.txt"), "utf8")).resolves.toBe("must-not-mutate");
      await expect(lstat(join(targetExternal, "config.toml"))).rejects.toThrow();
      await expect(lstat(join(targetExternal, "auth.json"))).rejects.toThrow();
      expect((await readdir(targetExternal)).filter((entry) => entry.startsWith(".paperclip-skills-staging-"))).toEqual([]);
    },
  );
});

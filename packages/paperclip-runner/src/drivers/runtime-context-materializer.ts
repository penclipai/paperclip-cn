import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { parse as parseToml } from "smol-toml";

import type { NativeRuntimeContextSnapshot } from "../contracts/runtime-context.js";
import type { NativeMcpLaunchBinding } from "./native-mcp.js";

const execFileAsync = promisify(execFile);
const WINDOWS_PRIVATE_PATH_ACL_TARGETS = "PAPERCLIP_RUNTIME_ACL_TARGETS";
const WINDOWS_POWERSHELL_PATH = join(
  process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const WINDOWS_PRIVATE_PATH_ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$targets = @((ConvertFrom-Json -InputObject $env:PAPERCLIP_RUNTIME_ACL_TARGETS).targets)
if ($targets.Count -eq 0) { exit 10 }
$sections = [System.Security.AccessControl.AccessControlSections]::Access -bor [System.Security.AccessControl.AccessControlSections]::Owner
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
if ($null -eq $currentSid) { exit 11 }
foreach ($entry in $targets) {
  $target = [string]$entry.path
  $kind = [string]$entry.kind
  $item = Get-Item -LiteralPath $target -Force
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { exit 12 }
  $isDirectory = [bool]$item.PSIsContainer
  if (($kind -eq 'directory') -ne $isDirectory) { exit 13 }
  $acl = if ($isDirectory) { [System.IO.Directory]::GetAccessControl($target, $sections) } else { [System.IO.File]::GetAccessControl($target, $sections) }
  if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $currentSid.Value) { exit 14 }
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($rule) }
  $inheritance = if ($isDirectory) { [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit } else { [System.Security.AccessControl.InheritanceFlags]::None }
  $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($currentSid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow))
  if ($isDirectory) { [System.IO.Directory]::SetAccessControl($target, $acl) } else { [System.IO.File]::SetAccessControl($target, $acl) }
  $verified = if ($isDirectory) { [System.IO.Directory]::GetAccessControl($target, $sections) } else { [System.IO.File]::GetAccessControl($target, $sections) }
  if (-not $verified.AreAccessRulesProtected -or $verified.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $currentSid.Value) { exit 15 }
  $verifiedRules = @($verified.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
  if ($verifiedRules.Count -ne 1) { exit 16 }
  $verifiedRule = $verifiedRules[0]
  if ($verifiedRule.IdentityReference.Value -ne $currentSid.Value -or $verifiedRule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { exit 17 }
  if (($verifiedRule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne [System.Security.AccessControl.FileSystemRights]::FullControl) { exit 18 }
}
`;
const WINDOWS_PRIVATE_PATH_ACL_SCRIPT_BASE64 = Buffer.from(
  WINDOWS_PRIVATE_PATH_ACL_SCRIPT,
  "utf16le",
).toString("base64");

async function assertSafeTree(root: string, child = ""): Promise<void> {
  const directory = child ? join(root, child) : root;
  const directoryStat = await lstat(directory);
  if (directoryStat.isSymbolicLink()) {
    throw new Error(
      `runtime context asset contains a symlink: ${child || "."}`,
    );
  }
  if (!directoryStat.isDirectory()) {
    throw new Error("runtime context asset root must be a directory");
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const childRelative = child ? `${child}/${entry.name}` : entry.name;
    const stat = await lstat(join(root, childRelative));
    if (stat.isSymbolicLink()) {
      throw new Error(
        `runtime context asset contains a symlink: ${childRelative}`,
      );
    }
    if (stat.isDirectory()) await assertSafeTree(root, childRelative);
    else if (!stat.isFile()) {
      throw new Error(
        `runtime context asset contains an unsupported file: ${childRelative}`,
      );
    }
  }
}

function safeMaterializationTarget(root: string, runtimeName: string): string {
  const segments = runtimeName.split("/");
  if (
    runtimeName.startsWith("/")
    || runtimeName.includes("\\")
    || runtimeName.includes("\0")
    || segments.some((segment) => /[<>:"|?*\u0000-\u001f\u007f]/u.test(segment))
    || segments.some((segment) => !segment || segment === "." || segment === "..")
    || segments.some((segment) => !segment.replace(/[ .]+$/u, ""))
    || segments.some(isWin32ReservedPathSegment)
  ) {
    throw new Error("runtime context skill name must be a safe relative path");
  }
  const target = resolve(root, runtimeName);
  const relation = relative(resolve(root), target);
  if (
    relation === ""
    || relation === ".."
    || relation.startsWith(`..${sep}`)
    || isAbsolute(relation)
  ) {
    throw new Error("runtime context skill name must stay inside the skills home");
  }
  return target;
}

function isWin32ReservedPathSegment(segment: string): boolean {
  const basename = segment
    .normalize("NFC")
    .split(".", 1)[0]!
    .replace(/[ .]+$/u, "")
    .toUpperCase();
  return /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/u.test(
    basename,
  );
}

function portableRuntimeNameKey(runtimeName: string): string {
  // Skill assignments must remain unambiguous when the same context is moved
  // between the case-sensitive Linux runner and the case-insensitive default
  // filesystems on macOS or Windows. NFC also catches composed/decomposed
  // aliases, while per-segment trimming matches Win32's treatment of trailing
  // dots and spaces before either spelling reaches the staging tree.
  return runtimeName
    .normalize("NFC")
    .split("/")
    .map((segment) => segment.replace(/[ .]+$/u, ""))
    .join("/")
    .toLowerCase();
}

async function protectStagedTree(root: string): Promise<void> {
  const rootHandle = await open(
    root,
    constants.O_RDONLY
      | (constants.O_NOFOLLOW ?? 0)
      | (constants.O_DIRECTORY ?? 0),
  );
  try {
    const opened = await rootHandle.stat();
    if (!opened.isDirectory()) {
      throw new Error("staged runtime context root must be a directory");
    }
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const child = join(root, entry.name);
      if (entry.isDirectory()) {
        await protectStagedTree(child);
        continue;
      }
      const childHandle = await open(
        child,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        const openedChild = await childHandle.stat();
        if (!openedChild.isFile()) {
          throw new Error("staged runtime context asset must be a regular file");
        }
        await childHandle.chmod(openedChild.mode & 0o555);
      } finally {
        await childHandle.close();
      }
    }
    // Seal directories only after their descendants. Traversal needs execute
    // permission, but provider processes must not be able to rewrite assigned
    // skills after the immutable snapshot has been published.
    await rootHandle.chmod(0o555);
  } finally {
    await rootHandle.close();
  }
}

async function unprotectMaterializedTree(root: string): Promise<void> {
  const rootHandle = await open(
    root,
    constants.O_RDONLY
      | (constants.O_NOFOLLOW ?? 0)
      | (constants.O_DIRECTORY ?? 0),
  );
  try {
    const opened = await rootHandle.stat();
    if (!opened.isDirectory()) {
      throw new Error("materialized runtime context root must be a directory");
    }
    // Restore directory mutation before descending so every child can be
    // unlinked. Handles plus O_NOFOLLOW keep cleanup inside the sealed tree.
    await rootHandle.chmod(0o700);
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const child = join(root, entry.name);
      if (entry.isDirectory()) {
        await unprotectMaterializedTree(child);
        continue;
      }
      const childHandle = await open(
        child,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        const openedChild = await childHandle.stat();
        if (!openedChild.isFile()) {
          throw new Error("materialized runtime context asset must be a regular file");
        }
        await childHandle.chmod(0o600);
      } finally {
        await childHandle.close();
      }
    }
  } finally {
    await rootHandle.close();
  }
}

async function removeMaterializedTree(
  skillsHome: string,
  removeTree: (path: string) => Promise<void>,
): Promise<void> {
  if (process.platform === "win32") {
    await removeEmptyMaterializedTreeOnWindows(skillsHome);
    return;
  }
  const exists = await lstat(skillsHome).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  if (!exists) return;
  await unprotectMaterializedTree(skillsHome);
  await removeTree(skillsHome);
}

async function removeEmptyMaterializedTreeOnWindows(
  skillsHome: string,
): Promise<void> {
  const stat = await lstat(skillsHome).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(
      "native_runtime_context_unsupported: immutable assigned skills cannot be released on win32",
    );
  }
  // Windows cannot safely restore the POSIX directory seal. Empty homes have
  // no assigned snapshot, so remove only that exact directory without chmod,
  // recursive traversal, or following a reparse point. Let rmdir provide the
  // atomic emptiness check rather than inspecting a path that could be swapped.
  await rmdir(skillsHome).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return;
    if (error.code === "ENOTEMPTY" || error.code === "EEXIST") {
      throw new Error(
        "native_runtime_context_unsupported: immutable assigned skills cannot be released on win32",
      );
    }
    throw error;
  });
}

/**
 * Assigned skills are an immutable provider input. Windows does not preserve
 * the directory seal used by this materializer, so never publish an assigned
 * snapshot there as though it were immutable.
 */
export function assertNativeRuntimeSkillSealingSupported(
  context: NativeRuntimeContextSnapshot | null,
): void {
  if (process.platform === "win32" && (context?.skills.length ?? 0) > 0) {
    throw new Error(
      "native_runtime_context_unsupported: immutable assigned skills cannot be sealed on win32",
    );
  }
}

/** Removes a previously sealed skills snapshot at an explicit lifecycle boundary. */
export async function releaseMaterializedNativeRuntimeSkills(
  skillsHome: string,
): Promise<void> {
  await removeMaterializedTree(
    skillsHome,
    (path) => rm(path, { recursive: true, force: true }),
  );
}

export async function materializeNativeRuntimeSkills(
  context: NativeRuntimeContextSnapshot | null,
  skillsHome: string,
  dependencies: {
    /** Internal test seam for failed staging cleanup coverage. */
    removeTree?: (path: string) => Promise<void>;
    /** Internal test seam for publication failure coverage. */
    renameTree?: (source: string, destination: string) => Promise<void>;
  } = {},
): Promise<void> {
  const removeTree =
    dependencies.removeTree ??
    ((path: string) => rm(path, { recursive: true, force: true }));
  const renameTree = dependencies.renameTree ?? rename;
  if (context) {
    const runtimeNames = new Set<string>();
    for (const skill of context.skills) {
      safeMaterializationTarget(skillsHome, skill.runtimeName);
      const runtimeName = portableRuntimeNameKey(skill.runtimeName);
      if (runtimeNames.has(runtimeName)) {
        throw new Error("runtime context skill names must not overlap");
      }
      runtimeNames.add(runtimeName);
    }
    for (const runtimeName of runtimeNames) {
      const segments = runtimeName.split("/");
      for (let length = 1; length < segments.length; length += 1) {
        if (runtimeNames.has(segments.slice(0, length).join("/"))) {
          throw new Error("runtime context skill names must not overlap");
        }
      }
    }
    for (const skill of context.skills) {
      await assertSafeTree(skill.bundle.rootPath);
    }
  }
  assertNativeRuntimeSkillSealingSupported(context);

  const skillsHomeExists = await lstat(skillsHome).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  if (skillsHomeExists) {
    throw new Error(
      "runtime context skills home must be a fresh destination",
    );
  }

  const parent = dirname(skillsHome);
  if (process.platform === "win32") {
    await prepareWindowsMaterializationParent(parent);
  } else {
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await chmod(parent, 0o700);
  }
  const nonce = randomUUID();
  const stagingHome = join(parent, `.paperclip-skills-staging-${nonce}`);
  await mkdir(stagingHome, { mode: 0o700 });
  try {
    for (const skill of context?.skills ?? []) {
      const target = safeMaterializationTarget(stagingHome, skill.runtimeName);
      await cp(skill.bundle.rootPath, target, {
        recursive: true,
        force: false,
        errorOnExist: true,
        dereference: false,
        verbatimSymlinks: true,
      });
      await assertSafeTree(target);
      await protectStagedTree(target);
    }

    // The caller supplies a new isolated home for each provider launch. Never
    // move an existing assignment out of its canonical path: a failed bounded
    // rollback cannot portably guarantee that name is restored on every
    // filesystem. Publication therefore targets only a fresh destination.
    await renameTree(stagingHome, skillsHome);
  } catch (error) {
    // Cleanup is best effort and must not replace the publication failure that
    // explains why no runtime snapshot was installed.
    await removeMaterializedTree(stagingHome, removeTree).catch(() => undefined);
    throw error;
  }
}

function sameBoundedFileIdentity(
  left: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint },
  right: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs;
}

async function prepareWindowsMaterializationParent(parent: string): Promise<void> {
  let stat = await lstat(parent).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) {
    // The runner creates this one fresh leaf beneath its already trusted runtime
    // root. Do not recursively create or traverse caller-controlled ancestors.
    const ancestor = await lstat(dirname(parent));
    if (ancestor.isSymbolicLink() || !ancestor.isDirectory()) {
      throw new Error("native_runtime_context_unsupported: isolated Codex home cannot be secured on win32");
    }
    await mkdir(parent, { mode: 0o700 });
    stat = await lstat(parent);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("native_runtime_context_unsupported: isolated Codex home cannot be secured on win32");
  }
  await secureWindowsPrivatePaths([{ path: parent, kind: "directory" }]);
}

async function readBoundedSourceConfig(path: string): Promise<Buffer | null> {
  // The controller selects and trusts the sourceCodexHome parent; this reader
  // verifies only the final config entry's bounded identity while it is read.
  const pathBefore = await lstat(path, { bigint: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (!pathBefore) return null;
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink() || pathBefore.size > 1024n * 1024n) {
    throw new Error("native_runtime_context_unsupported: managed Codex config is not a bounded regular file");
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > 1024n * 1024n || !sameBoundedFileIdentity(pathBefore, before)) {
      throw new Error("native_runtime_context_unsupported: managed Codex config changed during read");
    }
    const expectedLength = Number(before.size);
    const bytes = Buffer.allocUnsafe(expectedLength + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(path, { bigint: true });
    if (offset !== expectedLength || !sameBoundedFileIdentity(before, after)
      || !pathAfter.isFile() || pathAfter.isSymbolicLink()
      || !sameBoundedFileIdentity(before, pathAfter)) {
      throw new Error("native_runtime_context_unsupported: managed Codex config changed during read");
    }
    return bytes.subarray(0, expectedLength);
  } finally {
    await handle.close();
  }
}

async function readSourceCodexAuth(sourceAuth: string): Promise<Buffer | null> {
  const handle = await open(
    sourceAuth,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ELOOP") return null;
    throw error;
  });
  if (!handle) return null;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return null;
    if (stat.size > 1024 * 1024) {
      throw new Error("source Codex auth file exceeds the 1 MiB limit");
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/** Copy only Paperclip's value-free provider projection, never host tools or hooks. */
async function managedCodexProviderConfig(sourceHome?: string | null): Promise<string> {
  if (!sourceHome?.trim()) return "";
  const source = await readBoundedSourceConfig(join(sourceHome, "config.toml"));
  if (!source) return "";
  let parsed;
  try { parsed = parseToml(source.toString("utf8")); } catch { return ""; }
  if (parsed.model_provider !== "paperclip") return "";
  const providers = parsed.model_providers as Record<string, unknown> | undefined;
  const provider = providers?.paperclip as Record<string, unknown> | undefined;
  if (!provider || typeof provider.base_url !== "string" || provider.wire_api !== "responses"
    || provider.requires_openai_auth !== false
    || (provider.env_key !== undefined && provider.env_key !== "PAPERCLIP_AI_PROVIDER_KEY")) {
    throw new Error("Invalid managed Codex provider configuration");
  }
  const url = new URL(provider.base_url);
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Invalid managed Codex provider URL");
  }
  return `model_provider = "paperclip"\n[model_providers.paperclip]\nname = "Paperclip connection"\nbase_url = ${JSON.stringify(provider.base_url)}\nwire_api = "responses"\nrequires_openai_auth = false\n${provider.env_key ? 'env_key = "PAPERCLIP_AI_PROVIDER_KEY"\n' : ""}`;
}

async function assertWindowsHostAuthUnavailable(sourceHome?: string | null): Promise<void> {
  if (process.platform !== "win32" || !sourceHome?.trim()) return;
  const authPath = join(sourceHome, "auth.json");
  const entry = await lstat(authPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (entry) {
    throw new Error(
      "native_runtime_context_unsupported: importing host Codex auth is unsupported on win32",
    );
  }
}

async function secureWindowsPrivatePaths(
  targets: Array<{ path: string; kind: "directory" | "file" }>,
): Promise<void> {
  if (process.platform !== "win32") return;
  try {
    await execFileAsync(WINDOWS_POWERSHELL_PATH, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-EncodedCommand", WINDOWS_PRIVATE_PATH_ACL_SCRIPT_BASE64,
    ], {
      env: {
        ...process.env,
        [WINDOWS_PRIVATE_PATH_ACL_TARGETS]: JSON.stringify({ targets }),
      },
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 1024,
    });
  } catch {
    throw new Error("native_runtime_context_unsupported: isolated Codex home cannot be secured on win32");
  }
}

export type IsolatedCodexHomePreflight = {
  providerConfig: string;
  apiKey: string | undefined;
};

export async function preflightIsolatedCodexHome(input: {
  sourceCodexHome?: string | null;
  apiKey?: string | null;
}): Promise<IsolatedCodexHomePreflight> {
  const providerConfig = await managedCodexProviderConfig(input.sourceCodexHome);
  const apiKey = input.apiKey?.trim();
  if (!providerConfig && !apiKey) {
    await assertWindowsHostAuthUnavailable(input.sourceCodexHome);
  }
  return { providerConfig, apiKey };
}

export async function prepareIsolatedCodexHome(input: {
  context: NativeRuntimeContextSnapshot | null;
  codexHome: string;
  sourceCodexHome?: string | null;
  nativeMcp?: NativeMcpLaunchBinding | null;
  apiKey?: string | null;
  preflight?: IsolatedCodexHomePreflight;
}): Promise<void> {
  const { providerConfig, apiKey } = input.preflight
    ?? await preflightIsolatedCodexHome(input);
  await materializeNativeRuntimeSkills(
    input.context,
    join(input.codexHome, "skills"),
  );

  const configPath = join(input.codexHome, "config.toml");
  await rm(configPath, { force: true });
  await writeFile(configPath, [
    providerConfig,
    // Codex shell snapshots serialize the provider process environment. The
    // native runner injects short-lived provider and MCP bindings, so a
    // snapshot would turn ephemeral credentials into durable session state.
    "[features]",
    "shell_snapshot = false",
    "",
    ...(input.nativeMcp
      ? [
          `[mcp_servers.${JSON.stringify(input.nativeMcp.name)}]`,
          `url = ${JSON.stringify(input.nativeMcp.url)}`,
          // This endpoint is Paperclip's authenticated policy gateway, not an
          // upstream server. It enforces connection grants and human approvals
          // for every operation; the provider must deliver calls to that gate.
          'default_tools_approval_mode = "approve"',
          `http_headers = { Authorization = ${JSON.stringify(`Bearer ${input.nativeMcp.token}`)} }`,
          "",
        ]
      : []),
  ].join("\n"), { mode: 0o600, flag: "wx" });
  await secureWindowsPrivatePaths([{ path: configPath, kind: "file" }]);

  const targetAuth = join(input.codexHome, "auth.json");
  await rm(targetAuth, { force: true });
  if (providerConfig) return;
  if (apiKey) {
    // The pinned Codex app-server authenticates API-key automation through its
    // login cache rather than the CLI-only CODEX_API_KEY path. Keep this file
    // owner-only in the disposable session home.
    await writeFile(
      targetAuth,
      JSON.stringify({ OPENAI_API_KEY: apiKey }),
      { mode: 0o600, flag: "wx" },
    );
    await chmod(targetAuth, 0o600);
    await secureWindowsPrivatePaths([{ path: targetAuth, kind: "file" }]);
    return;
  }

  const sourceHome = input.sourceCodexHome?.trim();
  if (!sourceHome || process.platform === "win32") return;
  const sourceAuth = await readSourceCodexAuth(join(sourceHome, "auth.json"));
  if (!sourceAuth) return;
  await writeFile(targetAuth, sourceAuth, { mode: 0o600, flag: "wx" });
  await chmod(targetAuth, 0o600);
  await secureWindowsPrivatePaths([{ path: targetAuth, kind: "file" }]);
}

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resetClaudeCliCapabilitiesCacheForTests, testEnvironment } from "@penclipai/adapter-claude-local/server";

const ORIGINAL_ANTHROPIC = process.env.ANTHROPIC_API_KEY;
const ORIGINAL_BEDROCK = process.env.CLAUDE_CODE_USE_BEDROCK;
const ORIGINAL_BEDROCK_URL = process.env.ANTHROPIC_BEDROCK_BASE_URL;
const ORIGINAL_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
const ORIGINAL_PAPERCLIP_HOME = process.env.PAPERCLIP_HOME;
const ORIGINAL_PAPERCLIP_INSTANCE_ID = process.env.PAPERCLIP_INSTANCE_ID;

afterEach(() => {
  resetClaudeCliCapabilitiesCacheForTests();
  if (ORIGINAL_ANTHROPIC === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC;
  }
  if (ORIGINAL_BEDROCK === undefined) {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
  } else {
    process.env.CLAUDE_CODE_USE_BEDROCK = ORIGINAL_BEDROCK;
  }
  if (ORIGINAL_BEDROCK_URL === undefined) {
    delete process.env.ANTHROPIC_BEDROCK_BASE_URL;
  } else {
    process.env.ANTHROPIC_BEDROCK_BASE_URL = ORIGINAL_BEDROCK_URL;
  }
  if (ORIGINAL_CLAUDE_CONFIG_DIR === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CLAUDE_CONFIG_DIR;
  }
  if (ORIGINAL_PAPERCLIP_HOME === undefined) {
    delete process.env.PAPERCLIP_HOME;
  } else {
    process.env.PAPERCLIP_HOME = ORIGINAL_PAPERCLIP_HOME;
  }
  if (ORIGINAL_PAPERCLIP_INSTANCE_ID === undefined) {
    delete process.env.PAPERCLIP_INSTANCE_ID;
  } else {
    process.env.PAPERCLIP_INSTANCE_ID = ORIGINAL_PAPERCLIP_INSTANCE_ID;
  }
});

function createLocalSandboxRunner(executeCalls: Array<{ command: string; args?: string[] }> = []) {
  return {
    execute: async (input: {
      command: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
      stdin?: string;
      timeoutMs?: number;
      onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
      onSpawn?: (meta: { pid: number; startedAt: string }) => Promise<void>;
    }) => {
      await input.onSpawn?.({ pid: 1, startedAt: new Date().toISOString() });
      executeCalls.push({ command: input.command, args: input.args });
      if (input.command === "sh") {
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          stdout: "/usr/bin/claude\n",
          stderr: "",
          pid: 1,
          startedAt: new Date().toISOString(),
        };
      }
      if (input.args?.includes("--version")) {
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          stdout: "2.1.286 (Claude Code)\n",
          stderr: "",
          pid: 1,
          startedAt: new Date().toISOString(),
        };
      }
      if (input.args?.includes("--help")) {
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          stdout: "Usage: claude [options]\n  --print\n  --model <id>\n",
          stderr: "",
          pid: 1,
          startedAt: new Date().toISOString(),
        };
      }
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: [
          JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } }),
          JSON.stringify({
            type: "result",
            result: "hello",
            usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
          }),
        ].join("\n"),
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      };
    },
  };
}

describe("claude_local environment diagnostics", () => {
  it("returns a warning (not an error) when ANTHROPIC_API_KEY is set in host environment", async () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.ANTHROPIC_BEDROCK_BASE_URL;
    process.env.ANTHROPIC_API_KEY = "sk-test-host";

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "claude_local",
      config: {
        engine: "cli",
        command: process.execPath,
        cwd: process.cwd(),
      },
    });

    expect(result.status).toBe("warn");
    expect(
      result.checks.some(
        (check) =>
          check.code === "claude_anthropic_api_key_overrides_subscription" &&
          check.level === "warn",
      ),
    ).toBe(true);
    expect(result.checks.some((check) => check.level === "error")).toBe(false);
  });

  it("reports an explicitly configured API key as normal authentication", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.ANTHROPIC_BEDROCK_BASE_URL;

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "claude_local",
      config: {
        engine: "cli",
        command: process.execPath,
        cwd: process.cwd(),
        env: {
          ANTHROPIC_API_KEY: "sk-test-config",
        },
      },
    });

    expect(result.status).toBe("pass");
    expect(
      result.checks.some(
        (check) =>
          check.code === "claude_anthropic_api_key_overrides_subscription" &&
          check.level === "info",
      ),
    ).toBe(true);
    expect(result.checks.some((check) => check.level === "error")).toBe(false);
  });

  it("returns bedrock auth info when CLAUDE_CODE_USE_BEDROCK is set in host environment", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_USE_BEDROCK = "1";

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "claude_local",
      config: {
        engine: "cli",
        command: process.execPath,
        cwd: process.cwd(),
      },
    });

    expect(
      result.checks.some(
        (check) =>
          check.code === "claude_bedrock_auth" && check.level === "info",
      ),
    ).toBe(true);
    expect(
      result.checks.some(
        (check) => check.code === "claude_subscription_mode_possible",
      ),
    ).toBe(false);
    expect(result.checks.some((check) => check.level === "error")).toBe(false);
  });

  it("returns bedrock auth info when CLAUDE_CODE_USE_BEDROCK is set in adapter env", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_USE_BEDROCK;

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "claude_local",
      config: {
        engine: "cli",
        command: process.execPath,
        cwd: process.cwd(),
        env: {
          CLAUDE_CODE_USE_BEDROCK: "1",
        },
      },
    });

    expect(
      result.checks.some(
        (check) =>
          check.code === "claude_bedrock_auth" && check.level === "info",
      ),
    ).toBe(true);
    expect(
      result.checks.some(
        (check) => check.code === "claude_subscription_mode_possible",
      ),
    ).toBe(false);
    expect(result.checks.some((check) => check.level === "error")).toBe(false);
  });

  it("bedrock auth takes precedence over missing ANTHROPIC_API_KEY", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_USE_BEDROCK = "1";

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "claude_local",
      config: {
        engine: "cli",
        command: process.execPath,
        cwd: process.cwd(),
      },
    });

    const codes = result.checks.map((c) => c.code);
    expect(codes).toContain("claude_bedrock_auth");
    expect(codes).not.toContain("claude_subscription_mode_possible");
    expect(codes).not.toContain("claude_anthropic_api_key_overrides_subscription");
  });

  it("creates a missing working directory when cwd is absolute", async () => {
    const cwd = path.join(
      os.tmpdir(),
      `paperclip-claude-local-cwd-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      "workspace",
    );

    await fs.rm(path.dirname(cwd), { recursive: true, force: true });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "claude_local",
      config: {
        engine: "cli",
        command: process.execPath,
        cwd,
      },
    });

    expect(result.checks.some((check) => check.code === "claude_cwd_valid")).toBe(true);
    expect(result.checks.some((check) => check.level === "error")).toBe(false);
    const stats = await fs.stat(cwd);
    expect(stats.isDirectory()).toBe(true);
    await fs.rm(path.dirname(cwd), { recursive: true, force: true });
  });

  it("defaults remote probes to the environment remote cwd when adapter cwd is unset", async () => {
    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "claude_local",
      config: {
        engine: "cli",
        command: process.execPath,
      },
      executionTarget: {
        kind: "remote",
        transport: "sandbox",
        providerKey: "test-provider",
        remoteCwd: "/srv/paperclip/workspace",
        runner: {
          execute: async () => ({
            exitCode: 0,
            signal: null,
            timedOut: false,
            stdout: "",
            stderr: "",
            pid: null,
            startedAt: new Date().toISOString(),
          }),
        },
      },
      environmentName: "Linux Box",
    });

    expect(result.checks.some((check) => check.code === "claude_cwd_valid")).toBe(true);
    expect(
      result.checks.some(
        (check) =>
          check.code === "claude_cwd_valid" &&
          check.message === "Working directory is valid: /srv/paperclip/workspace",
      ),
    ).toBe(true);
    expect(result.checks.some((check) => check.code === "claude_cwd_invalid")).toBe(false);
  });

  it("uses full permission bypass for sandbox hello probes", async () => {
    const executeCalls: Array<{ command: string; args?: string[]; env?: Record<string, string> }> = [];

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "claude_local",
      config: {
        engine: "cli",
        model: "claude-opus-5",
        command: "claude",
      },
      executionTarget: {
        kind: "remote",
        transport: "sandbox",
        providerKey: "cloudflare",
        remoteCwd: "/workspace/paperclip",
        runner: {
          execute: async (input) => {
            executeCalls.push({ command: input.command, args: input.args, env: input.env });
            if (input.command === "claude") {
              return {
                exitCode: 0,
                signal: null,
                timedOut: false,
                stdout: [
                  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } }),
                  JSON.stringify({
                    type: "result",
                    result: "hello",
                    usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
                  }),
                ].join("\n"),
                stderr: "",
                pid: null,
                startedAt: new Date().toISOString(),
              };
            }
            return {
              exitCode: 0,
              signal: null,
              timedOut: false,
              stdout: "",
              stderr: "",
              pid: null,
              startedAt: new Date().toISOString(),
            };
          },
        },
      },
      environmentName: "QA Cloudflare",
    });

    expect(result.checks.some((check) => check.code === "claude_hello_probe_passed")).toBe(true);
    const probeCall = executeCalls.find((call) => call.command === "claude");
    expect(probeCall?.args).toContain("--dangerously-skip-permissions");
    expect(probeCall?.args).not.toContain("--permission-mode");
    expect(probeCall?.args).not.toContain("--allowedTools");
    expect(probeCall?.env?.IS_SANDBOX).toBe("1");
  });

  it("uses the managed Claude config seed for sandbox hello probes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-envtest-managed-config-"));
    const sourceConfigDir = path.join(root, "host-claude");
    const remoteHome = path.join(root, "remote-home");
    const remoteWorkspace = "/home/daytona/paperclip-workspace";
    let validatedManagedConfig = false;

    await fs.mkdir(sourceConfigDir, { recursive: true });
    await fs.mkdir(path.join(remoteHome, ".claude"), { recursive: true });
    await fs.writeFile(path.join(sourceConfigDir, "settings.json"), JSON.stringify({
      theme: "dark",
      permissions: { defaultMode: "bypassPermissions" },
      hooks: { PreToolUse: [{ matcher: "*" }] },
      mcpServers: { local: { command: "secret-local-server" } },
      permissionMode: "dontAsk",
      skipDangerousModePermissionPrompt: true,
    }), "utf8");
    await fs.writeFile(path.join(sourceConfigDir, "CLAUDE.md"), "seed instructions", "utf8");
    await fs.writeFile(path.join(sourceConfigDir, "credentials.json"), JSON.stringify({ token: "local" }), "utf8");
    await fs.writeFile(path.join(remoteHome, ".claude", ".credentials.json"), JSON.stringify({ token: "remote" }), "utf8");
    process.env.CLAUDE_CONFIG_DIR = sourceConfigDir;
    process.env.PAPERCLIP_HOME = path.join(root, "paperclip-home");
    process.env.PAPERCLIP_INSTANCE_ID = "test-instance";

    try {
      const result = await testEnvironment({
        companyId: "company-1",
        adapterType: "claude_local",
        config: {
          engine: "cli",
          command: "claude",
          env: { HOME: remoteHome },
        },
        executionTarget: {
          kind: "remote",
          transport: "sandbox",
          providerKey: "daytona",
          remoteCwd: remoteWorkspace,
          runner: {
            execute: async (input) => {
              await input.onSpawn?.({ pid: 1, startedAt: new Date().toISOString() });
              if (input.command === "sh") {
                return {
                  exitCode: 0,
                  signal: null,
                  timedOut: false,
                  stdout: "/usr/bin/claude\n",
                  stderr: "",
                  pid: 1,
                  startedAt: new Date().toISOString(),
                };
              }
              if (input.args?.includes("--version")) {
                return {
                  exitCode: 0,
                  signal: null,
                  timedOut: false,
                  stdout: "2.1.286 (Claude Code)\n",
                  stderr: "",
                  pid: 1,
                  startedAt: new Date().toISOString(),
                };
              }
              if (input.args?.includes("--help")) {
                return {
                  exitCode: 0,
                  signal: null,
                  timedOut: false,
                  stdout: "Usage: claude [options]\n  --print\n  --model <id>\n",
                  stderr: "",
                  pid: 1,
                  startedAt: new Date().toISOString(),
                };
              }
              const configDir = input.env?.CLAUDE_CONFIG_DIR || "";
              expect(configDir.replace(/\\/g, "/")).toContain(".paperclip-runtime/claude/config");
              validatedManagedConfig = true;
              return {
                exitCode: 0,
                signal: null,
                timedOut: false,
                stdout: [
                  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } }),
                  JSON.stringify({ type: "result", result: "hello", usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 } }),
                ].join("\n"),
                stderr: "",
                pid: 1,
                startedAt: new Date().toISOString(),
              };
            },
          },
        },
        environmentName: "QA Daytona",
      });

      expect(validatedManagedConfig).toBe(true);
      expect(result.checks.some((check) => check.code === "claude_managed_config_dir")).toBe(true);
      expect(result.checks.some((check) => check.code === "claude_hello_probe_passed")).toBe(true);
      expect(result.checks.some((check) => check.code === "claude_hello_probe_failed")).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("warns and omits --effort for sandbox probes when the installed Claude CLI does not advertise it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-envtest-sandbox-effort-"));
    const executeCalls: Array<{ command: string; args?: string[] }> = [];

    try {
      const result = await testEnvironment({
        companyId: "company-1",
        adapterType: "claude_local",
        config: {
          engine: "cli",
          command: "claude",
          effort: "low",
        },
        executionTarget: {
          kind: "remote",
          transport: "sandbox",
          providerKey: "daytona",
          remoteCwd: "/workspace/paperclip",
          runner: createLocalSandboxRunner(executeCalls),
        },
        environmentName: "QA Daytona",
      });

      expect(result.checks.some((check) => check.code === "claude_effort_flag_unsupported")).toBe(true);
      expect(result.checks.some((check) => check.code === "claude_hello_probe_passed")).toBe(true);
      const probeArgs = executeCalls.find(call => call.args?.includes("--print"))?.args;
      expect(probeArgs).toBeDefined();
      expect(probeArgs).not.toContain("--effort");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

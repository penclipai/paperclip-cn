import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runChildProcess } from "@penclipai/adapter-utils/server-utils";
import { SANDBOX_INSTALL_COMMAND } from "../index.js";
import { testEnvironment } from "./test.js";

function resolveTestPosixShellCommand(command: "bash" | "sh") {
  if (process.platform !== "win32") return command === "bash" ? "/bin/bash" : "/bin/sh";
  const candidates = command === "bash"
    ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"]
    : ["C:\\Program Files\\Git\\usr\\bin\\sh.exe", "C:\\Program Files\\Git\\bin\\bash.exe"];
  return candidates.find((candidate) => existsSync(candidate)) ?? command;
}

function toGitShellPath(value: string) {
  if (process.platform !== "win32") return value;
  return value.replace(/^([A-Za-z]):\\/, (_match, drive: string) => `/${drive.toLowerCase()}/`).replace(/\\/g, "/");
}

function fromGitShellPath(value: string) {
  if (process.platform !== "win32") return value;
  return value.replace(/^\/([a-zA-Z])\//, (_match, drive: string) => `${drive.toUpperCase()}:\\`).replace(/\//g, "\\");
}

function rewriteWindowsPathsForGitShell(script: string) {
  if (process.platform !== "win32") return script;
  return script.replace(/([A-Za-z]):\\([^'"\s]*)/g, (_match, drive: string, rest: string) =>
    `/${drive.toLowerCase()}/${rest.replace(/\\/g, "/")}`,
  );
}

function prepareTestCommandForRunChildProcess(command: string, args: string[]) {
  if (command === "bash" || command === "sh") {
    const nextArgs = [...args];
    if ((nextArgs[0] === "-lc" || nextArgs[0] === "-c") && typeof nextArgs[1] === "string") {
      nextArgs[1] = rewriteWindowsPathsForGitShell(nextArgs[1]);
    }
    return {
      command: resolveTestPosixShellCommand(command),
      args: nextArgs,
    };
  }

  const localCommand = fromGitShellPath(command);
  if (process.platform === "win32" && /(?:^|[\\/])(?:agent|cursor-agent)$/.test(localCommand)) {
    return {
      command: resolveTestPosixShellCommand("bash"),
      args: [localCommand, ...args],
    };
  }

  return { command: localCommand, args };
}

function buildFakeAgentScript(): string {
  return `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'Cursor Agent 1.2.3'
  exit 0
fi
printf '%s\\n' '{"type":"system","subtype":"init","session_id":"cursor-session-envtest-1","model":"auto"}'
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"output_text","text":"hello"}]}}'
printf '%s\\n' '{"type":"result","subtype":"success","session_id":"cursor-session-envtest-1","result":"ok"}'
`;
}

function buildInstallSimulationCommand(commandPath: string): string {
  return [
    `mkdir -p ${JSON.stringify(path.dirname(commandPath))}`,
    `cat > ${JSON.stringify(commandPath)} <<'EOF'`,
    buildFakeAgentScript(),
    "EOF",
    `chmod +x ${JSON.stringify(commandPath)}`,
  ].join("\n");
}

function createSandboxRunner(options: { homeDir: string; installCommandPath: string }) {
  let counter = 0;
  const installCommands: string[] = [];
  const systemPath = "/usr/bin:/bin";
  return {
    installCommands,
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
      counter += 1;
      const preparedCommand = prepareTestCommandForRunChildProcess(input.command, input.args ?? []);
      const args = preparedCommand.args;
      if (args[1] === SANDBOX_INSTALL_COMMAND) {
        installCommands.push(args[1]);
        args[1] = buildInstallSimulationCommand(options.installCommandPath);
        if ((input.command === "bash" || input.command === "sh") && (args[0] === "-lc" || args[0] === "-c")) {
          args[1] = rewriteWindowsPathsForGitShell(args[1]);
        }
      }
      return await runChildProcess(`cursor-envtest-runner-${counter}`, preparedCommand.command, args, {
        cwd: fromGitShellPath(input.cwd ?? process.cwd()),
        env: {
          ...(input.env ?? {}),
          HOME: input.env?.HOME ?? toGitShellPath(options.homeDir),
          PATH: input.env?.PATH ?? systemPath,
        },
        stdin: input.stdin,
        timeoutSec: Math.max(1, Math.ceil((input.timeoutMs ?? 30_000) / 1000)),
        graceSec: 5,
        onLog: input.onLog ?? (async () => {}),
        onSpawn: input.onSpawn
          ? async (meta) => input.onSpawn?.({ pid: meta.pid, startedAt: meta.startedAt })
          : undefined,
      });
    },
  };
}

describe("cursor testEnvironment", () => {
  it("shows the probe failure after an informational retrieval trace notice", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-cursor-probe-diagnostic-"));
    const command = path.join(root, "agent");
    await fs.writeFile(command, `#!/usr/bin/env node
if (process.argv.includes("--version")) { console.log("Cursor Agent 1.2.3"); process.exit(0); }
console.error("cursor-retrieval: tracing to '/tmp/fixture.log'");
console.error("Provider connection failed");
process.exit(7);
`, { mode: 0o755 });
    try {
      const result = await testEnvironment({
        companyId: "company-1", adapterType: "cursor",
        config: { command, cwd: root, env: { PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`, CURSOR_API_KEY: "fixture-cursor-key" } },
      });
      expect(result.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "cursor_hello_probe_failed", detail: "Provider connection failed" }),
      ]));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("re-resolves the installed agent under ~/.cursor/bin and verifies --version before the hello probe", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-cursor-envtest-"));
    const homeDir = path.join(root, "home");
    const workspace = path.join(root, "workspace");
    const remoteWorkspace = toGitShellPath(path.join(root, "remote-workspace"));
    const agentPath = path.join(homeDir, ".cursor", "bin", "agent");
    const remoteAgentPath = toGitShellPath(agentPath);
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(fromGitShellPath(remoteWorkspace), { recursive: true });

    const runner = createSandboxRunner({
      homeDir,
      installCommandPath: remoteAgentPath,
    });

    try {
      const result = await testEnvironment({
        companyId: "company-1",
        adapterType: "cursor",
        config: {
          command: "agent",
          cwd: remoteWorkspace,
          env: {
            PATH: "/usr/bin:/bin",
          },
        },
        executionTarget: {
          kind: "remote",
          transport: "sandbox",
          shellCommand: "bash",
          remoteCwd: remoteWorkspace,
          runner,
          timeoutMs: 30_000,
        },
      });

      expect(result.status).toBe("pass");
      expect(runner.installCommands).toEqual([SANDBOX_INSTALL_COMMAND]);
      expect(result.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "cursor_command_resolvable",
            level: "info",
            message: `Command is executable: ${remoteAgentPath}`,
          }),
          expect.objectContaining({
            code: "cursor_version_probe_passed",
            level: "info",
            detail: "Cursor Agent 1.2.3",
          }),
          expect.objectContaining({
            code: "cursor_hello_probe_passed",
            level: "info",
          }),
        ]),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

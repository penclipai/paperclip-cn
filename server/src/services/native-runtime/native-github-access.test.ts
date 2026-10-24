import { afterEach, expect, it, vi } from "vitest";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { CommandManagedDuplexChannel, CommandManagedRuntimeRunner } from "@penclipai/adapter-utils/command-managed-runtime";
import { startAdapterExecutionTargetPaperclipBridge } from "@penclipai/adapter-utils/execution-target";

import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { prepareTestPosixShell } from "@penclipai/adapter-utils/test-fixtures/posix-shell";
import { createNativeGitHubAccess, type NativeGitHubAccess } from "./native-github-access.js";
import { OpenCodeServerDriver } from "@penclipai/paperclip-runner";
import { createCapabilityRunnerdProviderEnvironment } from "@penclipai/paperclip-runner/live";
const scope = { companyId: "company-a", agentId: "agent-a", issueId: "task-a" };
const run = (runId: string) => ({ ...scope, runId });
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}

function toPosixFixturePath(value: string) {
  if (process.platform !== "win32") return value;
  return value
    .replace(/^([A-Za-z]):[\\/]/, (_match, drive: string) => `/${drive.toLowerCase()}/`)
    .replaceAll("\\", "/");
}

function toHostFixturePath(value: string) {
  if (process.platform !== "win32") return value;
  return value.replace(/^\/([A-Za-z])\//, (_match, drive: string) => `${drive.toUpperCase()}:\\`).replaceAll("/", "\\");
}
function localDuplexChannel(command: readonly string[], cwd: string): CommandManagedDuplexChannel {
  const executable = command[0] === "sh" && process.platform === "win32"
    ? ["C:\\Program Files\\Git\\usr\\bin\\sh.exe", "C:\\Program Files\\Git\\bin\\bash.exe"].find(existsSync) ?? command[0]
    : command[0]!;
  const child = spawn(executable, command.slice(1), { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const buffered: Buffer[] = [];
  let dataListener: ((chunk: Uint8Array) => void) | undefined;
  let exitListener: ((exit: { exitCode: number | null }) => void) | undefined;
  let exit: { exitCode: number | null } | undefined;
  child.stdin.on("error", () => undefined);
  child.stderr.resume();
  child.stdout.on("data", (chunk: Buffer) => dataListener ? dataListener(chunk) : buffered.push(chunk));
  const closed = new Promise<void>(resolve => child.once("close", code => {
    exit = { exitCode: code };
    exitListener?.(exit);
    resolve();
  }));
  return {
    write: data => { child.stdin.write(data); },
    onData: listener => { dataListener = listener; for (const chunk of buffered.splice(0)) listener(chunk); },
    onExit: listener => { exitListener = listener; if (exit) listener(exit); },
    stop: () => { child.kill(); },
    close: async () => { child.kill(); await closed; },
  };
}

async function broker(resolveCredentials = vi.fn(async (binding: ReturnType<typeof run>) => ({
  status: "available", env: { GH_TOKEN: `fixture-${binding.runId}` },
})), remote = false, bridgeUnavailable = false, onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>,
duplex?: { enabled?: boolean; capability: boolean; unavailable?: boolean }) {
  const root = await mkdtemp(path.join(tmpdir(), "native-github-reuse-"));
  const bin = path.join(root, "real-bin");
  const remoteRoot = toPosixFixturePath(root);
  const remoteBin = toPosixFixturePath(bin);
  const nodeBin = toPosixFixturePath(path.dirname(process.execPath));
  let bridgeChild: ChildProcess | null = null;
  let bridgeClose: Promise<void> | null = null;
  let bridgeSpawnError: Error | null = null;
  let bridgeControl: { entrypoint: string; pidFile: string; readyFile: string } | null = null;
  const stopOwnedBridge = async () => {
    if (!bridgeChild || !bridgeClose) return;
    if (bridgeChild.exitCode === null && bridgeChild.signalCode === null && !bridgeChild.kill()) {
      throw new Error("fixture bridge child could not be stopped");
    }
    await bridgeClose;
    if (bridgeSpawnError) throw bridgeSpawnError;
  };
  cleanups.push(async () => {
    await stopOwnedBridge();
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(bin);
  const ghSource = "process.stdout.write(process.env.GH_TOKEN || 'anonymous');\n";
  if (process.platform === "win32") {
    await writeFile(path.join(bin, "gh.fixture.cjs"), ghSource);
    await writeFile(path.join(bin, "gh.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0gh.fixture.cjs" %*\r\n`);
  } else {
    await writeFile(path.join(bin, "gh"), `#!${process.execPath}\n${ghSource}`, { mode: 0o700 });
  }
  const fixturePath = remote
    ? `${remoteBin}:${nodeBin}:/usr/bin:/bin`
    : [bin, path.dirname(process.execPath)].join(path.delimiter);
  const execute = vi.fn<CommandManagedRuntimeRunner["execute"]>(async (input) => {

    const startedAt = new Date().toISOString();
    const directScript = process.platform === "win32" && path.isAbsolute(input.command) && !/\.(?:exe|cmd|bat)$/i.test(input.command);
    const command = directScript ? "sh" : input.command;
    const args = directScript
      ? ["-c", `exec ${shellQuote(toPosixFixturePath(input.command))} "$@"`, "--", ...(input.args ?? [])]
      : input.args;
    const remoteEnv = Object.fromEntries(Object.entries(input.env ?? {}).map(([key, value]) => [
      key,
      typeof value === "string" && process.platform === "win32" ? value.replace(root, remoteRoot).replaceAll("\\", "/") : value,
    ]));
    const prepared = prepareTestPosixShell({ command, args, env: { ...process.env, ...remoteEnv, PATH: remote ? fixturePath : remoteEnv.PATH } });
    const executePrepared = async (preparedArgs = prepared.args) => {
      const child = promisify(execFile)(prepared.command, preparedArgs, {
        cwd: input.cwd ?? root, env: prepared.env, timeout: 15_000, maxBuffer: 4 * 1024 * 1024,
      });
      child.child.stdin?.on("error", () => undefined);
      child.child.stdin?.end(input.stdin ?? "");
      return await child;
    };
    const script = args?.find(argument => argument.includes("paperclip-bridge-server.mjs"));
    const stopScript = prepared.args.find(argument => argument.includes('kill "$pid"'));
    const bridgeChannel = input.env?.PAPERCLIP_SANDBOX_EXEC_CHANNEL === "bridge";
    const startMatch = script?.match(/nohup 'node' '([^']*\/paperclip-bridge-server\.mjs)'[\s\S]*\npid=\$!/);
    const resetMatch = script?.match(/rm -f '([^']*\/ready\.json)' '([^']*\/server\.pid)'/);
    if (remote && process.platform === "win32" && bridgeChannel && startMatch && resetMatch && !bridgeChild) {
      const preparedArgs = prepared.args.map(argument => argument.includes("paperclip-bridge-server.mjs")
        ? argument.replace(/^.*paperclip-bridge-server\.mjs.*$/m, ":").replace(/^pid=\$!$/m, "pid=0")
        : argument);
      const entrypoint = toHostFixturePath(startMatch[1]!);
      const readyFile = toHostFixturePath(resetMatch[1]!);
      const pidFile = toHostFixturePath(resetMatch[2]!);
      const queueDir = path.dirname(readyFile);
      const isWithinRoot = (candidate: string) => {
        const relative = path.relative(root, candidate);
        return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
      };
      if (!isWithinRoot(entrypoint) || !isWithinRoot(readyFile) || !isWithinRoot(pidFile) ||
          path.dirname(pidFile) !== queueDir || path.dirname(queueDir) !== path.dirname(path.dirname(entrypoint))) {
        throw new Error("fixture bridge control paths escaped their generated runtime");
      }
      await executePrepared(preparedArgs);
      bridgeControl = { entrypoint, readyFile, pidFile };
      const nativeEnv = Object.fromEntries(Object.entries(input.env ?? {}).map(([key, value]) => [
        key, typeof value === "string" ? value.replaceAll(remoteRoot, root) : value,
      ]));
      bridgeChild = spawn(process.execPath, [entrypoint], { cwd: root, env: { ...process.env, ...nativeEnv }, stdio: "ignore", windowsHide: true });
      bridgeClose = new Promise<void>(resolve => {
        bridgeChild!.once("close", () => resolve());
        bridgeChild!.once("error", error => { bridgeSpawnError ??= error; });
      });
      await new Promise<void>((resolve, reject) => {
        bridgeChild!.once("spawn", resolve);
        bridgeChild!.once("error", reject);
      });
      await writeFile(pidFile, `${bridgeChild.pid}\n`);
      return { stdout: `${JSON.stringify({ pid: bridgeChild.pid })}\n`, stderr: "", exitCode: 0, signal: null, timedOut: false, pid: null, startedAt };
    }
    const ownedBridgeControl = bridgeControl;
    const isOwnedBridgeStop = remote && process.platform === "win32" && bridgeChannel && ownedBridgeControl && stopScript?.includes(`if [ -s '${toPosixFixturePath(ownedBridgeControl.pidFile)}' ]; then`) && stopScript.includes(`rm -f '${toPosixFixturePath(ownedBridgeControl.pidFile)}' '${toPosixFixturePath(ownedBridgeControl.readyFile)}'`);
    if (isOwnedBridgeStop) {
      await stopOwnedBridge();
      const result = await executePrepared(["-c", `rm -f ${shellQuote(toPosixFixturePath(ownedBridgeControl.pidFile))} ${shellQuote(toPosixFixturePath(ownedBridgeControl.readyFile))}`]);
      return { ...result, exitCode: 0, signal: null, timedOut: false, pid: null, startedAt };
    }
    const result = await executePrepared();
    return { ...result, exitCode: 0, signal: null, timedOut: false, pid: null, startedAt };
  });
  const openDuplexChannel = vi.fn<NonNullable<CommandManagedRuntimeRunner["openDuplexChannel"]>>(async input => {
    if (duplex?.unavailable) throw new Error("fixture channel unavailable");
    return localDuplexChannel(input.command, root);
  });
  const target = remote ? { kind: "remote" as const, transport: "sandbox" as const, providerKey: "test",
    remoteCwd: root, runner: { execute, ...(duplex ? { openDuplexChannel } : {}) }, streamRunLogs: false,
    ...(duplex ? { enableSandboxDuplexBridge: duplex.enabled, effectiveCapabilities: {
      reusableLeases: true, nativeSyncIn: false, nativeSyncOut: false, persistentProcessSessions: false,
      independentControlCommands: true, incrementalSessionOutput: false, concurrentSyncOperations: false,
      duplexCommandStream: duplex.capability, runnerWebSocketIngress: false,
    } } : {}) } : null;
  const bridgeModes: (string | undefined)[] = [];
  const result = await createNativeGitHubAccess({ scope, target, cwd: root,
    env: { PATH: fixturePath, PAPERCLIP_API_KEY: "old-run-api-key" }, resolveCredentials, onLog },
    bridgeUnavailable ? async () => { throw new Error("fixture bridge unavailable"); } : async input => {
      const bridge = await startAdapterExecutionTargetPaperclipBridge(input);
      bridgeModes.push(bridge?.env.PAPERCLIP_API_BRIDGE_MODE);
      return bridge;
    });

  cleanups.push(result.stop);
  // The remote fixture executes POSIX commands through Git Bash, but its live
  // parent is a native Windows Node process. Keep its executable lookup PATH
  // native while the staged remote environment remains POSIX.
  const parentEnv = remote && process.platform === "win32"
    ? { ...result.env, PATH: [result.env.PAPERCLIP_GITHUB_LAUNCHER_DIR, bin, path.dirname(process.execPath)].join(path.delimiter) }
    : result.env;
  return Object.assign(result, { root, resolveCredentials, execute, openDuplexChannel, bridgeModes, parentEnv });

}
function request(broker: NativeGitHubAccess, extra: RequestInit = {}, endpoint = "/runtime-tools/github/credentials") {
  return fetch(broker.env.PAPERCLIP_GITHUB_BROKER_URL + endpoint, {
    method: "POST", body: "{}", headers: { authorization: `Bearer ${broker.env.PAPERCLIP_GITHUB_BRIDGE_TOKEN}`, "content-type": "application/json" }, ...extra,
  });
}

it.runIf(process.platform === "win32")("uses the native PATH delimiter for local GitHub launchers", async () => {
  const b = await broker();
  expect(b.env.PATH.startsWith(`${b.env.PAPERCLIP_GITHUB_LAUNCHER_DIR}${path.delimiter}`)).toBe(true);
});

it.each([false, true])("resolves managed GitHub credentials from OpenCode shell operations (runner projection: %s)", async throughRunner => {
  const b = await broker();
  const command = path.join(b.root, "fake-opencode-server.mjs");
  const fixture = new URL("../../../../packages/paperclip-runner/test/fixtures/fake-opencode-server.mjs", import.meta.url);
  await writeFile(command, await readFile(fixture), { mode: 0o700 });
  const source = { ...b.env, OPENROUTER_API_KEY: "fixture-provider-key", PAPERCLIP_API_KEY: "controller-must-not-cross" };
  const environment = throughRunner ? createCapabilityRunnerdProviderEnvironment({
    provider: "opencode",
    options: { environment: source, stateDirectory: b.root },
    identity: { runnerInstanceId: "runner-a", environmentLeaseId: "lease-a", runId: "a", normalizedSessionId: "github", turnId: "turn-a", itemId: "item-a" },
    codexHome: path.join(b.root, "codex-home"),
    runtimeContextPath: path.join(b.root, "context.json"),
    hasRuntimeContext: false,
  }) : source;
  const driver = new OpenCodeServerDriver({
    model: "openrouter/z-ai/glm-5.3", runtimeDirectory: b.root, command, environment,
  });
  const session = await driver.openSession({ runId: "a", normalizedSessionId: "github", workingDirectory: b.root });
  cleanups.push(() => session.close({ reason: "test complete" }));
  const operate = async () => {
    await session.startTurn({ message: { role: "user", text: "managed-github-operation" } });
    for await (const event of session.events()) {
      if (event.eventType === "turn.completed") break;
      if (event.eventType === "turn.failed") throw new Error("OpenCode fixture turn failed");
    }
    return JSON.parse(await readFile(path.join(b.root, "github", "data", "fake-github-operation.json"), "utf8"));
  };
  const releaseA = b.activate(run("a"));
  expect(await operate()).toMatchObject({ stdout: "fixture-a", error: null });
  releaseA();
  const releaseB = b.activate(run("b"));
  expect(await operate()).toMatchObject({ stdout: "fixture-b", error: null });
  releaseB();
  expect(await operate()).toMatchObject({ stdout: "anonymous", error: null });
  expect(b.resolveCredentials.mock.calls.map(([binding]) => binding.runId)).toEqual(["a", "b"]);
  const childEnvironment = JSON.parse(await readFile(path.join(b.root, "github", "data", "fake-environment.json"), "utf8"));
  expect(childEnvironment.keys).not.toContain("PAPERCLIP_API_KEY");
  expect(childEnvironment.githubTokenPresent).toBe(false);
}, 30000);
it("uses the selected duplex transport across credential rotation without file polling", async () => {
  const b = await broker(undefined, true, false, undefined, { enabled: true, capability: true });
  expect(b.bridgeModes).toEqual(["http2_v1"]);
  expect(b.openDuplexChannel).toHaveBeenCalledOnce();
  const commandsAfterStartup = b.execute.mock.calls.length;
  expect((await request(b)).status).toBe(403);
  const releaseA = b.activate(run("a"));
  expect(await (await request(b)).json()).toMatchObject({ env: { GH_TOKEN: "fixture-a" } });
  releaseA();
  expect((await request(b)).status).toBe(403);
  const releaseB = b.activate(run("b"));
  releaseA();
  expect(await (await request(b)).json()).toMatchObject({ env: { GH_TOKEN: "fixture-b" } });
  expect(b.resolveCredentials.mock.calls.map(([binding]) => binding.runId)).toEqual(["a", "b"]);
  expect(b.execute.mock.calls).toHaveLength(commandsAfterStartup);
  releaseB();
  await b.stop();
  expect(() => b.activate(run("c"))).toThrow("closed");
});
it("marks a lost HTTP/2 bridge unavailable before the next warm admission", async () => {
  const b = await broker(undefined, true, false, undefined, { enabled: true, capability: true });
  const release = b.activate(run("a"));
  expect((await request(b)).status).toBe(200);
  release();
  expect(b.ready).toBe(true);
  const channel = await b.openDuplexChannel.mock.results[0]!.value;
  channel.stop();
  await vi.waitFor(() => expect(b.ready).toBe(false), { timeout: 2000 });
});
it("closes a healthy HTTP/2 bridge without reporting a lost active run", async () => {
  const onLog = vi.fn(async (_stream: "stdout" | "stderr", _chunk: string) => undefined);
  const b = await broker(undefined, true, false, onLog, { enabled: true, capability: true });
  const release = b.activate(run("a"));
  expect((await request(b)).status).toBe(200);
  release();
  await b.stop();
  expect(b.ready).toBe(false);
  expect(onLog.mock.calls.filter(([, chunk]) => chunk.includes("channel lost"))).toEqual([]);
});
it.each([
  { enabled: false, capability: true, unavailable: false, opens: 0 },
  { enabled: undefined, capability: true, unavailable: false, opens: 0 },
  { enabled: true, capability: false, unavailable: false, opens: 0 },
  { enabled: true, capability: true, unavailable: true, opens: 1 },
])("retains authorized file fallback with duplex settings %j", async options => {
  const b = await broker(undefined, true, false, undefined, options);
  expect(b.bridgeModes).toEqual(["queue_v1"]);
  expect(b.openDuplexChannel).toHaveBeenCalledTimes(options.opens);
  const release = b.activate(run("fallback"));
  expect(await (await request(b)).json()).toMatchObject({ env: { GH_TOKEN: "fixture-fallback" } });
  release();
  expect((await request(b)).status).toBe(403);
});

it.each([false, true])("keeps one live parent and its original launcher environment across two authorized runs (callback bridge: %s)", async (remote) => {
  const b = await broker(undefined, remote);
  const parent = spawn(process.execPath, ["-e", `
    const {execFile}=require('node:child_process');
    require('node:readline').createInterface({input:process.stdin}).on('line', () => {
      execFile(process.execPath, [process.env.PAPERCLIP_FIXTURE_LAUNCHER], (error, stdout, stderr) => console.log(JSON.stringify({pid:process.pid, value:stdout, error:error?.message, stderr})));
    });
  `], { env: { ...process.env, ...b.parentEnv, PAPERCLIP_API_KEY: "stale-api-key",
    PAPERCLIP_FIXTURE_LAUNCHER: path.join(b.env.PAPERCLIP_GITHUB_LAUNCHER_DIR, "gh") }, stdio: ["pipe", "pipe", "pipe"] });
  const parentClose = new Promise<void>(resolve => parent.once("close", () => resolve()));
  const lines = createInterface({ input: parent.stdout });
  cleanups.push(async () => {
    parent.stdin.end();
    if (parent.exitCode === null && parent.signalCode === null && !parent.kill()) throw new Error("fixture parent could not be stopped");
    await parentClose;
    lines.close();
  });
  const operation = () => new Promise<{ pid: number; value: string; error?: string; stderr: string }>(resolve => {
    lines.once("line", line => resolve(JSON.parse(line))); parent.stdin.write("run\n");
  });
  expect((await request(b)).status).toBe(403);
  const releaseA = b.activate(run("run-a"));
  const a = await operation();
  expect({ error: a.error, stderr: a.stderr }).toEqual({ error: undefined, stderr: "" });
  expect(a.value).toBe("fixture-run-a");
  releaseA();
  expect((await operation()).value).toBe("anonymous");
  const releaseB = b.activate(run("run-b"));
  releaseA(); // A's delayed cleanup cannot revoke B.
  const second = await operation();
  expect(second.value).toBe("fixture-run-b");
  expect(second.pid).toBe(a.pid);
  expect(b.resolveCredentials.mock.calls.map(([binding]) => binding.runId)).toEqual(["run-a", "run-b"]);
  expect(await readFile(path.join(b.env.PAPERCLIP_GITHUB_LAUNCHER_DIR, "gh"), "utf8")).not.toContain(b.env.PAPERCLIP_GITHUB_BROKER_TOKEN);
  releaseB(); await b.stop();
  await expect(access(b.env.PAPERCLIP_GITHUB_LAUNCHER_DIR)).rejects.toThrow();
}, 45_000);
it("rejects other scopes, concurrent bindings, browser requests and forged authority", async () => {
  const b = await broker();
  for (const field of ["companyId", "agentId", "issueId"] as const) {
    expect(() => b.activate({ ...run("a"), [field]: "other" })).toThrow("scope mismatch");
  }
  const release = b.activate(run("a"));
  expect(() => b.activate(run("b"))).toThrow("busy");
  const rejectedHeaders: Record<string, string>[] = [{ authorization: "Bearer wrong" }, { authorization: "é".repeat(71) },
    { authorization: `Bearer ${b.env.PAPERCLIP_GITHUB_BRIDGE_TOKEN}`, origin: "https://browser.test" }];
  for (const headers of rejectedHeaders) {
    expect((await request(b, { headers })).status).toBe(403);
  }
  expect((await request(b, {}, "/api/companies")).status).toBe(404);
  expect((await request(b, { method: "GET", body: undefined })).status).toBe(404);
  const response = await request(b, { body: JSON.stringify({ runId: "b", responsibleUserId: "other" }) });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(b.resolveCredentials).toHaveBeenCalledExactlyOnceWith(run("a"));
  release(); await b.stop();
  expect(() => b.activate(run("b"))).toThrow("closed");
});
it("does not release an in-flight credential after its run has been replaced", async () => {
  let complete!: (value: { status: string; env: { GH_TOKEN: string } }) => void;
  const resolver = vi.fn(() => new Promise<{ status: string; env: { GH_TOKEN: string } }>(resolve => { complete = resolve; }));
  const b = await broker(resolver);
  const release = b.activate(run("a"));
  const pending = request(b);
  await vi.waitFor(() => expect(resolver).toHaveBeenCalledOnce());
  release(); b.activate(run("b"));
  complete({ status: "available", env: { GH_TOKEN: "must-not-escape" } });
  const response = await pending;
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain("must-not-escape");
});
it.each([403, 409, 500])("preserves denial/steering without leaking errors (%s)", async (status) => {
  const b = await broker(vi.fn(async () => { throw Object.assign(new Error("secret-value"), { status }); }));
  b.activate(run("a"));
  const response = await request(b);
  expect(response.status).toBe(status === 500 ? 503 : status);
  expect(await response.text()).not.toContain("secret-value");
});

it.each([false, true])("keeps anonymous launchers usable when the remote broker cannot start (logging fails: %s)", async (loggingFails) => {
  const onLog = vi.fn(async () => { if (loggingFails) throw new Error("fixture log sink unavailable"); });
  const b = await broker(undefined, true, true, onLog);
  expect(onLog).toHaveBeenCalledWith("stderr", expect.stringContaining("continuing without managed GitHub access"));
  b.activate(run("a"));
  expect(b.ready).toBe(false);
  expect(b.env.PAPERCLIP_GITHUB_BROKER_TOKEN).toBe("");
  const result = await b.execute({ command: path.join(b.env.PAPERCLIP_GITHUB_LAUNCHER_DIR, "gh"),
    env: { ...b.env, GH_TOKEN: "ambient-must-not-leak" } });
  expect(result.stdout).toBe("anonymous");
  expect(b.resolveCredentials).not.toHaveBeenCalled();
});

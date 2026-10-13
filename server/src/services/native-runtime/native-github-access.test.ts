import { afterEach, expect, it, vi } from "vitest";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { promisify } from "node:util";
import type { CommandManagedRuntimeRunner } from "@penclipai/adapter-utils/command-managed-runtime";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { prepareTestPosixShell } from "@penclipai/adapter-utils/test-fixtures/posix-shell";
import { createNativeGitHubAccess, type NativeGitHubAccess } from "./native-github-access.js";
const scope = { companyId: "company-a", agentId: "agent-a", issueId: "task-a" };
const run = (runId: string) => ({ ...scope, runId });
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try { await cleanup(); } catch (error) { errors.push(error); }
  }
  if (errors.length > 0) throw new AggregateError(errors, "native GitHub fixture cleanup failed");
});

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

async function broker(resolveCredentials = vi.fn(async (binding: ReturnType<typeof run>) => ({
  status: "available", env: { GH_TOKEN: `fixture-${binding.runId}` },
})), remote = false, bridgeUnavailable = false, onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>) {
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
  const execute: CommandManagedRuntimeRunner["execute"] = async (input) => {
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
    const isOwnedBridgeStop = remote && process.platform === "win32" && bridgeChannel && bridgeControl && stopScript?.includes(`if [ -s '${toPosixFixturePath(bridgeControl.pidFile)}' ]; then`) && stopScript.includes(`rm -f '${toPosixFixturePath(bridgeControl.pidFile)}' '${toPosixFixturePath(bridgeControl.readyFile)}'`);
    if (isOwnedBridgeStop) {
      await stopOwnedBridge();
      const result = await executePrepared(["-c", `rm -f ${shellQuote(toPosixFixturePath(bridgeControl.pidFile))} ${shellQuote(toPosixFixturePath(bridgeControl.readyFile))}`]);
      return { ...result, exitCode: 0, signal: null, timedOut: false, pid: null, startedAt };
    }
    const result = await executePrepared();
    return { ...result, exitCode: 0, signal: null, timedOut: false, pid: null, startedAt };
  };
  const target = remote ? { kind: "remote" as const, transport: "sandbox" as const, providerKey: "test",
    remoteCwd: root, runner: { execute }, streamRunLogs: false } : null;
  const result = await createNativeGitHubAccess({ scope, target, cwd: root,
    env: { PATH: fixturePath, PAPERCLIP_API_KEY: "old-run-api-key" }, resolveCredentials, onLog },
    bridgeUnavailable ? async () => { throw new Error("fixture bridge unavailable"); } : undefined);
  cleanups.push(result.stop);
  // The remote fixture executes POSIX commands through Git Bash, but its live
  // parent is a native Windows Node process. Translate only that test-host
  // process's executable lookup path; the staged remote environment stays
  // POSIX and is exercised through `execute` above.
  const parentEnv = remote && process.platform === "win32"
    ? { ...result.env, PATH: [result.env.PAPERCLIP_GITHUB_LAUNCHER_DIR, bin, path.dirname(process.execPath)].join(path.delimiter) }
    : result.env;
  return { ...result, root, resolveCredentials, execute,
    // The launcher is a native Node process, so it must retain the Windows
    // delimiter in PATH to resolve the fixture's gh.cmd sibling.
    parentEnv };
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

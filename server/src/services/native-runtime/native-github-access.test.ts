import { afterEach, expect, it, vi } from "vitest";
import { spawn, execFile } from "node:child_process";
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

async function broker(resolveCredentials = vi.fn(async (binding: ReturnType<typeof run>) => ({
  status: "available", env: { GH_TOKEN: `fixture-${binding.runId}` },
})), remote = false, bridgeUnavailable = false, onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "native-github-reuse-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "real-bin");
  const remoteRoot = toPosixFixturePath(root);
  const remoteBin = toPosixFixturePath(bin);
  const nodeBin = toPosixFixturePath(path.dirname(process.execPath));
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
    const child = promisify(execFile)(prepared.command, prepared.args, {
      cwd: input.cwd ?? root, env: prepared.env, timeout: 15_000, maxBuffer: 4 * 1024 * 1024,
    });
    child.child.stdin?.on("error", () => undefined);
    child.child.stdin?.end(input.stdin ?? "");
    const result = await child;
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
  cleanups.push(async () => { const exited = new Promise<void>(resolve => parent.once("exit", () => resolve())); parent.kill(); await exited; });
  const lines = createInterface({ input: parent.stdout });
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

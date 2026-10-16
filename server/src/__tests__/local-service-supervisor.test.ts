import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetRuntimeServicesForTests,
  resolveShell,
  startRuntimeServicesForWorkspaceControl,
} from "../services/workspace-runtime.js";
import {
  doesLocalServiceCommandLineMatch,
  findAdoptableLocalService,
  findLocalServiceRegistryRecordByRuntimeServiceId,
  isLocalServiceCommandLineComparable,
  isLocalServiceProcessOwnedBy,
  LocalServiceOwnershipQueryUnavailableError,
  listLocalServiceRegistryRecords,
  readLocalServicePortOwner,
  resolveLocalServiceLogPath,
  terminateLocalService,
  writeLocalServiceRegistryRecord,
} from "../services/local-service-supervisor.js";

const { windowsOwnershipQueryFixture } = vi.hoisted(() => ({
  windowsOwnershipQueryFixture: {
    enabled: false,
    port: 45_432,
    calls: [] as Array<{ command: string; timeout?: number }>,
  },
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const promisifyCustom = Symbol.for("nodejs.util.promisify.custom");

  const execFile = (...input: unknown[]) => {
    const [command, , options] = input;
    const callback = [...input].reverse().find((value) => typeof value === "function") as
      | ((error: Error | null, stdout: string, stderr: string) => void)
      | undefined;
    const timeout = options && typeof options === "object" && "timeout" in options
      && typeof options.timeout === "number"
      ? options.timeout
      : undefined;
    if (
      windowsOwnershipQueryFixture.enabled
      && typeof command === "string"
      && (command === "netstat" || command === "powershell.exe")
    ) {
      windowsOwnershipQueryFixture.calls.push({ command, timeout });
      if (timeout !== undefined) {
        const error = Object.assign(new Error("external ownership query timed out"), {
          code: "ETIMEDOUT",
          killed: true,
        });
        if (callback) queueMicrotask(() => callback(error, "", ""));
      } else if (command === "netstat") {
        const port = windowsOwnershipQueryFixture.port;
        if (callback) queueMicrotask(() => callback(null, `  TCP    127.0.0.1:${port}     0.0.0.0:0     LISTENING     4242\r\n`, ""));
      } else if (callback) {
        queueMicrotask(() => callback(null, "31337\r\n", ""));
      }
      return {};
    }
    return (actual.execFile as (...args: unknown[]) => unknown)(...input);
  };

  Object.defineProperty(execFile, promisifyCustom, {
    value: (...input: unknown[]) => {
      const promise = new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const callback = (error: Error | null, stdout: string, stderr: string) => {
          if (error) {
            Object.assign(error, { stdout, stderr });
            reject(error);
            return;
          }
          resolve({ stdout, stderr });
        };
        execFile(...input, callback);
      });
      return promise;
    },
  });

  return { ...actual, execFile };
});

async function canRunWorkspaceShell() {
  if (process.platform !== "win32") return true;

  // Workspace runtime commands intentionally use POSIX `-lc` semantics on
  // Windows.  The supported host shell is Git Bash (or another `sh` on PATH),
  // but a plain Windows Node installation may not expose one.  Keep this
  // shell-dependent integration test from failing with an opaque `spawn sh
  // ENOENT` when that optional host dependency is absent.
  return await new Promise<boolean>((resolve) => {
    const child = spawn(resolveShell(), ["-lc", "exit 0"], {
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
}

describe("local service supervision", () => {
  afterEach(async () => {
    windowsOwnershipQueryFixture.enabled = false;
    windowsOwnershipQueryFixture.calls = [];
    await resetRuntimeServicesForTests({ terminateProcesses: true });
  });

  it("reports Windows ownership-query timeouts to callers that require proof", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    windowsOwnershipQueryFixture.enabled = true;

    try {
      await expect(readLocalServicePortOwner(
        windowsOwnershipQueryFixture.port,
        { throwOnError: true },
      )).rejects.toBeInstanceOf(LocalServiceOwnershipQueryUnavailableError);
      await expect(isLocalServiceProcessOwnedBy(
        4242,
        31337,
        { throwOnError: true },
      )).rejects.toBeInstanceOf(LocalServiceOwnershipQueryUnavailableError);
      expect(windowsOwnershipQueryFixture.calls).toEqual([
        { command: "netstat", timeout: 2_000 },
        { command: "powershell.exe", timeout: 2_000 },
      ]);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  it("preserves an unverified Windows registry record instead of treating a timed-out listener query as absent", async () => {
    const paperclipHome = await fs.mkdtemp(path.join(process.env.TEMP ?? os.tmpdir(), "paperclip-ownership-timeout-"));
    const previousPaperclipHome = process.env.PAPERCLIP_HOME;
    const previousInstanceId = process.env.PAPERCLIP_INSTANCE_ID;
    const originalPlatform = process.platform;
    const runtimeServiceId = randomUUID();
    const serviceKey = `ownership-timeout-${randomUUID()}`;
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = `ownership-timeout-${randomUUID()}`;
    Object.defineProperty(process, "platform", { value: "win32" });
    windowsOwnershipQueryFixture.enabled = true;

    try {
      await writeLocalServiceRegistryRecord({
        version: 1,
        serviceKey,
        profileKind: "workspace-runtime",
        serviceName: "fixture",
        command: "fixture",
        cwd: process.cwd(),
        envFingerprint: "",
        port: windowsOwnershipQueryFixture.port,
        url: null,
        pid: 2_147_483_647,
        processGroupId: null,
        provider: "local_process",
        runtimeServiceId,
        reuseKey: null,
        startedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        metadata: null,
      });

      await expect(findLocalServiceRegistryRecordByRuntimeServiceId({ runtimeServiceId }))
        .rejects.toBeInstanceOf(LocalServiceOwnershipQueryUnavailableError);
      await expect(findAdoptableLocalService({
        serviceKey,
        port: windowsOwnershipQueryFixture.port,
      })).rejects.toBeInstanceOf(LocalServiceOwnershipQueryUnavailableError);
      await expect(findAdoptableLocalService({
        serviceKey: `ownership-timeout-new-${randomUUID()}`,
        port: windowsOwnershipQueryFixture.port,
      })).rejects.toBeInstanceOf(LocalServiceOwnershipQueryUnavailableError);
      await expect(listLocalServiceRegistryRecords()).resolves.toHaveLength(1);
      expect(windowsOwnershipQueryFixture.calls).toEqual([
        { command: "netstat", timeout: 2_000 },
        { command: "netstat", timeout: 2_000 },
        { command: "netstat", timeout: 2_000 },
      ]);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      if (previousPaperclipHome === undefined) delete process.env.PAPERCLIP_HOME;
      else process.env.PAPERCLIP_HOME = previousPaperclipHome;
      if (previousInstanceId === undefined) delete process.env.PAPERCLIP_INSTANCE_ID;
      else process.env.PAPERCLIP_INSTANCE_ID = previousInstanceId;
      await fs.rm(paperclipHome, { recursive: true, force: true });
    }
  });

  it("keeps request-logging runtime stdio usable after the supervisor side closes and waits for a Windows service listener to retire", async () => {
    if (!(await canRunWorkspaceShell())) return;

    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-service-stdio-"));
    const paperclipHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-service-home-"));
    const previousPaperclipHome = process.env.PAPERCLIP_HOME;
    const previousInstanceId = process.env.PAPERCLIP_INSTANCE_ID;
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = `service-stdio-${randomUUID()}`;

    // The managed service uses a login shell, whose PATH can select a different
    // Node installation from the one CI configured for this test process.
    // Git Bash accepts Windows drive paths with forward slashes.
    const nodeExecutable = process.platform === "win32"
      ? process.execPath.replace(/\\/g, "/")
      : process.execPath;
    const nodeCommand = "'" + nodeExecutable.replace(/'/g, "'\\''") + "'";
    let registryRecord: Awaited<ReturnType<typeof listLocalServiceRegistryRecords>>[number] | null = null;
    try {
      const [service] = await startRuntimeServicesForWorkspaceControl({
        actor: { id: null, name: "Board", companyId: randomUUID() },
        issue: null,
        workspace: {
          baseCwd: workspaceRoot,
          source: "agent_home",
          projectId: null,
          workspaceId: null,
          repoUrl: null,
          repoRef: null,
          strategy: "project_primary",
          cwd: workspaceRoot,
          branchName: null,
          worktreePath: null,
          warnings: [],
          created: false,
        },
        config: {
          workspaceRuntime: {
            services: [{
              name: "web",
              command: nodeCommand + " -e \"const http=require('node:http'); console.log('fixture starting', process.execPath, process.env.PORT); process.on('SIGTERM',()=>{}); http.createServer((req,res)=>{ process.stdout.write('request '+req.url+'\\\\n',(error)=>{ if (!error) res.end('ok'); }); }).listen(Number(process.env.PORT), '127.0.0.1',()=>console.log('fixture listening', process.env.PORT))\"",
              port: { type: "auto" },
              readiness: {
                type: "http",
                urlTemplate: "http://127.0.0.1:{{port}}",
                timeoutSec: 10,
                intervalMs: 100,
              },
              lifecycle: "shared",
              reuseScope: "agent",
              stopPolicy: { type: "manual" },
            }],
          },
        },
        adapterEnv: {},
      });

      expect(service?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(service?.port).toBeTypeOf("number");
      registryRecord = (await listLocalServiceRegistryRecords({ profileKind: "workspace-runtime" }))
        .find((record) => record.runtimeServiceId === service!.id) ?? null;
      expect(registryRecord).not.toBeNull();

      await resetRuntimeServicesForTests({ simulateSupervisorExit: true });

      await expect(fetch(`${service!.url}/after-restart`)).resolves.toMatchObject({ ok: true });
      const log = await fs.readFile(resolveLocalServiceLogPath(registryRecord!.serviceKey), "utf8");
      expect(log).toContain("request /after-restart");
      expect(log).toContain(process.execPath);

      await terminateLocalService(registryRecord!);
      expect(await readLocalServicePortOwner(service!.port!)).toBeNull();
      await expect(fetch(service!.url!)).rejects.toThrow();
      registryRecord = null;
    } finally {
      if (registryRecord) await terminateLocalService(registryRecord).catch(() => undefined);
      if (previousPaperclipHome === undefined) delete process.env.PAPERCLIP_HOME;
      else process.env.PAPERCLIP_HOME = previousPaperclipHome;
      if (previousInstanceId === undefined) delete process.env.PAPERCLIP_INSTANCE_ID;
      else process.env.PAPERCLIP_INSTANCE_ID = previousInstanceId;
      await fs.rm(paperclipHome, { recursive: true, force: true });
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it("does not terminate an unrelated port owner after the recorded service exits", async () => {
    const unrelatedListener = net.createServer();
    await new Promise<void>((resolve) => unrelatedListener.listen(0, "127.0.0.1", resolve));
    const address = unrelatedListener.address();
    const port = typeof address === "object" && address ? address.port : null;
    if (!port) throw new Error("Failed to allocate unrelated listener port");
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    const childExit = process.platform === "win32"
      ? new Promise<void>((resolve) => child.once("exit", () => resolve()))
      : null;

    try {
      const target = {
        pid: child.pid!,
        processGroupId: child.pid!,
        port,
      };
      if (process.platform === "win32") {
        await expect(terminateLocalService(target, { verifyAfterMs: 500 })).rejects.toThrow();
        let exitTimeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            childExit,
            new Promise<void>((_, reject) => {
              exitTimeout = setTimeout(() => {
                reject(new Error("Expected taskkill to terminate the recorded child process"));
              }, 2_000);
            }),
          ]);
        } finally {
          clearTimeout(exitTimeout);
        }
      } else {
        await terminateLocalService(target);
      }
      expect(await readLocalServicePortOwner(port)).toBe(process.pid);
    } finally {
      if (process.platform === "win32") {
        try {
          process.kill(child.pid!, "SIGKILL");
        } catch {
          // The target process was already terminated.
        }
      } else {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          // The target process group was already terminated.
        }
      }
      await new Promise<void>((resolve, reject) => {
        unrelatedListener.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("recognizes a pnpm command after the launcher becomes pnpm.cjs", () => {
    expect(doesLocalServiceCommandLineMatch({
      commandLine: "/usr/bin/node /opt/pnpm/pnpm.cjs dev -- --bind custom --bind-host 127.0.0.1",
      recordedCommand: "pnpm dev -- --bind custom --bind-host 127.0.0.1",
      serviceName: "paperclip-dev",
    })).toBe(true);
  });

  it("does not compare shell expressions with the surviving process argv", () => {
    expect(isLocalServiceCommandLineComparable(
      "env | sort > /tmp/service.env; exec pnpm dev --bind loopback",
    )).toBe(false);
    expect(isLocalServiceCommandLineComparable(
      "node -e \"process.stdout.write('left | right')\"",
    )).toBe(true);
  });

  it("does not accept a different command merely because it uses node", () => {
    expect(doesLocalServiceCommandLineMatch({
      commandLine: "/usr/bin/node /workspace/server/dist/index.js",
      recordedCommand: "pnpm dev -- --bind custom --bind-host 127.0.0.1",
      serviceName: "paperclip-dev",
    })).toBe(false);
  });

  it("does not collapse different script paths to the same basename", () => {
    expect(doesLocalServiceCommandLineMatch({
      commandLine: "/usr/bin/node /other-workspace/server.js",
      recordedCommand: "node ./server.js",
      serviceName: "web",
    })).toBe(false);
  });
});

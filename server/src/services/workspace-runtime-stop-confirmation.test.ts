import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { shellQuote } from "@penclipai/adapter-utils/ssh";

const spawnedChildren = vi.hoisted(() => [] as ChildProcess[]);
const ownedChildPorts = vi.hoisted(() => new Map<ChildProcess, number>());
const supervisorMocks = vi.hoisted(() => ({
  removeRegistry: vi.fn(),
  terminate: vi.fn(),
  actualRemoveRegistry: null as null | ((serviceKey: string) => Promise<void>),
  actualTerminate: null as null | typeof import("./local-service-supervisor.js").terminateLocalService,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      const child = actual.spawn(...args);
      spawnedChildren.push(child);
      return child;
    },
  };
});

vi.mock("./local-service-supervisor.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./local-service-supervisor.js")>();
  supervisorMocks.actualTerminate = actual.terminateLocalService;
  supervisorMocks.actualRemoveRegistry = actual.removeLocalServiceRegistryRecord;
  supervisorMocks.terminate.mockImplementation(actual.terminateLocalService);
  supervisorMocks.removeRegistry.mockImplementation(actual.removeLocalServiceRegistryRecord);
  return {
    ...actual,
    terminateLocalService: supervisorMocks.terminate,
    removeLocalServiceRegistryRecord: supervisorMocks.removeRegistry,
  };
});

import {
  listLocalServiceRegistryRecords,
} from "./local-service-supervisor.js";
import {
  resetRuntimeServicesForTests,
  startRuntimeServicesForWorkspaceControl,
  toWorkspacePosixShellPath,
  stopRuntimeServicesForExecutionWorkspace,
} from "./workspace-runtime.js";

let fixtureRoot: string;
let workspaceDir: string;

function serviceCommand() {
  const program = [
    'const http=require("node:http");',
    'const server=http.createServer((request,response)=>{',
    'if(request.url==="/shutdown"){response.end("stopping");',
    'server.close(()=>process.exit(0));return;}',
    'response.end("ok");',
    '});',
    'server.listen(Number(process.env.PORT),"127.0.0.1");',
  ].join("");
  const nodePath = toWorkspacePosixShellPath(process.execPath);
  return `${shellQuote(nodePath)} -e ${shellQuote(program)}`;
}

function runtimeInput() {
  return {
    invocationId: "stop-state",
    actor: { id: null, name: "test", companyId: "stop-state-company" },
    issue: null,
    workspace: {
      baseCwd: workspaceDir,
      source: "project_primary" as const,
      projectId: null,
      workspaceId: null,
      repoUrl: null,
      repoRef: null,
      strategy: "project_primary" as const,
      cwd: workspaceDir,
      branchName: "stop-state",
      worktreePath: null,
      warnings: [],
      created: false,
      branchCreatedByRuntime: false,
    },
    executionWorkspaceId: "stop-state-workspace",
    adapterEnv: {},
    config: {
      workspaceRuntime: {
        services: [{
          name: "shared",
          command: serviceCommand(),
          port: { type: "auto", envKey: "PORT" },
          readiness: {
            type: "http",
            urlTemplate: "http://127.0.0.1:{{port}}",
            timeoutSec: 10,
          },
        }],
      },
    },
  };
}

function stopInput(runtimeServiceId: string) {
  return {
    executionWorkspaceId: "stop-state-workspace",
    runtimeServiceId,
  };
}

function latestSpawnedChild(): ChildProcess {
  const child = spawnedChildren.at(-1);
  if (!child) throw new Error("expected the fixture service to spawn");
  return child;
}

async function startFixtureRuntime() {
  const firstSpawn = spawnedChildren.length;
  const runtimes = await startRuntimeServicesForWorkspaceControl(runtimeInput());
  const newChildren = spawnedChildren.slice(firstSpawn);
  for (const runtime of runtimes) {
    if (runtime.port === null || runtime.providerRef === null) {
      throw new Error("fixture runtime must expose its port and child PID");
    }
    const pid = Number.parseInt(runtime.providerRef, 10);
    const child = newChildren.find((candidate) => candidate.pid === pid);
    if (!child) {
      throw new Error("fixture runtime PID was not captured from the real spawn");
    }
    ownedChildPorts.set(child, runtime.port);
  }
  if (newChildren.some((child) => !ownedChildPorts.has(child))) {
    throw new Error("fixture captured a child without a verified runtime port");
  }
  return runtimes;
}

async function findRawRegistryRecord(runtimeServiceId: string) {
  const records = await listLocalServiceRegistryRecords({
    profileKind: "workspace-runtime",
  });
  return records.find((record) => record.runtimeServiceId === runtimeServiceId) ?? null;
}

function waitForExit(child: ChildProcess, timeoutMs = 5_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onExit = () => finish();
    const onError = (error: Error) => finish(error);
    const timer = setTimeout(() => {
      finish(new Error("fixture service did not exit"));
    }, timeoutMs);
    child.once("exit", onExit);
    child.once("error", onError);
    if (child.exitCode !== null || child.signalCode !== null) {
      finish();
    }
  });
}

async function ensureFixtureChildExited(child: ChildProcess) {
  const port = ownedChildPorts.get(child);
  if (port === undefined || !child.pid) {
    throw new Error("cannot prove ownership of a fixture child for cleanup");
  }
  // Every captured child has an associated ready listener. Preserve the
  // supervisor's PID/tree/listener proof even if its root already exited.
  await supervisorMocks.actualTerminate!({
    pid: child.pid,
    processGroupId: child.pid,
    port,
  });
  await waitForExit(child);
}

beforeEach(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-runtime-stop-"));
  workspaceDir = path.join(fixtureRoot, "workspace");
  await fs.mkdir(workspaceDir);
  vi.stubEnv("PAPERCLIP_HOME", path.join(fixtureRoot, "home"));
  vi.stubEnv("PAPERCLIP_INSTANCE_ID", "workspace-runtime-stop-test");
  spawnedChildren.splice(0);
  ownedChildPorts.clear();
});

afterEach(async () => {
  // Restore real supervisor behaviour before cleanup: the fixture owns all
  // child processes and registry files beneath its isolated PAPERCLIP_HOME.
  supervisorMocks.terminate.mockReset();
  supervisorMocks.removeRegistry.mockReset();
  supervisorMocks.terminate.mockImplementation(supervisorMocks.actualTerminate!);
  supervisorMocks.removeRegistry.mockImplementation(supervisorMocks.actualRemoveRegistry!);
  let allChildrenExited = false;
  try {
    await resetRuntimeServicesForTests({ terminateProcesses: true });
    await Promise.all(spawnedChildren.map(ensureFixtureChildExited));
    allChildrenExited = true;
  } finally {
    vi.unstubAllEnvs();
    if (allChildrenExited) {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  }
});

describe("workspace runtime explicit stop confirmation", () => {
  it("keeps a rejected stop unverified after actual child exit and blocks reuse", async () => {
    supervisorMocks.terminate.mockRejectedValueOnce(new Error("termination rejected"));
    const [runtime] = await startFixtureRuntime();
    const child = latestSpawnedChild();

    await expect(findRawRegistryRecord(runtime!.id))
      .resolves.toMatchObject({ runtimeServiceId: runtime!.id });
    await expect(stopRuntimeServicesForExecutionWorkspace(stopInput(runtime!.id)))
      .rejects.toThrow("termination rejected");

    const exited = waitForExit(child);
    await fetch(`${runtime!.url}/shutdown`);
    await exited;

    await expect(findRawRegistryRecord(runtime!.id))
      .resolves.toMatchObject({ runtimeServiceId: runtime!.id });
    await expect(startFixtureRuntime())
      .rejects.toThrow("workspace_runtime_stop_unverified");
    expect(spawnedChildren).toHaveLength(1);
  });

  it("single-flights concurrent stops, then retries with real termination", async () => {
    let rejectTermination!: (error: Error) => void;
    supervisorMocks.terminate.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => {
        rejectTermination = reject;
      }),
    );
    const [runtime] = await startFixtureRuntime();

    const first = stopRuntimeServicesForExecutionWorkspace(stopInput(runtime!.id));
    const second = stopRuntimeServicesForExecutionWorkspace(stopInput(runtime!.id));
    await vi.waitFor(() => {
      expect(supervisorMocks.terminate).toHaveBeenCalledTimes(1);
    });

    rejectTermination(new Error("termination rejected"));
    await expect(Promise.all([first, second])).rejects.toThrow("termination rejected");

    await expect(stopRuntimeServicesForExecutionWorkspace(stopInput(runtime!.id)))
      .resolves.toBeUndefined();
    expect(supervisorMocks.terminate).toHaveBeenCalledTimes(2);
    await expect(stopRuntimeServicesForExecutionWorkspace(stopInput(runtime!.id)))
      .resolves.toBeUndefined();
    expect(supervisorMocks.terminate).toHaveBeenCalledTimes(2);
    await expect(findRawRegistryRecord(runtime!.id)).resolves.toBeNull();
  });

  it("blocks replacement while successful stop finalization is still pending", async () => {
    const [runtime] = await startFixtureRuntime();
    let releaseRegistryRemoval!: () => void;
    const registryRemoval = new Promise<void>((resolve) => {
      releaseRegistryRemoval = resolve;
    });
    supervisorMocks.removeRegistry.mockImplementationOnce(async (serviceKey: string) => {
      await registryRemoval;
      await supervisorMocks.actualRemoveRegistry!(serviceKey);
    });

    const stop = stopRuntimeServicesForExecutionWorkspace(stopInput(runtime!.id));
    await vi.waitFor(() => {
      expect(supervisorMocks.removeRegistry).toHaveBeenCalledTimes(1);
    });

    await expect(startFixtureRuntime())
      .rejects.toThrow("workspace_runtime_stop_unverified");
    releaseRegistryRemoval();
    await expect(stop).resolves.toBeUndefined();

    await expect(startFixtureRuntime()).resolves.toHaveLength(1);
  });
});

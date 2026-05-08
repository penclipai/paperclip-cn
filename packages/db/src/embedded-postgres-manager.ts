import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ensurePostgresDatabase, getPostgresDataDirectory } from "./client.js";
import { createEmbeddedPostgresLogBuffer } from "./embedded-postgres-error.js";
import {
  cleanupOrphanedEmbeddedPostgresForkchildren,
  recoverEmbeddedPostgresStart,
  resetIncompleteEmbeddedPostgresDataDir,
  shouldRetryEmbeddedPostgresStart,
} from "./embedded-postgres-recovery.js";
import {
  loadEmbeddedPostgresBinaryPaths,
  loadEmbeddedPostgresCtor,
  type EmbeddedPostgresCtor,
  type EmbeddedPostgresInstance,
  type EmbeddedPostgresRuntimeLogger,
} from "./embedded-postgres-runtime-installer.js";

const execFileAsync = promisify(execFile);
const DEFAULT_INITDB_FLAGS = ["--encoding=UTF8", "--locale=C", "--lc-messages=C"];
const DEFAULT_EMBEDDED_POSTGRES_USER = "paperclip";
const DEFAULT_EMBEDDED_POSTGRES_PASSWORD = "paperclip";
const DEFAULT_PAPERCLIP_EMBEDDED_POSTGRES_PORT = 54329;
const TEST_REGISTRY_VERSION = 1;
const TEST_SUPPORT_VERSION = 1;

export type EmbeddedPostgresTestSupport = {
  supported: boolean;
  reason?: string;
};

export type ManagedEmbeddedPostgresHandle = {
  adminConnectionString: string;
  connectionStringFor(databaseName: string): string;
  dataDir: string;
  ownerPid: number;
  pgCtlPath: string | null;
  port: number;
  postmasterPid: number | null;
  postgresPath: string;
  startedByThisProcess: boolean;
  stop(): Promise<void>;
};

type PostgresProcessInfo = {
  commandLine: string;
  parentPid: number | null;
  pid: number;
};

type EmbeddedPostgresTestRegistryRecord = {
  createdAt: string;
  dataDir: string;
  id: string;
  ownerPid: number;
  pgCtlPath: string | null;
  port: number;
  postmasterPid: number | null;
  postgresPath: string;
  version: typeof TEST_REGISTRY_VERSION;
};

type EmbeddedPostgresTestSupportCache = {
  arch: string;
  createdAt: string;
  platform: NodeJS.Platform;
  reason?: string;
  supported: boolean;
  version: typeof TEST_SUPPORT_VERSION;
};

type StartupErrorParams = {
  dataDir: string;
  error: unknown;
  phase: "initialise" | "start";
  port: number;
  recentLogs: string[];
};

type StartManagedEmbeddedPostgresOptions = {
  dataDir: string;
  ensureDatabaseName?: string | null;
  formatStartupError?: (params: StartupErrorParams) => Error;
  initdbFlags?: string[];
  logger?: EmbeddedPostgresRuntimeLogger;
  password?: string;
  persistent?: boolean;
  preferredPort: number;
  registerTestInstance?: boolean;
  user?: string;
};

type ShutdownEmbeddedPostgresRecord = {
  dataDir: string;
  pgCtlPath: string | null;
  postmasterPid: number | null;
};

type ExecFileResult = {
  exitCode: number | null;
  stderr: string;
  stdout: string;
};

type PortAvailabilityProbe = (port: number) => Promise<boolean>;

type ManagerOps = {
  execFile: (command: string, args: string[]) => Promise<ExecFileResult>;
  forceKillProcessTree: (pid: number) => Promise<void>;
  isPidAlive: (pid: number) => boolean;
  listPostgresProcesses: () => Promise<PostgresProcessInfo[]>;
  readDir: (targetDir: string) => Promise<string[]>;
  readJson: <T>(filePath: string) => Promise<T | null>;
  removeFile: (filePath: string) => Promise<void>;
  removePostmasterPid: (dataDir: string) => void;
  rm: typeof fs.rm;
  sleep: (ms: number) => Promise<void>;
  writeJson: (filePath: string, value: unknown) => Promise<void>;
};

const defaultManagerOps: ManagerOps = {
  execFile: async (command, args) => {
    const { stdout, stderr } = await execFileAsync(command, args, { windowsHide: true });
    return { exitCode: 0, stdout, stderr };
  },
  forceKillProcessTree: forceKillProcessTree,
  isPidAlive: isPidAlive,
  listPostgresProcesses: listPostgresProcesses,
  readDir: async (targetDir) => {
    try {
      return await fs.readdir(targetDir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return [];
      throw error;
    }
  },
  readJson: readJsonFile,
  removeFile: async (filePath) => {
    await fs.rm(filePath, { force: true });
  },
  removePostmasterPid: (dataDir) => {
    rmSync(path.resolve(dataDir, "postmaster.pid"), { force: true });
  },
  rm: fs.rm,
  sleep: async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  },
  writeJson: async (filePath, value) => {
    mkdirSync(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  },
};

function resolveManagerOps(overrides?: Partial<ManagerOps>): ManagerOps {
  return {
    ...defaultManagerOps,
    ...overrides,
  };
}

function getTestRegistryRoot() {
  return path.resolve(os.tmpdir(), "paperclip-embedded-postgres-test-registry");
}

function getTestRegistryRecordsDir() {
  return path.resolve(getTestRegistryRoot(), "records");
}

function getTestSupportCachePath() {
  return path.resolve(getTestRegistryRoot(), `support-${process.platform}-${os.arch()}.json`);
}

function getRegistryRecordPath(id: string) {
  return path.resolve(getTestRegistryRecordsDir(), `${id}.json`);
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.length > 0 ? error.message : error.name;
  }
  if (typeof error === "string" && error.length > 0) return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function normalizeForComparison(value: string): string {
  const normalized = path.resolve(value).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesDataDir(commandLine: string, dataDir: string): boolean {
  const normalizedCommand = commandLine.replace(/\\/g, "/");
  const normalizedDataDir = normalizeForComparison(dataDir);
  const escapedDataDir = escapeRegExp(normalizedDataDir);
  const normalizedText = process.platform === "win32" ? normalizedCommand.toLowerCase() : normalizedCommand;
  return new RegExp(`(?:^|[\\s"'=])${escapedDataDir}(?=$|[\\s"'=])`).test(normalizedText);
}

function buildConnectionString(port: number, databaseName: string, user: string, password: string) {
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${databaseName}`;
}

function buildStartupError(
  params: StartupErrorParams,
  formatter?: (params: StartupErrorParams) => Error,
): Error {
  if (formatter) return formatter(params);
  return new Error(
    `Failed to ${params.phase} embedded PostgreSQL in ${params.dataDir} on port ${params.port}: ${formatUnknownError(params.error)}`,
  );
}

function toPid(value: unknown): number | null {
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isValidTestRegistryRecord(value: unknown): value is EmbeddedPostgresTestRegistryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === TEST_REGISTRY_VERSION &&
    typeof record.id === "string" &&
    typeof record.dataDir === "string" &&
    typeof record.ownerPid === "number" &&
    typeof record.port === "number" &&
    typeof record.postgresPath === "string" &&
    (typeof record.pgCtlPath === "string" || record.pgCtlPath === null) &&
    (typeof record.postmasterPid === "number" || record.postmasterPid === null) &&
    typeof record.createdAt === "string"
  );
}

function isValidSupportCache(value: unknown): value is EmbeddedPostgresTestSupportCache {
  if (!value || typeof value !== "object") return false;
  const cache = value as Record<string, unknown>;
  return (
    cache.version === TEST_SUPPORT_VERSION &&
    cache.platform === process.platform &&
    cache.arch === os.arch() &&
    typeof cache.supported === "boolean" &&
    (typeof cache.reason === "string" || cache.reason === undefined) &&
    typeof cache.createdAt === "string"
  );
}

export function readRunningPostmasterPid(postmasterPidFile: string): number | null {
  if (!existsSync(postmasterPidFile)) return null;
  try {
    const pid = Number(readFileSync(postmasterPidFile, "utf8").split("\n")[0]?.trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

export function readPidFilePort(postmasterPidFile: string): number | null {
  if (!existsSync(postmasterPidFile)) return null;
  try {
    const lines = readFileSync(postmasterPidFile, "utf8").split("\n");
    const port = Number(lines[3]?.trim());
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function getReservedTestPorts(): Set<number> {
  const configuredPorts = [
    DEFAULT_PAPERCLIP_EMBEDDED_POSTGRES_PORT,
    Number.parseInt(process.env.PAPERCLIP_EMBEDDED_POSTGRES_PORT ?? "", 10),
    ...String(process.env.PAPERCLIP_TEST_POSTGRES_RESERVED_PORTS ?? "")
      .split(",")
      .map((value) => Number.parseInt(value.trim(), 10)),
  ];
  return new Set(configuredPorts.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535));
}

export async function getAvailablePort(): Promise<number> {
  const reservedPorts = getReservedTestPorts();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close(() => reject(new Error("Failed to allocate embedded Postgres port")));
          return;
        }
        const { port } = address;
        server.close((error) => {
          if (error) reject(error);
          else resolve(port);
        });
      });
    });

    if (!reservedPorts.has(port)) return port;
  }

  throw new Error(
    `Failed to allocate embedded Postgres test port outside reserved Paperclip ports: ${[
      ...reservedPorts,
    ].join(", ")}`,
  );
}

async function canBindPort(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = net.createServer();
    let resolved = false;
    const resolveOnce = (value: boolean) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    server.unref();
    server.once("error", () => {
      resolveOnce(false);
    });
    try {
      server.listen(port, "127.0.0.1", () => {
        server.close((error) => {
          resolveOnce(!error);
        });
      });
    } catch {
      resolveOnce(false);
    }
  });
}

export async function findAvailablePort(
  startPort: number,
  probePortAvailability: PortAvailabilityProbe = canBindPort,
): Promise<number> {
  if (startPort <= 0) {
    return await getAvailablePort();
  }

  const maxLookahead = 20;
  let port = startPort;
  for (let index = 0; index < maxLookahead; index += 1, port += 1) {
    if (await probePortAvailability(port)) return port;
  }

  throw new Error(
    `Embedded PostgreSQL could not find a bindable port from ${startPort} to ${startPort + maxLookahead - 1}`,
  );
}

export async function removeDataDirWithRetries(
  dataDir: string,
  overrides?: Partial<Pick<ManagerOps, "rm" | "sleep">>,
): Promise<void> {
  const ops = resolveManagerOps(overrides);
  const maxAttempts = process.platform === "win32" ? 12 : 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await ops.rm(dataDir, {
        recursive: true,
        force: true,
        maxRetries: process.platform === "win32" ? 5 : 0,
        retryDelay: 100,
      });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const retryable = code === "EPERM" || code === "EBUSY" || code === "ENOTEMPTY";
      if (!retryable || attempt === maxAttempts) throw error;
      await ops.sleep(attempt * 100);
    }
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}

async function listPostgresProcesses(): Promise<PostgresProcessInfo[]> {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync(
      "powershell",
      [
        "-NoLogo",
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"name = 'postgres.exe'\" | " +
          "Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
      ],
      { windowsHide: true },
    );
    const payload = stdout.trim();
    if (!payload) return [];
    const parsed = JSON.parse(payload) as
      | { CommandLine?: string | null; ParentProcessId?: number; ProcessId?: number }
      | Array<{ CommandLine?: string | null; ParentProcessId?: number; ProcessId?: number }>;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .map((row) => ({
        commandLine: typeof row.CommandLine === "string" ? row.CommandLine : "",
        parentPid: toPid(row.ParentProcessId),
        pid: Number(row.ProcessId),
      }))
      .filter((row) => Number.isInteger(row.pid) && row.pid > 0);
  }

  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,command="]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) return null;
      return {
        commandLine: match[3] ?? "",
        parentPid: toPid(match[2]),
        pid: Number(match[1]),
      };
    })
    .filter((row): row is PostgresProcessInfo => row !== null)
    .filter((row) => /\bpostgres\b/i.test(row.commandLine));
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isPidAlive(pid)) return true;
    await defaultManagerOps.sleep(100);
  }
  return !isPidAlive(pid);
}

async function forceKillProcessTree(pid: number): Promise<void> {
  if (!isPidAlive(pid)) return;

  if (process.platform === "win32") {
    try {
      await execFileAsync(
        process.env.comspec ?? "cmd.exe",
        ["/d", "/s", "/c", "taskkill", "/PID", String(pid), "/T", "/F"],
        { windowsHide: true },
      );
    } catch {
      if (isPidAlive(pid)) throw new Error(`Failed to taskkill embedded Postgres process tree ${pid}`);
    }
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }

  if (await waitForProcessExit(pid, 2_000)) return;

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }
}

async function killMatchingProcessesForDataDir(
  dataDir: string,
  ops: Pick<ManagerOps, "forceKillProcessTree" | "listPostgresProcesses">,
): Promise<void> {
  const matchingPids = (await ops.listPostgresProcesses())
    .filter((processInfo) => matchesDataDir(processInfo.commandLine, dataDir))
    .map((processInfo) => processInfo.pid)
    .filter((pid, index, pids) => pids.indexOf(pid) === index);

  for (const pid of matchingPids) {
    await ops.forceKillProcessTree(pid).catch(() => undefined);
  }
}

export async function shutdownManagedEmbeddedPostgres(
  record: ShutdownEmbeddedPostgresRecord,
  overrides?: Partial<ManagerOps>,
): Promise<void> {
  const ops = resolveManagerOps(overrides);
  const postmasterPidFile = path.resolve(record.dataDir, "postmaster.pid");
  const initialPid = readRunningPostmasterPid(postmasterPidFile) ?? record.postmasterPid;

  if (record.pgCtlPath && existsSync(record.pgCtlPath) && existsSync(record.dataDir)) {
    try {
      await ops.execFile(record.pgCtlPath, ["-D", record.dataDir, "stop", "-m", "immediate", "-w", "-t", "30"]);
    } catch {
      // Fall through to stronger cleanup below.
    }
  }

  const pidAfterPgCtl = readRunningPostmasterPid(postmasterPidFile) ?? initialPid;
  if (pidAfterPgCtl && ops.isPidAlive(pidAfterPgCtl)) {
    await ops.forceKillProcessTree(pidAfterPgCtl).catch(() => undefined);
  }

  await killMatchingProcessesForDataDir(record.dataDir, ops);

  const remainingPostmasterPid = readRunningPostmasterPid(postmasterPidFile);
  const remainingMatches = (await ops.listPostgresProcesses()).filter((processInfo) =>
    matchesDataDir(processInfo.commandLine, record.dataDir),
  );

  if ((!remainingPostmasterPid || !ops.isPidAlive(remainingPostmasterPid)) && remainingMatches.length === 0) {
    ops.removePostmasterPid(record.dataDir);
    return;
  }

  throw new Error(`Embedded PostgreSQL still has live processes for ${record.dataDir}`);
}

async function writeTestRegistryRecord(
  record: EmbeddedPostgresTestRegistryRecord,
  overrides?: Partial<ManagerOps>,
): Promise<void> {
  const ops = resolveManagerOps(overrides);
  await ops.writeJson(getRegistryRecordPath(record.id), record);
}

async function removeTestRegistryRecord(
  recordId: string | null,
  overrides?: Partial<ManagerOps>,
): Promise<void> {
  if (!recordId) return;
  const ops = resolveManagerOps(overrides);
  await ops.removeFile(getRegistryRecordPath(recordId)).catch(() => undefined);
}

function toTestSupportCache(value: EmbeddedPostgresTestSupport): EmbeddedPostgresTestSupportCache {
  return {
    arch: os.arch(),
    createdAt: new Date().toISOString(),
    platform: process.platform,
    ...(value.reason ? { reason: value.reason } : {}),
    supported: value.supported,
    version: TEST_SUPPORT_VERSION,
  };
}

async function maybeAdoptExistingCluster(
  input: {
    dataDir: string;
    ensureDatabaseName?: string | null;
    logger?: EmbeddedPostgresRuntimeLogger;
    password: string;
    port: number;
    preferredPort: number;
    user: string;
  },
): Promise<ManagedEmbeddedPostgresHandle | null> {
  const postmasterPidFile = path.resolve(input.dataDir, "postmaster.pid");
  const pgVersionFile = path.resolve(input.dataDir, "PG_VERSION");
  const runningPid = readRunningPostmasterPid(postmasterPidFile);
  const runningPort = readPidFilePort(postmasterPidFile);

  if (!runningPid && !existsSync(pgVersionFile)) {
    return null;
  }

  let adoptedPort: number | null = null;
  let adoptedPid: number | null = runningPid;

  if (runningPid) {
    adoptedPort = runningPort ?? input.preferredPort;
  } else {
    const preferredAdminConnectionString = buildConnectionString(
      input.preferredPort,
      "postgres",
      input.user,
      input.password,
    );
    try {
      const actualDataDir = await getPostgresDataDirectory(preferredAdminConnectionString);
      const matchesExpectedDir =
        typeof actualDataDir === "string" &&
        normalizeForComparison(actualDataDir) === normalizeForComparison(input.dataDir);
      if (!matchesExpectedDir) {
        return null;
      }
      adoptedPort = input.preferredPort;
      adoptedPid = readRunningPostmasterPid(postmasterPidFile);
      input.logger?.warn?.(
        `Adopting an existing PostgreSQL instance on port ${input.preferredPort} for embedded data dir ${input.dataDir} because postmaster.pid is missing.`,
      );
    } catch {
      return null;
    }
  }

  if (!adoptedPort) return null;
  const adminConnectionString = buildConnectionString(adoptedPort, "postgres", input.user, input.password);
  if (input.ensureDatabaseName) {
    await ensurePostgresDatabase(adminConnectionString, input.ensureDatabaseName);
  }

  return {
    adminConnectionString,
    connectionStringFor(databaseName: string) {
      return buildConnectionString(adoptedPort!, databaseName, input.user, input.password);
    },
    dataDir: input.dataDir,
    ownerPid: process.pid,
    pgCtlPath: null,
    port: adoptedPort,
    postmasterPid: adoptedPid,
    postgresPath: "",
    startedByThisProcess: false,
    async stop() {
      return;
    },
  };
}

export async function startManagedEmbeddedPostgres(
  options: StartManagedEmbeddedPostgresOptions,
): Promise<ManagedEmbeddedPostgresHandle> {
  const user = options.user ?? DEFAULT_EMBEDDED_POSTGRES_USER;
  const password = options.password ?? DEFAULT_EMBEDDED_POSTGRES_PASSWORD;
  const preferredPort = options.preferredPort;
  const persistent = options.persistent ?? true;
  const logBuffer = createEmbeddedPostgresLogBuffer();
  const initdbFlags = options.initdbFlags ?? DEFAULT_INITDB_FLAGS;
  const selectedPort = await findAvailablePort(preferredPort);
  const postmasterPidFile = path.resolve(options.dataDir, "postmaster.pid");
  const pgVersionFile = path.resolve(options.dataDir, "PG_VERSION");

  if (!existsSync(options.dataDir)) {
    mkdirSync(options.dataDir, { recursive: true });
  }

  const cleanedForkchildren = await cleanupOrphanedEmbeddedPostgresForkchildren();
  if (cleanedForkchildren.length > 0) {
    options.logger?.warn?.(
      `Cleaned up ${cleanedForkchildren.length} stale embedded PostgreSQL worker process(es) before startup.`,
    );
  }

  if (!readRunningPostmasterPid(postmasterPidFile) && resetIncompleteEmbeddedPostgresDataDir(options.dataDir)) {
    options.logger?.warn?.(
      `Embedded PostgreSQL data dir ${options.dataDir} was left half-initialized; resetting it before retrying startup.`,
    );
  }

  const adoptedHandle = await maybeAdoptExistingCluster({
    dataDir: options.dataDir,
    ensureDatabaseName: options.ensureDatabaseName,
    logger: options.logger,
    password,
    port: selectedPort,
    preferredPort,
    user,
  });
  if (adoptedHandle) return adoptedHandle;

  const binaries = await loadEmbeddedPostgresBinaryPaths({ logger: options.logger });
  const EmbeddedPostgres = await loadEmbeddedPostgresCtor({ logger: options.logger });
  const createInstance = (port: number): EmbeddedPostgresInstance =>
    new (EmbeddedPostgres as EmbeddedPostgresCtor)({
      databaseDir: options.dataDir,
      user,
      password,
      port,
      persistent,
      initdbFlags,
      onLog: (message) => {
        logBuffer.append(message);
      },
      onError: (message) => {
        logBuffer.append(message);
      },
    });

  let instance = createInstance(selectedPort);
  let startedByThisProcess = false;
  let registryId: string | null = null;

  try {
    if (!existsSync(pgVersionFile)) {
      try {
        await instance.initialise();
      } catch (error) {
        throw buildStartupError(
          {
            dataDir: options.dataDir,
            error,
            phase: "initialise",
            port: selectedPort,
            recentLogs: logBuffer.getRecentLogs(),
          },
          options.formatStartupError,
        );
      }
    }

    if (existsSync(postmasterPidFile)) {
      rmSync(postmasterPidFile, { force: true });
    }

    try {
      await instance.start();
    } catch (error) {
      const recentLogs = logBuffer.getRecentLogs();
      const adoptedPid = readRunningPostmasterPid(postmasterPidFile);
      if (adoptedPid) {
        const adoptedPort = readPidFilePort(postmasterPidFile) ?? selectedPort;
        const adminConnectionString = buildConnectionString(adoptedPort, "postgres", user, password);
        if (options.ensureDatabaseName) {
          await ensurePostgresDatabase(adminConnectionString, options.ensureDatabaseName);
        }
        return {
          adminConnectionString,
          connectionStringFor(databaseName: string) {
            return buildConnectionString(adoptedPort, databaseName, user, password);
          },
          dataDir: options.dataDir,
          ownerPid: process.pid,
          pgCtlPath: binaries.pgCtl,
          port: adoptedPort,
          postmasterPid: adoptedPid,
          postgresPath: binaries.postgres,
          startedByThisProcess: false,
          async stop() {
            return;
          },
        };
      }

      if (shouldRetryEmbeddedPostgresStart(recentLogs)) {
        await recoverEmbeddedPostgresStart(options.dataDir);
        instance = createInstance(selectedPort);
        try {
          await instance.start();
        } catch (retryError) {
          throw buildStartupError(
            {
              dataDir: options.dataDir,
              error: retryError,
              phase: "start",
              port: selectedPort,
              recentLogs: logBuffer.getRecentLogs(),
            },
            options.formatStartupError,
          );
        }
      } else {
        throw buildStartupError(
          {
            dataDir: options.dataDir,
            error,
            phase: "start",
            port: selectedPort,
            recentLogs,
          },
          options.formatStartupError,
        );
      }
    }

    startedByThisProcess = true;
    const postmasterPid = readRunningPostmasterPid(postmasterPidFile);
    const adminConnectionString = buildConnectionString(selectedPort, "postgres", user, password);
    if (options.ensureDatabaseName) {
      await ensurePostgresDatabase(adminConnectionString, options.ensureDatabaseName);
    }

    if (options.registerTestInstance) {
      registryId = randomUUID();
      await writeTestRegistryRecord({
        createdAt: new Date().toISOString(),
        dataDir: options.dataDir,
        id: registryId,
        ownerPid: process.pid,
        pgCtlPath: binaries.pgCtl,
        port: selectedPort,
        postmasterPid,
        postgresPath: binaries.postgres,
        version: TEST_REGISTRY_VERSION,
      });
    }

    let stopPromise: Promise<void> | null = null;
    return {
      adminConnectionString,
      connectionStringFor(databaseName: string) {
        return buildConnectionString(selectedPort, databaseName, user, password);
      },
      dataDir: options.dataDir,
      ownerPid: process.pid,
      pgCtlPath: binaries.pgCtl,
      port: selectedPort,
      postmasterPid,
      postgresPath: binaries.postgres,
      startedByThisProcess,
      async stop() {
        if (!stopPromise) {
          stopPromise = (async () => {
            try {
              if (startedByThisProcess) {
                await shutdownManagedEmbeddedPostgres({
                  dataDir: options.dataDir,
                  pgCtlPath: binaries.pgCtl,
                  postmasterPid: readRunningPostmasterPid(postmasterPidFile) ?? postmasterPid,
                });
              }
            } finally {
              await removeTestRegistryRecord(registryId).catch(() => undefined);
            }
          })();
        }
        await stopPromise;
      },
    };
  } catch (error) {
    await removeTestRegistryRecord(registryId).catch(() => undefined);
    if (startedByThisProcess) {
      await shutdownManagedEmbeddedPostgres({
        dataDir: options.dataDir,
        pgCtlPath: binaries.pgCtl,
        postmasterPid: readRunningPostmasterPid(postmasterPidFile),
      }).catch(() => undefined);
    }
    throw error;
  }
}

export async function cleanupStaleEmbeddedPostgresTestRegistrations(
  overrides?: Partial<ManagerOps>,
): Promise<{
  cleaned: string[];
  skipped: string[];
}> {
  const ops = resolveManagerOps(overrides);
  const cleaned: string[] = [];
  const skipped: string[] = [];

  for (const entry of await ops.readDir(getTestRegistryRecordsDir())) {
    if (!entry.endsWith(".json")) continue;
    const filePath = path.resolve(getTestRegistryRecordsDir(), entry);
    const rawRecord = await ops.readJson<unknown>(filePath);
    if (!isValidTestRegistryRecord(rawRecord)) {
      await ops.removeFile(filePath).catch(() => undefined);
      continue;
    }

    if (ops.isPidAlive(rawRecord.ownerPid)) {
      skipped.push(rawRecord.id);
      continue;
    }

    await shutdownManagedEmbeddedPostgres(
      {
        dataDir: rawRecord.dataDir,
        pgCtlPath: rawRecord.pgCtlPath,
        postmasterPid: rawRecord.postmasterPid,
      },
      overrides,
    ).catch(() => undefined);
    await removeDataDirWithRetries(rawRecord.dataDir, overrides).catch(() => undefined);
    await ops.removeFile(filePath).catch(() => undefined);
    cleaned.push(rawRecord.id);
  }

  return { cleaned, skipped };
}

export async function readCachedEmbeddedPostgresTestSupport(
  overrides?: Partial<Pick<ManagerOps, "readJson">>,
): Promise<EmbeddedPostgresTestSupport | null> {
  const ops = resolveManagerOps(overrides);
  const cache = await ops.readJson<unknown>(getTestSupportCachePath());
  if (!isValidSupportCache(cache)) return null;
  return {
    ...(cache.reason ? { reason: cache.reason } : {}),
    supported: cache.supported,
  };
}

export async function prepareEmbeddedPostgresTestSupport(): Promise<EmbeddedPostgresTestSupport> {
  const cached = await readCachedEmbeddedPostgresTestSupport();
  if (cached?.supported) return cached;

  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-embedded-postgres-probe-"));
  const preferredPort = await getAvailablePort();
  let support: EmbeddedPostgresTestSupport;
  let handle: ManagedEmbeddedPostgresHandle | null = null;

  try {
    handle = await startManagedEmbeddedPostgres({
      dataDir,
      preferredPort,
    });
    support = { supported: true };
  } catch (error) {
    support = {
      reason: formatUnknownError(error),
      supported: false,
    };
  } finally {
    await handle?.stop().catch(() => undefined);
    await removeDataDirWithRetries(dataDir).catch(() => undefined);
  }

  await defaultManagerOps.writeJson(getTestSupportCachePath(), toTestSupportCache(support));
  return support;
}

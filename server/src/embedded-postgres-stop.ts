import { execFile } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const STOP_TIMEOUT_MS = 31_000;

export type EmbeddedPostgresChild = {
  pid?: number;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  removeListener?: (event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void) => unknown;
  off?: (event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void) => unknown;
};

export type WindowsOwnedEmbeddedPostgresInstance = {
  process?: EmbeddedPostgresChild;
  stop(): Promise<void>;
};

type BinaryPaths = { pgCtl: string | null };

type StopOptions = {
  instance: WindowsOwnedEmbeddedPostgresInstance;
  dataDir: string;
  pgCtlPath: BinaryPaths["pgCtl"];
  canonicalizeWindowsDataDirectory?: (value: string) => string;
  readFile?: (filePath: string) => string;
  runPgCtl?: (command: string, args: string[], timeoutMs: number) => Promise<void>;
  timeoutMs?: number;
};

function canonicalizeWindowsDataDirectory(value: string): string {
  return realpathSync.native(resolve(value)).replaceAll("/", "\\").toLowerCase();
}

function readOwnedPostmasterPid(
  contents: string,
  dataDir: string,
  childPid: number,
  canonicalize: (value: string) => string,
): void {
  const [pidText, pidDataDir] = contents.split(/\r?\n/);
  if (Number(pidText) !== childPid || !pidDataDir || canonicalize(pidDataDir) !== canonicalize(dataDir)) {
    throw new Error("Refusing to stop embedded PostgreSQL because postmaster.pid does not match the owned child process.");
  }
}

function waitForChildExit(child: EmbeddedPostgresChild): {
  promise: Promise<void>;
  cleanup: () => void;
  exited: () => boolean;
} {
  if (child.exitCode !== null && child.exitCode !== undefined || child.signalCode !== null && child.signalCode !== undefined) {
    throw new Error("Refusing to stop embedded PostgreSQL because its owned child process has already exited.");
  }
  let listener: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;
  let exited = false;
  const promise = new Promise<void>((resolveExit) => {
    listener = () => {
      exited = true;
      resolveExit();
    };
    child.once("exit", listener);
  });
  return {
    promise,
    cleanup: () => {
      if (!listener) return;
      if (child.removeListener) child.removeListener("exit", listener);
      else child.off?.("exit", listener);
      listener = null;
    },
    exited: () => exited || child.exitCode !== null && child.exitCode !== undefined || child.signalCode !== null && child.signalCode !== undefined,
  };
}

/** Stops only the cluster whose direct child and pid file identify this server. */
export async function stopOwnedEmbeddedPostgresOnWindows(options: StopOptions): Promise<void> {
  const child = options.instance.process;
  const childPid = child?.pid;
  if (!child || typeof childPid !== "number" || !Number.isSafeInteger(childPid) || childPid <= 0) {
    throw new Error("Refusing to stop embedded PostgreSQL because no owned child process is available.");
  }
  const childExit = waitForChildExit(child);
  let timer: NodeJS.Timeout | null = null;
  try {
    const readFile = options.readFile ?? ((filePath: string) => readFileSync(filePath, "utf8"));
    const canonicalize = options.canonicalizeWindowsDataDirectory ?? canonicalizeWindowsDataDirectory;
    readOwnedPostmasterPid(readFile(resolve(options.dataDir, "postmaster.pid")), options.dataDir, childPid, canonicalize);
    if (childExit.exited()) {
      throw new Error("Refusing to stop embedded PostgreSQL because its owned child process has already exited.");
    }
    if (!options.pgCtlPath) throw new Error("Refusing to stop embedded PostgreSQL because this runtime has no pg_ctl binary.");

    const timeoutMs = options.timeoutMs ?? STOP_TIMEOUT_MS;
    const runPgCtl = options.runPgCtl ?? (async (command, args, commandTimeoutMs) => {
      await execFileAsync(command, args, { windowsHide: true, timeout: commandTimeoutMs });
    });
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out waiting for owned embedded PostgreSQL to stop.")), timeoutMs);
      timer.unref?.();
    });
    await Promise.race([
      Promise.all([
        runPgCtl(options.pgCtlPath, ["-D", options.dataDir, "stop", "-m", "fast", "-w", "-t", "30"], timeoutMs),
        childExit.promise,
      ]),
      timeout,
    ]);
    if (options.instance.process !== child) {
      throw new Error("Refusing to finish embedded PostgreSQL stop because the owned child process was replaced.");
    }
    // Match embedded-postgres' successful stop cleanup. Its process-exit hook
    // then sees no child to taskkill after this owned cluster has exited.
    options.instance.process = undefined;
  } finally {
    if (timer) clearTimeout(timer);
    childExit.cleanup();
  }
}

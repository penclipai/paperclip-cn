import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveServerDevWatchIgnorePaths } from "../src/dev-watch-ignore.ts";
import { terminateLocalService } from "../src/services/local-service-supervisor.ts";

const require = createRequire(import.meta.url);

function resolveTsxCliPath(): string {
  try {
    return require.resolve("tsx/cli");
  } catch {
    return require.resolve("tsx/dist/cli.mjs");
  }
}

const tsxCliPath = resolveTsxCliPath();
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoreArgs = resolveServerDevWatchIgnorePaths(serverRoot).flatMap((ignorePath) => ["--exclude", ignorePath]);
const stopFilePath = process.env.PAPERCLIP_DEV_STOP_FILE?.trim() ?? "";
const stopRequestPollIntervalMs = 1_000;

const child = spawn(
  process.execPath,
  [tsxCliPath, "watch", ...ignoreArgs, "src/index.ts"],
  {
    cwd: serverRoot,
    env: process.env,
    stdio: "inherit",
  },
);

let shuttingDown = false;
let shutdownPromise: Promise<void> | null = null;
let stopRequestTimer: NodeJS.Timeout | null = null;

function exitForSignal(signal: NodeJS.Signals): void {
  if (signal === "SIGINT") {
    process.exit(130);
  }
  if (signal === "SIGTERM") {
    process.exit(143);
  }
  process.exit(1);
}

async function waitForChildExit(): Promise<{ code: number; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode ?? 0, signal: child.signalCode };
  }

  return await new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({ code: code ?? 0, signal });
    });
  });
}

async function stopChild(signal: NodeJS.Signals): Promise<void> {
  if (!child.pid) {
    try {
      child.kill(signal);
    } catch {
      // Child may already be gone by the time we attempt shutdown.
    }
    return;
  }

  await terminateLocalService(
    { pid: child.pid, processGroupId: null },
    { signal, forceAfterMs: 5_000 },
  );
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownPromise) {
    await shutdownPromise;
    return;
  }

  shuttingDown = true;
  if (stopRequestTimer) {
    clearInterval(stopRequestTimer);
    stopRequestTimer = null;
  }
  shutdownPromise = (async () => {
    const exitPromise = waitForChildExit();
    await stopChild(signal);
    const exit = await exitPromise;
    if (exit.signal) {
      exitForSignal(exit.signal);
      return;
    }
    process.exit(exit.code ?? 0);
  })();

  await shutdownPromise;
}

if (stopFilePath) {
  stopRequestTimer = setInterval(() => {
    if (!shuttingDown && existsSync(stopFilePath)) {
      void shutdown("SIGTERM");
    }
  }, stopRequestPollIntervalMs);
}

child.on("exit", (code, signal) => {
  if (shuttingDown) {
    return;
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

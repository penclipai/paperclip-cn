import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  createWorkerShutdownController,
  isWorkerShutdownRequest,
  type WorkerShutdownComplete,
  type WorkerShutdownFailed,
} from "./worker-shutdown.js";

type ReadyMessage = {
  type: "ready";
  payload: {
    apiUrl: string;
  };
};

type FatalMessage = {
  type: "fatal";
  error: string;
};

type StartedServer = {
  apiUrl: string;
  shutdown: (signal: NodeJS.Signals) => Promise<void> | void;
};

const shutdownFallbackTimeoutMs = 115_000;

let shutdownFallbackTimer: NodeJS.Timeout | null = null;

function reportFatal(error: string): void {
  sendMessage({ type: "fatal", error });
  process.exitCode = 1;
  setImmediate(() => process.exit(1));
}

function resolveServerEntrypoint(): string {
  const entry = process.env.PAPERCLIP_DESKTOP_SERVER_ENTRY?.trim();
  if (!entry) {
    throw new Error("PAPERCLIP_DESKTOP_SERVER_ENTRY is required.");
  }
  if (!fs.existsSync(entry)) {
    throw new Error(`Server entrypoint not found: ${entry}`);
  }
  return entry;
}

function applyDesktopEnvironment(): void {
  process.env.PAPERCLIP_HOME = process.env.PAPERCLIP_HOME?.trim() || process.cwd();
  process.env.PAPERCLIP_INSTANCE_ID = process.env.PAPERCLIP_INSTANCE_ID?.trim() || "default";
  process.env.HOST = "127.0.0.1";
  process.env.PORT = process.env.PORT?.trim() || "3100";
  process.env.PAPERCLIP_OPEN_ON_LISTEN = "false";
}

async function maybeDelayStartupForSmoke(): Promise<void> {
  const delayMs = Number(process.env.PAPERCLIP_DESKTOP_SMOKE_START_DELAY_MS ?? "");
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return;
  }
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function loadServerModule(entryPath: string): Promise<() => Promise<StartedServer>> {
  const mod = (await import(pathToFileURL(entryPath).href)) as {
    startServer?: () => Promise<StartedServer>;
  };

  if (typeof mod.startServer !== "function") {
    throw new Error(`Entrypoint does not export startServer(): ${entryPath}`);
  }

  return mod.startServer;
}

function sendMessage(message: ReadyMessage | FatalMessage): void {
  if (typeof process.send === "function") {
    process.send(message);
  }
}

async function sendShutdownMessage(message: WorkerShutdownComplete | WorkerShutdownFailed): Promise<void> {
  if (typeof process.send !== "function") {
    throw new Error("Desktop parent IPC is unavailable.");
  }

  await new Promise<void>((resolve, reject) => {
    process.send?.(message, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function clearShutdownFallbackTimer(): void {
  if (shutdownFallbackTimer) {
    clearTimeout(shutdownFallbackTimer);
    shutdownFallbackTimer = null;
  }
}

function requestShutdownFromDisconnect(): void {
  shutdownFallbackTimer = setTimeout(() => {
    console.error("[desktop-worker] Parent disconnected before orderly shutdown completed.");
    process.exit(1);
  }, shutdownFallbackTimeoutMs);

  void shutdownController.requestShutdown().finally(clearShutdownFallbackTimer);
}

async function bootstrap(): Promise<StartedServer> {
  applyDesktopEnvironment();
  await maybeDelayStartupForSmoke();
  const entryPath = resolveServerEntrypoint();
  const startServer = await loadServerModule(entryPath);
  return startServer();
}

const startupPromise = bootstrap();
const shutdownController = createWorkerShutdownController({
  startup: startupPromise,
  send: sendShutdownMessage,
  exit: (code) => process.exit(code),
  formatError: (error) => error instanceof Error ? error.stack ?? error.message : String(error),
});

process.on("message", (message: unknown) => {
  if (!isWorkerShutdownRequest(message)) {
    return;
  }
  void shutdownController.requestShutdown(message.requestId);
});

process.once("disconnect", () => {
  requestShutdownFromDisconnect();
});

process.once("exit", () => {
  clearShutdownFallbackTimer();
});

process.on("uncaughtException", (error) => {
  reportFatal(error.stack ?? error.message);
});

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  reportFatal(message);
});

void startupPromise.then((started) => {
  if (shutdownController.isShutdownRequested()) {
    return;
  }
  sendMessage({
    type: "ready",
    payload: {
      apiUrl: started.apiUrl,
    },
  });
}).catch((error) => {
  if (!shutdownController.isShutdownRequested()) {
    reportFatal(error.stack ?? error.message);
  }
});

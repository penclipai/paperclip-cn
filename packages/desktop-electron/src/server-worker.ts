import fs from "node:fs";
import { pathToFileURL } from "node:url";

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

const shutdownFallbackTimeoutMs = 7_000;

let bootstrapped = false;
let shutdownRequested = false;
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

async function loadServerModule(entryPath: string): Promise<() => Promise<{ apiUrl: string }>> {
  const mod = (await import(pathToFileURL(entryPath).href)) as {
    startServer?: () => Promise<{ apiUrl: string }>;
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

function clearShutdownFallbackTimer(): void {
  if (shutdownFallbackTimer) {
    clearTimeout(shutdownFallbackTimer);
    shutdownFallbackTimer = null;
  }
}

function requestShutdownFromDisconnect(): void {
  if (shutdownRequested) {
    return;
  }

  shutdownRequested = true;
  if (!bootstrapped) {
    process.exit(0);
    return;
  }

  shutdownFallbackTimer = setTimeout(() => {
    process.exit(0);
  }, shutdownFallbackTimeoutMs);

  try {
    process.kill(process.pid, "SIGTERM");
  } catch {
    process.exit(0);
  }
}

async function bootstrap(): Promise<void> {
  applyDesktopEnvironment();
  await maybeDelayStartupForSmoke();
  const entryPath = resolveServerEntrypoint();
  const startServer = await loadServerModule(entryPath);
  const started = await startServer();
  bootstrapped = true;

  sendMessage({
    type: "ready",
    payload: {
      apiUrl: started.apiUrl,
    },
  });
}

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

void bootstrap().catch((error) => {
  reportFatal(error.stack ?? error.message);
});

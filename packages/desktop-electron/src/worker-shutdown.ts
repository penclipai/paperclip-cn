export type WorkerShutdownRequest = {
  type: "shutdown";
  requestId: string;
};

export type WorkerShutdownComplete = {
  type: "shutdown-complete";
  requestId: string;
};

export type WorkerShutdownFailed = {
  type: "shutdown-failed";
  requestId: string;
  error: string;
};

export type WorkerShutdownMessage =
  | WorkerShutdownRequest
  | WorkerShutdownComplete
  | WorkerShutdownFailed;

type StartedServer = {
  shutdown: (signal: NodeJS.Signals) => Promise<void> | void;
};

type WorkerShutdownControllerOptions<T extends StartedServer> = {
  startup: Promise<T>;
  send: (message: WorkerShutdownComplete | WorkerShutdownFailed) => Promise<void>;
  exit: (code: number) => void;
  formatError: (error: unknown) => string;
};

export type WorkerShutdownController = {
  requestShutdown: (requestId?: string) => Promise<void>;
  isShutdownRequested: () => boolean;
};

type ShutdownChild = {
  pid?: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  send: (message: WorkerShutdownRequest, callback: (error: Error | null) => void) => boolean;
  on: (event: "message" | "exit", listener: (...args: any[]) => void) => unknown;
  removeListener: (event: "message" | "exit", listener: (...args: any[]) => void) => unknown;
};

type RequestWorkerShutdownOptions = {
  child: ShutdownChild;
  requestId: string;
  timeoutMs: number;
  forceKill: (pid: number) => Promise<void>;
};

export function isWorkerShutdownRequest(message: unknown): message is WorkerShutdownRequest {
  return Boolean(
    message
    && typeof message === "object"
    && (message as { type?: unknown }).type === "shutdown"
    && typeof (message as { requestId?: unknown }).requestId === "string"
    && (message as { requestId: string }).requestId.length > 0,
  );
}

export function createWorkerShutdownController<T extends StartedServer>(
  options: WorkerShutdownControllerOptions<T>,
): WorkerShutdownController {
  let shutdownPromise: Promise<void> | null = null;
  let shutdownRequested = false;

  const requestShutdown = (requestId?: string): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownRequested = true;
    shutdownPromise = (async () => {
      try {
        const started = await options.startup;
        await started.shutdown("SIGTERM");
        if (requestId) {
          await options.send({ type: "shutdown-complete", requestId });
        }
        options.exit(0);
      } catch (error) {
        const message = options.formatError(error);
        if (requestId) {
          try {
            await options.send({ type: "shutdown-failed", requestId, error: message });
          } catch {
            // The parent is gone; preserve the nonzero exit below.
          }
        }
        options.exit(1);
      }
    })();

    return shutdownPromise;
  };

  return {
    requestShutdown,
    isShutdownRequested: () => shutdownRequested,
  };
}

export function requestWorkerShutdown({
  child,
  requestId,
  timeoutMs,
  forceKill,
}: RequestWorkerShutdownOptions): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.reject(new Error("Desktop worker exited before acknowledging shutdown."));
  }

  return new Promise<void>((resolve, reject) => {
    let completeAcknowledged = false;
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      child.removeListener("message", onMessage);
      child.removeListener("exit", onExit);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const onMessage = (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const candidate = message as Partial<WorkerShutdownComplete | WorkerShutdownFailed>;
      if (candidate.requestId !== requestId) return;
      if (candidate.type === "shutdown-failed") {
        finish(new Error(`Desktop worker rejected shutdown: ${candidate.error ?? "unknown error"}`));
        return;
      }
      if (candidate.type === "shutdown-complete") {
        completeAcknowledged = true;
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (completeAcknowledged && code === 0 && signal === null) {
        finish();
        return;
      }
      finish(new Error(
        `Desktop worker exited without a successful shutdown acknowledgement (code ${code ?? "null"}, signal ${signal ?? "none"}).`,
      ));
    };
    const exited = () => child.exitCode !== null || child.signalCode !== null;

    child.on("message", onMessage);
    child.on("exit", onExit);
    timeout = setTimeout(() => {
      void (async () => {
        if (settled || exited()) {
          return;
        }

        const pid = child.pid;
        try {
          if (pid && Number.isInteger(pid) && pid > 0) {
            await forceKill(pid);
          }
        } catch (error) {
          finish(new Error(
            `Failed to force kill timed out desktop worker: ${error instanceof Error ? error.message : String(error)}`,
          ));
          return;
        }

        if (settled) {
          return;
        }
        if (exited()) {
          onExit(child.exitCode, child.signalCode);
          return;
        }
        finish(new Error(`Timed out waiting ${timeoutMs}ms for desktop worker shutdown.`));
      })().catch((error) => {
        finish(new Error(
          `Failed to finish timed out desktop worker shutdown: ${error instanceof Error ? error.message : String(error)}`,
        ));
      });
    }, timeoutMs);

    try {
      child.send({ type: "shutdown", requestId }, (error) => {
        if (error) {
          finish(new Error(`Desktop worker IPC shutdown request failed: ${error.message}`));
        }
      });
    } catch (error) {
      finish(new Error(
        `Desktop worker IPC shutdown request threw: ${error instanceof Error ? error.message : String(error)}`,
      ));
    }
  });
}

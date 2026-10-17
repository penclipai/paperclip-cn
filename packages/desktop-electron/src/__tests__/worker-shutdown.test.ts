import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerShutdownController, requestWorkerShutdown } from "../worker-shutdown.js";

class FakeChild extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  sent: unknown[] = [];

  send(message: unknown, callback?: (error: Error | null) => void): boolean {
    this.sent.push(message);
    callback?.(null);
    return true;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("createWorkerShutdownController", () => {
  it("waits for startup, shuts down once, then acknowledges before exit 0", async () => {
    const startup = deferred<{ shutdown: (signal: NodeJS.Signals) => Promise<void> }>();
    const events: string[] = [];
    const controller = createWorkerShutdownController({
      startup: startup.promise,
      send: async (message) => {
        events.push(`${message.type}:${message.requestId}`);
      },
      exit: (code) => events.push(`exit:${code}`),
      formatError: (error) => String(error),
    });

    const requested = controller.requestShutdown("request-1");
    expect(controller.isShutdownRequested()).toBe(true);
    expect(events).toEqual([]);

    startup.resolve({
      shutdown: async (signal) => {
        expect(signal).toBe("SIGTERM");
        events.push("shutdown");
      },
    });
    await requested;

    expect(events).toEqual(["shutdown", "shutdown-complete:request-1", "exit:0"]);
  });

  it("coalesces duplicate requests into one shutdown and one acknowledgement", async () => {
    let shutdownCalls = 0;
    const messages: string[] = [];
    const exits: number[] = [];
    const controller = createWorkerShutdownController({
      startup: Promise.resolve({
        shutdown: async () => {
          shutdownCalls += 1;
        },
      }),
      send: async (message) => {
        messages.push(`${message.type}:${message.requestId}`);
      },
      exit: (code) => exits.push(code),
      formatError: (error) => String(error),
    });

    await Promise.all([controller.requestShutdown("first"), controller.requestShutdown("second")]);

    expect(shutdownCalls).toBe(1);
    expect(messages).toEqual(["shutdown-complete:first"]);
    expect(exits).toEqual([0]);
  });

  it("acknowledges shutdown rejection and exits nonzero", async () => {
    const messages: Array<{ type: string; requestId: string; error?: string }> = [];
    const exits: number[] = [];
    const controller = createWorkerShutdownController({
      startup: Promise.resolve({
        shutdown: async () => {
          throw new Error("database shutdown failed");
        },
      }),
      send: async (message) => {
        messages.push(message);
      },
      exit: (code) => exits.push(code),
      formatError: (error) => error instanceof Error ? error.message : String(error),
    });

    await controller.requestShutdown("request-2");

    expect(messages).toEqual([{
      type: "shutdown-failed",
      requestId: "request-2",
      error: "database shutdown failed",
    }]);
    expect(exits).toEqual([1]);
  });

  it("uses the same orderly shutdown path when the parent disconnects", async () => {
    const exits: number[] = [];
    const controller = createWorkerShutdownController({
      startup: Promise.resolve({ shutdown: async () => undefined }),
      send: async () => {
        throw new Error("disconnect must not send an acknowledgement");
      },
      exit: (code) => exits.push(code),
      formatError: (error) => String(error),
    });

    await controller.requestShutdown();

    expect(exits).toEqual([0]);
  });

  it("requires a matching completion acknowledgement and exit 0", async () => {
    const child = new FakeChild();
    const stopping = requestWorkerShutdown({
      child,
      requestId: "request-3",
      timeoutMs: 1_000,
      forceKill: async () => undefined,
    });

    expect(child.sent).toEqual([{ type: "shutdown", requestId: "request-3" }]);
    child.emit("message", { type: "shutdown-complete", requestId: "other-request" });
    child.emit("message", { type: "shutdown-complete", requestId: "request-3" });
    child.exitCode = 0;
    child.emit("exit", 0, null);

    await expect(stopping).resolves.toBeUndefined();
  });

  it("rejects an exit 0 without a matching acknowledgement", async () => {
    const child = new FakeChild();
    const stopping = requestWorkerShutdown({
      child,
      requestId: "request-4",
      timeoutMs: 1_000,
      forceKill: async () => undefined,
    });

    child.exitCode = 0;
    child.emit("exit", 0, null);

    await expect(stopping).rejects.toThrow("without a successful shutdown acknowledgement");
  });

  it("allows a false send return when the child later acknowledges and exits", async () => {
    const child = new FakeChild();
    child.send = (message, callback) => {
      child.sent.push(message);
      callback?.(null);
      return false;
    };
    const stopping = requestWorkerShutdown({
      child,
      requestId: "request-backpressure",
      timeoutMs: 1_000,
      forceKill: async () => undefined,
    });

    child.emit("message", { type: "shutdown-complete", requestId: "request-backpressure" });
    child.exitCode = 0;
    child.emit("exit", 0, null);

    await expect(stopping).resolves.toBeUndefined();
  });

  it("rejects when the IPC shutdown callback reports a transport error", async () => {
    const child = new FakeChild();
    child.send = (_message, callback) => {
      callback?.(new Error("channel closed"));
      return false;
    };

    await expect(requestWorkerShutdown({
      child,
      requestId: "request-closed",
      timeoutMs: 1_000,
      forceKill: async () => undefined,
    })).rejects.toThrow("channel closed");
  });

  it("settles successfully when the worker exits during a deferred force kill", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const force = deferred<void>();
    const forceKill = vi.fn(() => force.promise);
    const stopping = requestWorkerShutdown({
      child,
      requestId: "request-race",
      timeoutMs: 120_000,
      forceKill,
    });

    await vi.advanceTimersByTimeAsync(120_000);
    expect(forceKill).toHaveBeenCalledWith(4242);
    child.emit("message", { type: "shutdown-complete", requestId: "request-race" });
    child.exitCode = 0;
    child.emit("exit", 0, null);
    force.resolve();

    await expect(stopping).resolves.toBeUndefined();
  });

  it("rejects boundedly when force kill fails", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const stopping = requestWorkerShutdown({
      child,
      requestId: "request-force-error",
      timeoutMs: 120_000,
      forceKill: async () => {
        throw new Error("taskkill failed");
      },
    });
    const rejection = expect(stopping).rejects.toThrow("taskkill failed");

    await vi.advanceTimersByTimeAsync(120_000);

    await rejection;
  });

  it("forces only the exact worker PID after the shutdown budget expires", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const forceKill = vi.fn(async () => undefined);
    const stopping = requestWorkerShutdown({
      child,
      requestId: "request-5",
      timeoutMs: 120_000,
      forceKill,
    });
    const rejection = expect(stopping).rejects.toThrow("Timed out waiting 120000ms");

    await vi.advanceTimersByTimeAsync(120_000);

    await rejection;
    expect(forceKill).toHaveBeenCalledTimes(1);
    expect(forceKill).toHaveBeenCalledWith(4242);
  });
});

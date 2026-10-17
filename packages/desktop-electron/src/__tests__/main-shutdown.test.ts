import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type BeforeQuitEvent = { preventDefault: ReturnType<typeof vi.fn> };

const harness = vi.hoisted(() => {
  class Emitter {
    private listeners = new Map<string | symbol, Array<(...args: any[]) => void>>();

    on(event: string | symbol, listener: (...args: any[]) => void): this {
      const entries = this.listeners.get(event) ?? [];
      entries.push(listener);
      this.listeners.set(event, entries);
      return this;
    }

    once(event: string | symbol, listener: (...args: any[]) => void): this {
      const onceListener = (...args: any[]) => {
        this.removeListener(event, onceListener);
        listener(...args);
      };
      return this.on(event, onceListener);
    }

    emit(event: string | symbol, ...args: any[]): boolean {
      for (const listener of [...(this.listeners.get(event) ?? [])]) {
        listener(...args);
      }
      return this.listeners.has(event);
    }

    removeAllListeners(): this {
      this.listeners.clear();
      return this;
    }

    removeListener(event: string | symbol, listener: (...args: any[]) => void): this {
      const entries = this.listeners.get(event);
      if (!entries) return this;
      this.listeners.set(event, entries.filter((entry) => entry !== listener));
      return this;
    }
  }

  class FakeChild extends Emitter {
    pid = 4242;
    exitCode: number | null = null;
    signalCode: NodeJS.Signals | null = null;
    stdout = new Emitter();
    stderr = new Emitter();
  }

  const createDeferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  };

  const appEvents = new Emitter();
  let ready = createDeferred<void>();
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const child = new FakeChild();
  const loadURL = vi.fn(async (..._args: unknown[]): Promise<void> => undefined);

  const app = Object.assign(appEvents, {
    exit: vi.fn(),
    getLocale: vi.fn(() => "en"),
    getPath: vi.fn(() => "D:\\paperclip-test-user-data"),
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    setAppUserModelId: vi.fn(),
    setName: vi.fn(),
    setPath: vi.fn(),
    whenReady: vi.fn(() => ready.promise),
  });

  class BrowserWindow extends Emitter {
    static fromWebContents = vi.fn(() => null);
    static getAllWindows = vi.fn(() => []);
    isDestroyed = vi.fn(() => false);
    isMinimized = vi.fn(() => false);
    loadURL = (...args: unknown[]): Promise<void> => loadURL(...args);
    focus = vi.fn();
    restore = vi.fn();
    setBackgroundColor = vi.fn();
    setTitleBarOverlay = vi.fn();
    webContents = Object.assign(new Emitter(), {
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
      clearHistory: vi.fn(),
      goBack: vi.fn(),
      goForward: vi.fn(),
      isDestroyed: vi.fn(() => false),
      navigationHistory: undefined,
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    });
  }

  return {
    app,
    child,
    createDeferred,
    handlers,
    loadURL,
    requestWorkerShutdown: vi.fn(),
    resolveReady() {
      ready.resolve();
    },
    reset() {
      appEvents.removeAllListeners();
      ready = createDeferred<void>();
      handlers.clear();
      child.removeAllListeners();
      child.exitCode = null;
      child.signalCode = null;
      app.exit.mockReset();
      app.quit.mockReset();
      app.whenReady.mockClear();
      loadURL.mockReset();
      loadURL.mockResolvedValue(undefined);
      this.requestWorkerShutdown.mockReset();
    },
    BrowserWindow,
  };
});

vi.mock("electron", () => ({
  app: harness.app,
  BrowserWindow: harness.BrowserWindow,
  ipcMain: { handle: (channel: string, handler: (...args: any[]) => unknown) => harness.handlers.set(channel, handler) },
  Menu: { setApplicationMenu: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  shell: { openExternal: vi.fn() },
}));

vi.mock("custom-electron-titlebar/main", () => ({
  setupTitlebarAndAttachToWindow: vi.fn(async () => () => undefined),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  fork: vi.fn(() => harness.child),
}));

vi.mock("../worker-shutdown.js", () => ({
  requestWorkerShutdown: harness.requestWorkerShutdown,
}));

const processSignals = ["SIGINT", "SIGTERM"] as const;
let processListenersBefore = new Map<string, Set<(...args: any[]) => void>>();

beforeEach(() => {
  processListenersBefore = new Map(
    processSignals.map((signal) => [signal, new Set(process.listeners(signal))]),
  );
});

afterEach(() => {
  for (const signal of processSignals) {
    const baseline = processListenersBefore.get(signal) ?? new Set<(...args: any[]) => void>();
    for (const listener of process.listeners(signal)) {
      if (!baseline.has(listener)) {
        process.removeListener(signal, listener);
      }
    }
  }
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.resetModules();
  harness.reset();
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function startWorkerAndBeginStop(kind: "timeout" | "fatal") {
  vi.useFakeTimers();
  const stopping = harness.createDeferred<void>();
  harness.requestWorkerShutdown.mockReturnValue(stopping.promise);
  await import("../main.js");
  harness.resolveReady();
  await flush();

  if (kind === "timeout") {
    await vi.advanceTimersByTimeAsync(60_000);
  } else {
    harness.child.emit("message", { type: "fatal", error: "worker failed" });
    await flush();
  }

  expect(harness.requestWorkerShutdown).toHaveBeenCalledTimes(1);
  return stopping;
}

function triggerBeforeQuit(): BeforeQuitEvent {
  const event: BeforeQuitEvent = { preventDefault: vi.fn() };
  harness.app.emit("before-quit", event);
  return event;
}

describe("desktop main shutdown", () => {
  it.each(["timeout", "fatal"] as const)("waits for a pending %s shutdown before quitting", async (kind) => {
    const stopping = await startWorkerAndBeginStop(kind);
    const quitEvent = triggerBeforeQuit();
    const retry = harness.handlers.get("desktop-shell:retry-start");

    expect(quitEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(harness.app.quit).not.toHaveBeenCalled();
    expect(retry).toBeTypeOf("function");

    const retryPromise = retry!();
    await flush();
    expect(harness.app.quit).not.toHaveBeenCalled();

    stopping.resolve();
    await retryPromise;
    await flush();

    expect(harness.app.quit).toHaveBeenCalledTimes(1);
    expect((await import("node:child_process")).fork).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing nonzero exit path when the pending shutdown fails", async () => {
    const stopping = await startWorkerAndBeginStop("timeout");
    const quitEvent = triggerBeforeQuit();

    stopping.reject(new Error("shutdown failed"));
    await flush();

    expect(quitEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(harness.app.quit).not.toHaveBeenCalled();
    expect(harness.app.exit).toHaveBeenCalledWith(1);
  });

  it("does not fork a worker when quit begins while the startup splash is loading", async () => {
    const splash = harness.createDeferred<void>();
    harness.loadURL.mockReturnValue(splash.promise);
    await import("../main.js");
    harness.resolveReady();
    await flush();

    const quitEvent = triggerBeforeQuit();
    splash.resolve();
    await flush();

    expect(quitEvent.preventDefault).not.toHaveBeenCalled();
    expect((await import("node:child_process")).fork).not.toHaveBeenCalled();
  });
});

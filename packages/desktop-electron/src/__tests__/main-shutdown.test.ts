import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  let testDirectory = "";
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const child = new FakeChild();
  const loadURL = vi.fn(async (..._args: unknown[]): Promise<void> => undefined);
  const dialog = { showMessageBox: vi.fn(async () => ({ response: 0 })) };
  const nativeImage = {
    createFromPath: vi.fn((_path: string): { isEmpty: () => boolean } => ({ isEmpty: () => false })),
  };
  const menu = { buildFromTemplate: vi.fn((template: unknown[]) => template), setApplicationMenu: vi.fn() };
  const screen = {
    getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } })),
    getAllDisplays: vi.fn(() => [{ workArea: { x: 0, y: 0, width: 1280, height: 800 } }]),
  };

  const app = Object.assign(appEvents, {
    exit: vi.fn(),
    getLocale: vi.fn(() => "en"),
    getPath: vi.fn(() => testDirectory),
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
    static latest: BrowserWindow | null = null;
    static latestOptions: Record<string, unknown> | null = null;
    private bounds = { x: 0, y: 0, width: 1280, height: 800 };
    constructor(options?: Record<string, unknown>) {
      super();
      BrowserWindow.latest = this;
      BrowserWindow.latestOptions = options ?? null;
      if (typeof options?.x === "number" && typeof options.y === "number"
        && typeof options.width === "number" && typeof options.height === "number") {
        this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      }
      const contents = this.webContents as { mainFrame?: unknown };
      contents.mainFrame = contents;
    }
    isDestroyed = vi.fn(() => false);
    isMinimized = vi.fn(() => false);
    private visible = true;
    isVisible = vi.fn(() => this.visible);
    isFocused = vi.fn(() => true);
    isMaximized = vi.fn(() => false);
    getNormalBounds = vi.fn(() => ({ x: 0, y: 0, width: 1280, height: 800 }));
    getBounds = vi.fn(() => ({ ...this.bounds }));
    setBounds = vi.fn((bounds: { x: number; y: number; width: number; height: number }) => {
      this.bounds = { ...bounds };
    });
    loadURL = (...args: unknown[]): Promise<void> => loadURL(...args);
    focus = vi.fn();
    restore = vi.fn();
    show = vi.fn(() => { this.visible = true; });
    hide = vi.fn(() => { this.visible = false; });
    maximize = vi.fn();
    setBackgroundColor = vi.fn();
    setTitleBarOverlay = vi.fn();
    webContents = Object.assign(new Emitter(), {
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
      clearHistory: vi.fn(),
      goBack: vi.fn(),
      goForward: vi.fn(),
      getURL: vi.fn(() => "http://127.0.0.1:3100/"),
      isDestroyed: vi.fn(() => false),
      navigationHistory: undefined,
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    });
  }

  class FakeTray extends Emitter {
    static latest: FakeTray | null = null;
    contextMenu: unknown;
    setContextMenu = vi.fn((menuTemplate: unknown) => { this.contextMenu = menuTemplate; });
    setToolTip = vi.fn();
    constructor(_icon: unknown) {
      super();
      FakeTray.latest = this;
    }
  }

  class FakeNotification extends Emitter {
    static latest: FakeNotification | null = null;
    static isSupported = vi.fn(() => true);
    readonly options: unknown;
    show = vi.fn();
    close = vi.fn(() => this.emit("close"));
    constructor(options: unknown) {
      super();
      this.options = options;
      FakeNotification.latest = this;
    }
  }

  return {
    app,
    child,
    createDeferred,
    handlers,
    loadURL,
    dialog,
    menu,
    nativeImage,
    screen,
    requestWorkerShutdown: vi.fn(),
    FakeNotification,
    FakeTray,
    resolveReady() {
      ready.resolve();
    },
    getTestDirectory() {
      return testDirectory;
    },
    setTestDirectory(directory: string) {
      testDirectory = directory;
    },
    reset() {
      testDirectory = "";
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
      dialog.showMessageBox.mockReset();
      dialog.showMessageBox.mockResolvedValue({ response: 0 });
      nativeImage.createFromPath.mockReset();
      nativeImage.createFromPath.mockReturnValue({ isEmpty: () => false });
      menu.buildFromTemplate.mockClear();
      menu.setApplicationMenu.mockClear();
      screen.getPrimaryDisplay.mockReset();
      screen.getPrimaryDisplay.mockReturnValue({ workArea: { x: 0, y: 0, width: 1280, height: 800 } });
      screen.getAllDisplays.mockReset();
      screen.getAllDisplays.mockReturnValue([{ workArea: { x: 0, y: 0, width: 1280, height: 800 } }]);
      BrowserWindow.latest = null;
      BrowserWindow.latestOptions = null;
      FakeTray.latest = null;
      FakeNotification.latest = null;
      FakeNotification.isSupported.mockReset();
      FakeNotification.isSupported.mockReturnValue(true);
    },
    BrowserWindow,
  };
});

vi.mock("electron", () => ({
  app: harness.app,
  BrowserWindow: harness.BrowserWindow,
  ipcMain: { handle: (channel: string, handler: (...args: any[]) => unknown) => harness.handlers.set(channel, handler) },
  Menu: harness.menu,
  dialog: harness.dialog,
  nativeTheme: { shouldUseDarkColors: false },
  Notification: harness.FakeNotification,
  Tray: harness.FakeTray,
  nativeImage: harness.nativeImage,
  screen: harness.screen,
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
  harness.setTestDirectory(fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-desktop-lifecycle-")));
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
  fs.rmSync(harness.getTestDirectory(), { recursive: true, force: true });
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

async function startReadyApp(): Promise<InstanceType<typeof harness.BrowserWindow>> {
  await import("../main.js");
  harness.resolveReady();
  await flush();
  harness.child.emit("message", { type: "ready", payload: { apiUrl: "http://127.0.0.1:3100/api" } });
  await flush();
  const window = harness.BrowserWindow.latest;
  expect(window).not.toBeNull();
  return window!;
}

function trustedEvent(window: InstanceType<typeof harness.BrowserWindow>) {
  const sender = window.webContents as unknown as { mainFrame: unknown };
  return { sender, senderFrame: sender.mainFrame };
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

  it("keeps constructor bounds and minimum size within a small display work area", async () => {
    harness.screen.getPrimaryDisplay.mockReturnValue({ workArea: { x: 0, y: 0, width: 640, height: 480 } });
    harness.screen.getAllDisplays.mockReturnValue([{ workArea: { x: 0, y: 0, width: 640, height: 480 } }]);

    await import("../main.js");
    harness.resolveReady();
    await flush();

    expect(harness.BrowserWindow.latestOptions).toMatchObject({
      width: 640,
      height: 480,
      minWidth: expect.any(Number),
      minHeight: expect.any(Number),
    });
    expect(harness.BrowserWindow.latestOptions!.minWidth).toBeLessThanOrEqual(640);
    expect(harness.BrowserWindow.latestOptions!.minHeight).toBeLessThanOrEqual(480);
  });

  it("corrects restored bounds before maximizing or showing the desktop window", async () => {
    const preferencesDirectory = harness.getTestDirectory();
    fs.mkdirSync(preferencesDirectory, { recursive: true });
    const restoredBounds = { x: 45, y: 55, width: 961, height: 682 };
    fs.writeFileSync(path.join(preferencesDirectory, "desktop-preferences.json"), JSON.stringify({
      window: { bounds: restoredBounds, maximized: true },
    }));

    await import("../main.js");
    harness.resolveReady();
    await flush();

    const window = harness.BrowserWindow.latest!;
    expect(window.setBounds).toHaveBeenCalledWith(restoredBounds);
    expect(window.setBounds.mock.invocationCallOrder[0]).toBeLessThan(window.maximize.mock.invocationCallOrder[0]!);
    window.emit("ready-to-show");
    expect(window.maximize.mock.invocationCallOrder[0]).toBeLessThan(window.show.mock.invocationCallOrder[0]!);
  });

  it("does not expose shell preferences to an untrusted renderer", async () => {
    await import("../main.js");
    harness.resolveReady();
    await flush();
    harness.child.emit("message", { type: "ready", payload: { apiUrl: "http://127.0.0.1:3100/api" } });
    await flush();

    const getPreferences = harness.handlers.get("desktop-shell:get-preferences");
    const window = harness.BrowserWindow.latest;
    expect(getPreferences).toBeTypeOf("function");
    expect(window).not.toBeNull();
    expect(await getPreferences!({ sender: {}, senderFrame: {} })).toBeNull();
    const contents = window!.webContents as unknown as { mainFrame: unknown };
    expect(await getPreferences!({ sender: contents, senderFrame: {} })).toBeNull();
    expect(await getPreferences!({ sender: contents, senderFrame: contents.mainFrame })).toMatchObject({
      closeToTray: true,
      notificationsEnabled: true,
    });
  });

  it("hides to the tray and restores the same window for tray and second-instance activation", async () => {
    const window = await startReadyApp();
    const closeEvent: BeforeQuitEvent = { preventDefault: vi.fn() };

    window.emit("close", closeEvent);
    await flush();

    expect(closeEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(window.hide).toHaveBeenCalledTimes(1);
    expect(harness.requestWorkerShutdown).not.toHaveBeenCalled();
    const tray = harness.FakeTray.latest;
    expect(tray).not.toBeNull();

    tray!.emit("click");
    harness.app.emit("second-instance");
    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(2);
  });

  it("falls back to the explicit quit confirmation if the tray cannot be created", async () => {
    const window = await startReadyApp();
    harness.nativeImage.createFromPath.mockReturnValue({ isEmpty: () => true });
    const closeEvent: BeforeQuitEvent = { preventDefault: vi.fn() };

    window.emit("close", closeEvent);
    await flush();

    expect(closeEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(window.hide).not.toHaveBeenCalled();
    expect(harness.dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(harness.requestWorkerShutdown).not.toHaveBeenCalled();
  });

  it("keeps a user quit cancellable and serializes confirmation and graceful shutdown", async () => {
    const window = await startReadyApp();
    const quit = harness.handlers.get("desktop-shell:quit");
    const response = harness.createDeferred<{ response: number }>();
    const beforeQuitEvents: BeforeQuitEvent[] = [];
    harness.dialog.showMessageBox.mockReturnValue(response.promise);
    harness.requestWorkerShutdown.mockResolvedValue(undefined);
    harness.app.quit.mockImplementation(() => {
      const event: BeforeQuitEvent = { preventDefault: vi.fn() };
      beforeQuitEvents.push(event);
      harness.app.emit("before-quit", event);
    });

    const first = quit!(trustedEvent(window));
    const second = quit!(trustedEvent(window));
    await flush();
    expect(harness.dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(harness.requestWorkerShutdown).not.toHaveBeenCalled();

    response.resolve({ response: 1 });
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    await flush();

    expect(harness.requestWorkerShutdown).toHaveBeenCalledTimes(1);
    expect(beforeQuitEvents).toHaveLength(2);
    expect(beforeQuitEvents[0]!.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("shows the selected Chinese shutdown progress after quitting from a hidden window", async () => {
    const window = await startReadyApp();
    await harness.handlers.get("desktop-shell:set-context")!(trustedEvent(window), {
      locale: "zh-CN", companyId: null, activeRuns: null,
    });
    window.hide();
    harness.dialog.showMessageBox.mockResolvedValue({ response: 1 });
    harness.requestWorkerShutdown.mockResolvedValue(undefined);
    harness.app.quit.mockImplementation(() => {
      harness.app.emit("before-quit", { preventDefault: vi.fn() });
    });

    await harness.handlers.get("desktop-shell:quit")!(trustedEvent(window));
    await flush();

    expect(window.isVisible()).toBe(true);
    expect(window.show.mock.invocationCallOrder[0]).toBeLessThan(
      harness.dialog.showMessageBox.mock.invocationCallOrder[0]!,
    );
    const splashUrl = harness.loadURL.mock.calls.at(-1)?.[0];
    expect(decodeURIComponent(String(splashUrl))).toContain("正在退出 Paperclip CN");
    expect(harness.requestWorkerShutdown).toHaveBeenCalledTimes(1);
  });

  it("keeps a cancelled Windows session query in normal tray-close mode", async () => {
    const window = await startReadyApp();
    const closeEvent: BeforeQuitEvent = { preventDefault: vi.fn() };

    window.emit("query-session-end");
    window.emit("close", closeEvent);
    await flush();

    expect(harness.requestWorkerShutdown).not.toHaveBeenCalled();
    expect(closeEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(window.hide).toHaveBeenCalledTimes(1);
  });

  it("starts nonblocking cleanup only after Windows ends the session", async () => {
    const window = await startReadyApp();
    const closeEvent: BeforeQuitEvent = { preventDefault: vi.fn() };
    harness.requestWorkerShutdown.mockResolvedValue(undefined);

    window.emit("session-end");
    await flush();
    window.emit("close", closeEvent);

    expect(harness.requestWorkerShutdown).toHaveBeenCalledTimes(1);
    expect(closeEvent.preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
    expect(harness.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("rejects desktop IPC from subframes, external origins, and another window", async () => {
    const window = await startReadyApp();
    const setContext = harness.handlers.get("desktop-shell:set-context");
    const contents = window.webContents as unknown as { mainFrame: unknown; getURL: ReturnType<typeof vi.fn> };
    const trusted = trustedEvent(window);
    expect(setContext).toBeTypeOf("function");

    expect(await setContext!({ sender: contents, senderFrame: {} }, { locale: "en", companyId: "company-a", activeRuns: 0 })).toBe(false);
    contents.getURL.mockReturnValueOnce("https://example.invalid/");
    expect(await setContext!(trusted, { locale: "en", companyId: "company-a", activeRuns: 0 })).toBe(false);
    const otherWindow = new harness.BrowserWindow();
    expect(await setContext!(trustedEvent(otherWindow), { locale: "en", companyId: "company-a", activeRuns: 0 })).toBe(false);
  });

  it("uses metadata-only native notifications and invalidates clicks after a company switch", async () => {
    const window = await startReadyApp();
    window.isVisible.mockReturnValue(false);
    window.isFocused.mockReturnValue(false);
    const context = harness.handlers.get("desktop-shell:set-context");
    const notify = harness.handlers.get("desktop-shell:notify");
    const trusted = trustedEvent(window);
    expect(await context!(trusted, { locale: "en", companyId: "company-a", activeRuns: 0 })).toBe(true);

    expect(await notify!(trusted, {
      id: "event-1",
      companyId: "company-a",
      kind: "run_failed",
      targetPath: "/company/issues/issue-1",
      title: "customer secret",
      error: "raw model output",
    })).toBe(true);
    const notification = harness.FakeNotification.latest;
    expect(notification).not.toBeNull();
    expect(notification!.show).toHaveBeenCalledTimes(1);
    const payload = notification!.options as { title: string; body: string };
    expect(`${payload.title} ${payload.body}`).not.toContain("customer secret");
    expect(`${payload.title} ${payload.body}`).not.toContain("raw model output");

    notification!.emit("click");
    expect(window.webContents.send).toHaveBeenCalledWith("desktop-shell:navigate", "/company/issues/issue-1");
    window.webContents.send.mockClear();
    expect(await notify!(trusted, {
      id: "event-2",
      companyId: "company-a",
      kind: "approval",
      targetPath: "/company/inbox",
    })).toBe(true);
    const staleNotification = harness.FakeNotification.latest;
    expect(staleNotification).not.toBeNull();
    expect(await context!(trusted, { locale: "en", companyId: "company-b", activeRuns: 0 })).toBe(true);
    expect(staleNotification!.close).toHaveBeenCalledTimes(1);
    staleNotification!.emit("click");
    expect(window.webContents.send).not.toHaveBeenCalled();
    expect(await context!(trusted, { locale: "en", companyId: "company-a", activeRuns: 0 })).toBe(true);
    staleNotification!.emit("click");
    expect(window.webContents.send).not.toHaveBeenCalled();
  });

  it("applies tray notification changes immediately and invalidates an old click after re-enable", async () => {
    const window = await startReadyApp();
    const context = harness.handlers.get("desktop-shell:set-context");
    const notify = harness.handlers.get("desktop-shell:notify");
    const getPreferences = harness.handlers.get("desktop-shell:get-preferences");
    const trusted = trustedEvent(window);
    await context!(trusted, { locale: "en", companyId: "company-a", activeRuns: 0 });
    window.emit("close", { preventDefault: vi.fn() });
    await flush();
    expect(await notify!(trusted, {
      id: "event-disable",
      companyId: "company-a",
      kind: "approval",
      targetPath: "/company/inbox",
    })).toBe(true);
    const notification = harness.FakeNotification.latest;
    const trayMenu = harness.FakeTray.latest!.contextMenu as Array<{ type?: string; click?: (item: { checked: boolean }) => void }>;
    const notificationToggle = trayMenu.find((item) => item.type === "checkbox" && item.click !== undefined && trayMenu.indexOf(item) > 3);
    expect(notificationToggle).toBeDefined();

    notificationToggle!.click!({ checked: false });
    expect(notification!.close).toHaveBeenCalledTimes(1);
    expect(await getPreferences!(trusted)).toMatchObject({ notificationsEnabled: false });

    const rebuiltMenu = harness.FakeTray.latest!.contextMenu as Array<{ type?: string; click?: (item: { checked: boolean }) => void }>;
    const rebuiltNotificationToggle = rebuiltMenu.find((item) => item.type === "checkbox" && item.click !== undefined && rebuiltMenu.indexOf(item) > 3);
    rebuiltNotificationToggle!.click!({ checked: true });
    window.webContents.send.mockClear();
    notification!.emit("click");
    expect(window.webContents.send).not.toHaveBeenCalled();
  });

  it("rejects invalid, cross-company, and replayed notification intents", async () => {
    const window = await startReadyApp();
    window.isVisible.mockReturnValue(false);
    window.isFocused.mockReturnValue(false);
    const context = harness.handlers.get("desktop-shell:set-context");
    const notify = harness.handlers.get("desktop-shell:notify");
    const trusted = trustedEvent(window);
    await context!(trusted, { locale: "en", companyId: "company-a", activeRuns: 0 });

    expect(await notify!(trusted, { id: "wrong-company", companyId: "company-b", kind: "approval", targetPath: "/company/inbox" })).toBe(false);
    expect(await notify!(trusted, { id: "bad-route", companyId: "company-a", kind: "approval", targetPath: "https://example.invalid/" })).toBe(false);
    const valid = { id: "event-2", companyId: "company-a", kind: "approval", targetPath: "/company/inbox" };
    expect(await notify!(trusted, valid)).toBe(true);
    expect(await notify!(trusted, valid)).toBe(false);
  });
});

import { execFile, fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell, type WebContents } from "electron";
import { setupTitlebarAndAttachToWindow } from "custom-electron-titlebar/main";
import {
  DESKTOP_APP_ID,
  DESKTOP_WINDOW_TITLE,
  buildWorkerEnvironment,
  formatChildExit,
  getDesktopTitlebarOverlay,
  getDesktopWindowBackground,
  isDesktopTheme,
  resolveDesktopAppRoot,
  resolveDesktopPreferencesPath,
  resolveDesktopRepoRoot,
  resolveDesktopTheme,
  resolveDesktopUserDataDir,
  resolvePackagedRuntimeRoot,
  resolveTitlebarThemePath,
  shouldOpenExternalNavigation,
  type DesktopMode,
  type DesktopTheme,
  writeDesktopThemePreference,
} from "./runtime.js";
import { createSplashDataUrl, type SplashState } from "./splash.js";

type WorkerReadyMessage = {
  type: "ready";
  payload: {
    apiUrl: string;
  };
};

type WorkerFatalMessage = {
  type: "fatal";
  error: string;
};

type WorkerMessage = WorkerReadyMessage | WorkerFatalMessage;
type NativeTitlebarSyncPayload = {
  backgroundColor: string;
  overlay: {
    color: string;
    symbolColor: string;
    height: number;
  };
};

type NavigationState = {
  canGoBack: boolean;
  canGoForward: boolean;
};

const __filename = fileURLToPath(import.meta.url);
const desktopAppRoot = resolveDesktopAppRoot(__filename);
const repoRoot = resolveDesktopRepoRoot(desktopAppRoot);
const workerScript = path.resolve(desktopAppRoot, "dist", "server-worker.js");
const tsxLoaderImport = pathToFileURL(
  path.resolve(desktopAppRoot, "node_modules", "tsx", "dist", "loader.mjs"),
).href;

app.setName(DESKTOP_WINDOW_TITLE);
app.setAppUserModelId(DESKTOP_APP_ID);
Menu.setApplicationMenu(null);

const desktopMode: DesktopMode =
  process.env.PAPERCLIP_DESKTOP_DEV === "true" ? "development" : "packaged";
const startupTimeoutMs = 60_000;
const waitingSplashDelayMs = 1_800;
const workerGracefulShutdownTimeoutMs = 5_000;
const workerForceKillWaitTimeoutMs = 2_000;
const defaultUserDataDir = app.getPath("userData");
const configuredUserDataDir = resolveDesktopUserDataDir(defaultUserDataDir);
const execFileAsync = promisify(execFile);

if (configuredUserDataDir !== defaultUserDataDir) {
  app.setPath("userData", configuredUserDataDir);
}

const desktopUserDataDir = app.getPath("userData");
const desktopPreferencesPath = resolveDesktopPreferencesPath(desktopUserDataDir);

let mainWindow: BrowserWindow | null = null;
let workerProcess: ChildProcess | null = null;
let currentAppUrl: string | null = null;
let startupTimer: NodeJS.Timeout | null = null;
let waitingSplashTimer: NodeJS.Timeout | null = null;
let appIsQuitting = false;
let shutdownPromise: Promise<void> | null = null;
let startupSequence = 0;
let detachTitlebar: (() => void) | null = null;
let currentDesktopTheme: DesktopTheme = resolveDesktopTheme(
  desktopUserDataDir,
  nativeTheme.shouldUseDarkColors,
);
const expectedExitPids = new Set<number>();

function getLocale(): string {
  try {
    return app.getLocale();
  } catch {
    return "en";
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

async function forceKillProcessTree(pid: number): Promise<void> {
  if (!isPidAlive(pid)) return;

  if (process.platform !== "win32") {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Ignore cleanup races.
    }
    return;
  }

  try {
    await execFileAsync(
      process.env.comspec ?? "cmd.exe",
      ["/d", "/s", "/c", "taskkill", "/PID", String(pid), "/T", "/F"],
      { windowsHide: true },
    );
  } catch (error) {
    if (isPidAlive(pid)) {
      console.warn("[desktop-main] Failed to force kill worker process tree:", error);
    }
  }
}

async function waitForChildExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
}

function clearStartupTimers(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (waitingSplashTimer) {
    clearTimeout(waitingSplashTimer);
    waitingSplashTimer = null;
  }
}

async function loadSplashState(state: SplashState, detail?: string): Promise<void> {
  await ensureWindow().loadURL(
    createSplashDataUrl({
      locale: getLocale(),
      theme: currentDesktopTheme,
      state,
      detail,
    }),
  );
}

function attachCustomTitlebar(win: BrowserWindow): void {
  void setupTitlebarAndAttachToWindow(win, {
    themeConfigPath: resolveTitlebarThemePath(desktopAppRoot),
  })
    .then((detach) => {
      detachTitlebar = detach;
    })
    .catch((error) => {
      console.warn("[desktop-main] Failed to attach custom title bar:", error);
    });
}

function syncNativeTitlebar(
  win: BrowserWindow,
  payload: NativeTitlebarSyncPayload,
): boolean {
  try {
    win.setBackgroundColor(payload.backgroundColor);

    if (process.platform === "darwin") {
      return false;
    }

    win.setTitleBarOverlay(payload.overlay);
    return true;
  } catch (error) {
    console.warn("[desktop-main] Failed to sync native title bar theme:", error);
    return false;
  }
}

function getNavigationState(contents: WebContents): NavigationState {
  const history = contents.navigationHistory;
  const canGoBack = history && typeof history.canGoBack === "function"
    ? history.canGoBack()
    : contents.canGoBack();
  const canGoForward = history && typeof history.canGoForward === "function"
    ? history.canGoForward()
    : contents.canGoForward();

  return {
    canGoBack,
    canGoForward,
  };
}

function emitDesktopShellEvent(
  win: BrowserWindow,
  channel: "desktop-shell:navigation-state-changed" | "desktop-shell:refresh-titlebar",
  payload?: NavigationState,
): void {
  if (win.isDestroyed() || win.webContents.isDestroyed()) {
    return;
  }

  win.webContents.send(channel, payload);
}

function emitNavigationState(win: BrowserWindow): void {
  emitDesktopShellEvent(win, "desktop-shell:navigation-state-changed", getNavigationState(win.webContents));
}

function emitTitlebarRefresh(win: BrowserWindow): void {
  emitDesktopShellEvent(win, "desktop-shell:refresh-titlebar");
}

function clearNavigationHistory(contents: WebContents): void {
  const history = contents.navigationHistory;

  if (history && typeof history.clear === "function") {
    history.clear();
    return;
  }

  if (typeof contents.clearHistory === "function") {
    contents.clearHistory();
  }
}

function navigateHistory(contents: WebContents, direction: "back" | "forward"): boolean {
  const history = contents.navigationHistory;

  if (direction === "back") {
    if (history && typeof history.canGoBack === "function" && history.canGoBack()) {
      history.goBack();
      return true;
    }

    if (contents.canGoBack()) {
      contents.goBack();
      return true;
    }

    return false;
  }

  if (history && typeof history.canGoForward === "function" && history.canGoForward()) {
    history.goForward();
    return true;
  }

  if (contents.canGoForward()) {
    contents.goForward();
    return true;
  }

  return false;
}

async function loadMainAppUrl(win: BrowserWindow, url: string): Promise<void> {
  await win.loadURL(url);
  clearNavigationHistory(win.webContents);
  emitNavigationState(win);
  emitTitlebarRefresh(win);
}

function ensureWindow(): BrowserWindow {
  if (mainWindow) return mainWindow;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: DESKTOP_WINDOW_TITLE,
    backgroundColor: getDesktopWindowBackground(currentDesktopTheme),
    titleBarStyle: "hidden",
    titleBarOverlay: process.platform === "darwin"
      ? false
      : getDesktopTitlebarOverlay(currentDesktopTheme),
    icon:
      process.platform === "darwin" || desktopMode !== "development"
        ? undefined
        : path.resolve(desktopAppRoot, "assets", "icon.png"),
    webPreferences: {
      additionalArguments: [`--paperclip-desktop-initial-theme=${currentDesktopTheme}`],
      preload: path.resolve(desktopAppRoot, "dist", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  attachCustomTitlebar(mainWindow);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    detachTitlebar?.();
    detachTitlebar = null;
    mainWindow = null;
  });

  mainWindow.on("focus", () => {
    if (!mainWindow) {
      return;
    }

    emitTitlebarRefresh(mainWindow);
  });

  mainWindow.on("restore", () => {
    if (!mainWindow) {
      return;
    }

    emitTitlebarRefresh(mainWindow);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternalNavigation(url, currentAppUrl)) {
      void shell.openExternal(url);
      return { action: "deny" };
    }

    return { action: "allow" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!shouldOpenExternalNavigation(url, currentAppUrl)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  mainWindow.webContents.on("did-navigate", () => {
    if (!mainWindow) {
      return;
    }

    emitNavigationState(mainWindow);
  });

  mainWindow.webContents.on("did-navigate-in-page", () => {
    if (!mainWindow) {
      return;
    }

    emitNavigationState(mainWindow);
  });

  mainWindow.webContents.on("did-stop-loading", () => {
    if (!mainWindow) {
      return;
    }

    emitNavigationState(mainWindow);
    emitTitlebarRefresh(mainWindow);
  });

  return mainWindow;
}

async function showStartupError(detail: string): Promise<void> {
  await loadSplashState("error", detail);
}

async function stopWorkerProcess(): Promise<void> {
  const child = workerProcess;
  if (!child) return;

  workerProcess = null;
  clearStartupTimers();
  currentAppUrl = null;

  if (child.pid) {
    expectedExitPids.add(child.pid);
  }

  const alreadyExited = child.exitCode !== null || child.signalCode !== null;
  if (!alreadyExited) {
    try {
      child.kill("SIGTERM");
    } catch {
      // Child may already be gone by the time we attempt shutdown.
    }
  }

  if (alreadyExited) {
    return;
  }

  const childPid = child.pid ?? null;
  const exitPromise = waitForChildExit(child);

  if (childPid && Number.isInteger(childPid) && childPid > 0) {
    const gracefulDeadline = Date.now() + workerGracefulShutdownTimeoutMs;
    while (Date.now() < gracefulDeadline) {
      if (!isPidAlive(childPid)) {
        await exitPromise;
        return;
      }
      await delay(100);
    }

    if (isPidAlive(childPid)) {
      await forceKillProcessTree(childPid);
      const forceKillDeadline = Date.now() + workerForceKillWaitTimeoutMs;
      while (Date.now() < forceKillDeadline) {
        if (!isPidAlive(childPid)) {
          break;
        }
        await delay(100);
      }
    }
  }

  await Promise.race([
    exitPromise,
    delay(workerForceKillWaitTimeoutMs).then(() => undefined),
  ]);
}

function attachWorkerLogging(child: ChildProcess): void {
  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[desktop-worker] ${String(chunk)}`);
  });

  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[desktop-worker] ${String(chunk)}`);
  });
}

async function startWorkerProcess(reason: string): Promise<void> {
  const sequence = ++startupSequence;
  await stopWorkerProcess();
  await loadSplashState("starting");

  const env = buildWorkerEnvironment({
    appRoot: desktopAppRoot,
    repoRoot,
    userDataDir: desktopUserDataDir,
    mode: desktopMode,
  });

  const child = fork(workerScript, [], {
    cwd: desktopMode === "development" ? repoRoot : resolvePackagedRuntimeRoot(desktopAppRoot),
    env: {
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
    },
    execPath: process.execPath,
    execArgv: desktopMode === "development" ? ["--import", tsxLoaderImport] : [],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  workerProcess = child;
  attachWorkerLogging(child);

  waitingSplashTimer = setTimeout(() => {
    if (workerProcess !== child || sequence !== startupSequence) return;
    void loadSplashState("waiting");
  }, waitingSplashDelayMs);

  startupTimer = setTimeout(() => {
    if (workerProcess !== child || sequence !== startupSequence) return;
    void showStartupError(
      getLocale().toLowerCase().startsWith("zh")
        ? "打开时间比平时更久。你可以再试一次；如果还是不行，再查看终端日志。"
        : "Startup is taking longer than usual. Try again once, then check the terminal logs if it still fails.",
    );
    void stopWorkerProcess();
  }, startupTimeoutMs);

  child.on("message", (message: WorkerMessage) => {
    if (workerProcess !== child || sequence !== startupSequence) return;

    if (message?.type === "ready") {
      clearStartupTimers();
      currentAppUrl = message.payload.apiUrl.replace(/\/api\/?$/, "");
      void loadMainAppUrl(ensureWindow(), currentAppUrl).catch((error) => {
        console.warn("[desktop-main] Failed to load desktop app URL:", error);
        void showStartupError(error instanceof Error ? error.message : String(error));
      });
      return;
    }

    if (message?.type === "fatal") {
      clearStartupTimers();
      void showStartupError(message.error);
      void stopWorkerProcess();
    }
  });

  child.once("error", (error) => {
    if (workerProcess !== child || sequence !== startupSequence) return;
    clearStartupTimers();
    void showStartupError(error.message);
  });

  child.once("exit", (code, signal) => {
    clearStartupTimers();
    const wasExpected = child.pid ? expectedExitPids.delete(child.pid) : false;
    if (workerProcess === child) {
      workerProcess = null;
    }
    if (appIsQuitting || wasExpected) return;

    void showStartupError(
      getLocale().toLowerCase().startsWith("zh")
        ? `本地控制平面意外退出：${formatChildExit(code, signal)}。`
        : `The local control plane exited unexpectedly with ${formatChildExit(code, signal)}.`,
    );
  });

  console.log(`[desktop-main] Started worker for ${reason}.`);
}

function focusExistingWindow(): void {
  const win = ensureWindow();
  if (win.isMinimized()) {
    win.restore();
  }
  win.focus();
}

async function terminateApplication(signal: NodeJS.Signals): Promise<void> {
  appIsQuitting = true;
  await stopWorkerProcess();
  app.exit(signal === "SIGINT" ? 130 : 143);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    focusExistingWindow();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", (event) => {
    if (shutdownPromise || !workerProcess) {
      appIsQuitting = true;
      return;
    }

    event.preventDefault();
    appIsQuitting = true;
    shutdownPromise = stopWorkerProcess().finally(() => {
      shutdownPromise = null;
      app.quit();
    });
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void startWorkerProcess("activate");
      return;
    }
    focusExistingWindow();
  });

  ipcMain.handle("desktop-shell:retry-start", async () => {
    await startWorkerProcess("manual-retry");
  });

  ipcMain.handle("desktop-shell:update-titlebar", (event, payload: NativeTitlebarSyncPayload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return false;
    }

    return syncNativeTitlebar(win, payload);
  });

  ipcMain.handle("desktop-shell:get-navigation-state", (event) => {
    return getNavigationState(event.sender);
  });

  ipcMain.handle("desktop-shell:navigate-back", (event) => {
    const didNavigate = navigateHistory(event.sender, "back");
    const win = BrowserWindow.fromWebContents(event.sender);

    if (win) {
      emitNavigationState(win);
    }

    return didNavigate;
  });

  ipcMain.handle("desktop-shell:navigate-forward", (event) => {
    const didNavigate = navigateHistory(event.sender, "forward");
    const win = BrowserWindow.fromWebContents(event.sender);

    if (win) {
      emitNavigationState(win);
    }

    return didNavigate;
  });

  ipcMain.handle("desktop-shell:set-theme-preference", (_event, theme: unknown) => {
    if (!isDesktopTheme(theme)) {
      return false;
    }

    currentDesktopTheme = theme;

    try {
      writeDesktopThemePreference(desktopPreferencesPath, theme);
      return true;
    } catch (error) {
      console.warn("[desktop-main] Failed to persist theme preference:", error);
      return false;
    }
  });

  process.once("SIGINT", () => {
    void terminateApplication("SIGINT");
  });

  process.once("SIGTERM", () => {
    void terminateApplication("SIGTERM");
  });

  void app
    .whenReady()
    .then(async () => {
      ensureWindow();
      await startWorkerProcess("initial-start");
    })
    .catch(async (error) => {
      await showStartupError(error.message);
    });
}

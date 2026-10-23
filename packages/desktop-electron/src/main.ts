import { execFile, fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  screen,
  shell,
  Tray,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
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
  normalizeDesktopAppPath,
  readDesktopPreferences,
  resolveDesktopPreferencesPath,
  resolveDesktopRepoRoot,
  resolveDesktopTheme,
  resolveDesktopUserDataDir,
  resolvePackagedRuntimeRoot,
  resolveTitlebarThemePath,
  resolveDesktopWindowState,
  shouldOpenExternalNavigation,
  type DesktopMode,
  type DesktopTheme,
  type DesktopPreferences,
  writeDesktopPreferences,
  writeDesktopThemePreference,
} from "./runtime.js";
import {
  DesktopExperience,
  isTrustedDesktopFrame,
  parseDesktopContext,
  parseDesktopNotification,
  publicDesktopPreferences,
} from "./desktop-experience.js";
import { desktopNotificationCopy, desktopText } from "./desktop-copy.js";
import { desktopTrayMenu } from "./desktop-tray-menu.js";
import { DesktopWindowState } from "./desktop-window-state.js";
import { createSplashDataUrl, type SplashState } from "./splash.js";
import { requestWorkerShutdown } from "./worker-shutdown.js";

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
const workerGracefulShutdownTimeoutMs = 120_000;
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
let workerStopPromise: Promise<void> | null = null;
let startupSequence = 0;
let detachTitlebar: (() => void) | null = null;
let tray: Tray | null = null;
let systemSessionEnding = false;
let userQuitApproved = false;
let quitConfirmationPromise: Promise<boolean> | null = null;
const activeNotifications = new Set<Notification>();
let notificationEpoch = 0;
const initialDesktopLocale = readDesktopPreferences(desktopPreferencesPath).locale
  ?? (getLocale().toLowerCase().startsWith("zh") ? "zh-CN" : "en");
const desktopExperience = new DesktopExperience();
desktopExperience.setContext({ locale: initialDesktopLocale, companyId: null, activeRuns: null });
const desktopWindowState = new DesktopWindowState(desktopPreferencesPath);
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
      locale: desktopLocale(),
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

function desktopLocale(): "en" | "zh-CN" {
  return desktopExperience.getContext().locale;
}

function dismissNativeNotifications(): void {
  notificationEpoch += 1;
  for (const notification of activeNotifications) {
    try {
      notification.close();
    } catch {
      // The platform may already have dismissed this notification.
    }
  }
  activeNotifications.clear();
}

function preferences(): DesktopPreferences {
  return readDesktopPreferences(desktopPreferencesPath);
}

function hasNotificationSupport(): boolean {
  try {
    return typeof Notification === "function" && Notification.isSupported();
  } catch {
    return false;
  }
}

function showWindow(win = ensureWindow()): void {
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

function sendDesktopNavigation(targetPath: string): void {
  const normalized = normalizeDesktopAppPath(targetPath);
  if (!normalized || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop-shell:navigate", normalized);
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  const current = preferences();
  tray.setContextMenu(Menu.buildFromTemplate(desktopTrayMenu({
    locale: desktopLocale(),
    closeToTray: current.closeToTray !== false,
    notificationsEnabled: current.notificationsEnabled !== false,
    notificationsSupported: hasNotificationSupport(),
    open: () => showWindow(),
    settings: () => { showWindow(); sendDesktopNavigation("/company/settings/instance/profile"); },
    setPreference: (patch) => { updateShellPreferences(patch); },
    quit: () => { void requestUserQuit(); },
  })));
}

function updateShellPreferences(patch: Pick<DesktopPreferences, "closeToTray" | "notificationsEnabled">) {
  try {
    const next = writeDesktopPreferences(desktopPreferencesPath, patch);
    if (next.notificationsEnabled === false) dismissNativeNotifications();
    rebuildTrayMenu();
    return publicDesktopPreferences(next, {
      trayAvailable: ensureTray(), notificationsSupported: hasNotificationSupport(),
    });
  } catch (error) {
    console.warn("[desktop-main] Failed to persist shell preferences:", error);
    return null;
  }
}

function ensureTray(): boolean {
  if (tray) return true;
  if (typeof Tray !== "function") return false;
  try {
    const iconPath = desktopMode === "development"
      ? path.resolve(desktopAppRoot, "assets", "icon.png")
      : path.resolve(desktopAppRoot, "dist", "icon.png");
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) return false;
    tray = new Tray(icon);
    tray.setToolTip(DESKTOP_WINDOW_TITLE);
    tray.on("click", () => showWindow());
    tray.on("double-click", () => showWindow());
    rebuildTrayMenu();
    return true;
  } catch (error) {
    console.warn("[desktop-main] System tray is unavailable:", error);
    tray = null;
    return false;
  }
}

async function requestUserQuit(): Promise<boolean> {
  if (appIsQuitting || shutdownPromise) return false;
  if (quitConfirmationPromise) return quitConfirmationPromise;
  quitConfirmationPromise = (async () => {
    showWindow();
    const activeRuns = desktopExperience.getFreshActiveRuns();
    const detail = activeRuns === null
      ? desktopText("desktop.quit.unknownDetail", desktopLocale())
      : desktopText("desktop.quit.runningDetail", desktopLocale(), { count: activeRuns });
    const response = await dialog.showMessageBox(ensureWindow(), {
      type: "warning",
      buttons: [desktopText("desktop.quit.keepRunning", desktopLocale()), desktopText("desktop.quit.confirm", desktopLocale())],
      defaultId: 0,
      cancelId: 0,
      title: desktopText("desktop.quit.title", desktopLocale()),
      message: desktopText("desktop.quit.message", desktopLocale()),
      detail,
    });
    if (response.response !== 1) return false;
    userQuitApproved = true;
    dismissNativeNotifications();
    app.quit();
    return true;
  })();
  try {
    return await quitConfirmationPromise;
  } catch (error) {
    console.warn("[desktop-main] Quit confirmation failed:", error);
    return false;
  } finally {
    quitConfirmationPromise = null;
  }
}

function isTrustedDesktopSender(event: IpcMainInvokeEvent): boolean {
  return isTrustedDesktopFrame(event, mainWindow?.webContents, currentAppUrl);
}

function ensureWindow(): BrowserWindow {
  if (mainWindow) return mainWindow;

  const savedPreferences = preferences();
  let windowState = resolveDesktopWindowState(savedPreferences.window, [], {
    x: 0, y: 0, width: 1280, height: 800,
  });
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    windowState = resolveDesktopWindowState(
      savedPreferences.window,
      screen.getAllDisplays().map((display) => display.workArea),
      primaryDisplay.workArea,
    );
  } catch {
    // The native screen module is unavailable in the isolated unit-test harness.
  }

  mainWindow = new BrowserWindow({
    ...windowState.bounds,
    minWidth: Math.min(800, windowState.bounds.width),
    minHeight: Math.min(600, windowState.bounds.height),
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
  desktopWindowState.restoreBounds(mainWindow, windowState.bounds);

  if (windowState.maximized) mainWindow.maximize();

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    desktopWindowState.dispose();
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

  mainWindow.on("move", () => desktopWindowState.scheduleSave(mainWindow!));
  mainWindow.on("resize", () => desktopWindowState.scheduleSave(mainWindow!));
  mainWindow.on("close", (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) desktopWindowState.save(mainWindow);
    if (appIsQuitting || systemSessionEnding) return;
    if (preferences().closeToTray === false || !ensureTray()) {
      event.preventDefault();
      void requestUserQuit();
      return;
    }
    event.preventDefault();
    mainWindow?.hide();
    const current = preferences();
    if (!current.trayHintShown) {
      try {
        writeDesktopPreferences(desktopPreferencesPath, { trayHintShown: true });
      } catch (error) {
        console.warn("[desktop-main] Failed to save tray hint preference:", error);
      }
      void dialog.showMessageBox({
        type: "info",
        buttons: [desktopText("desktop.background.stay", desktopLocale()), desktopText("desktop.background.show", desktopLocale())],
        defaultId: 0,
        title: desktopText("desktop.background.title", desktopLocale()),
        message: desktopText("desktop.background.message", desktopLocale()),
      }).then((response) => {
        if (response.response === 1) showWindow();
      }).catch((error) => {
        console.warn("[desktop-main] Failed to show background notice:", error);
      });
    }
  });
  const endSession = () => {
    systemSessionEnding = true;
    appIsQuitting = true;
    if (mainWindow && !mainWindow.isDestroyed()) desktopWindowState.save(mainWindow);
    dismissNativeNotifications();
    // Windows does not emit before-quit for session shutdown. Start cleanup
    // without preventing the event or waiting for our ordinary quit deadline.
    void stopWorkerProcess().catch((error) => {
      console.warn("[desktop-main] Session shutdown cleanup failed:", error);
    });
  };
  // A query may be cancelled by another application; only committed session
  // ending may stop this worker or latch the terminal state.
  mainWindow.on("session-end", endSession);

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
    desktopWindowState.rememberPath(mainWindow, currentAppUrl);
  });

  mainWindow.webContents.on("did-navigate-in-page", () => {
    if (!mainWindow) {
      return;
    }

    emitNavigationState(mainWindow);
    desktopWindowState.rememberPath(mainWindow, currentAppUrl);
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

function stopWorkerProcess(): Promise<void> {
  if (workerStopPromise) {
    return workerStopPromise;
  }

  const child = workerProcess;
  if (!child) return Promise.resolve();

  const stopping = (async () => {
    workerProcess = null;
    clearStartupTimers();
    currentAppUrl = null;

    if (child.pid) {
      expectedExitPids.add(child.pid);
    }

    const alreadyExited = child.exitCode !== null || child.signalCode !== null;
    if (alreadyExited) {
      return;
    }

    await requestWorkerShutdown({
      child,
      requestId: randomUUID(),
      timeoutMs: workerGracefulShutdownTimeoutMs,
      forceKill: forceKillProcessTree,
    });
  })();

  workerStopPromise = stopping;
  void stopping.then(
    () => {
      if (workerStopPromise === stopping) {
        workerStopPromise = null;
      }
    },
    () => {
      if (workerStopPromise === stopping) {
        workerStopPromise = null;
      }
    },
  );

  return stopping;
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
  if (appIsQuitting) return;
  await loadSplashState("starting");
  if (appIsQuitting) return;

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
    void stopWorkerProcess().catch((error) => {
      console.error("[desktop-main] Worker shutdown after startup timeout failed:", error);
    });
  }, startupTimeoutMs);

  child.on("message", (message: WorkerMessage) => {
    if (workerProcess !== child || sequence !== startupSequence) return;

    if (message?.type === "ready") {
      clearStartupTimers();
      currentAppUrl = message.payload.apiUrl.replace(/\/api\/?$/, "");
      const restoredPath = normalizeDesktopAppPath(preferences().window?.lastPath);
      const initialUrl = restoredPath ? new URL(restoredPath, currentAppUrl).toString() : currentAppUrl;
      void loadMainAppUrl(ensureWindow(), initialUrl).catch((error) => {
        console.warn("[desktop-main] Failed to load desktop app URL:", error);
        void showStartupError(error instanceof Error ? error.message : String(error));
      });
      return;
    }

    if (message?.type === "fatal") {
      clearStartupTimers();
      void showStartupError(message.error);
      void stopWorkerProcess().catch((error) => {
        console.error("[desktop-main] Worker shutdown after fatal startup error failed:", error);
      });
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

async function terminateApplication(signal: NodeJS.Signals): Promise<void> {
  appIsQuitting = true;
  try {
    await stopWorkerProcess();
    app.exit(signal === "SIGINT" ? 130 : 143);
  } catch (error) {
    console.error("[desktop-main] Worker shutdown before process termination failed:", error);
    app.exit(1);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showWindow();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", (event) => {
    if (shutdownPromise) {
      event.preventDefault();
      return;
    }

    if (!appIsQuitting && !systemSessionEnding && !userQuitApproved && currentAppUrl) {
      event.preventDefault();
      void requestUserQuit().catch((error) => {
        console.warn("[desktop-main] Quit confirmation failed:", error);
      });
      return;
    }

    if (!workerProcess && !workerStopPromise) {
      appIsQuitting = true;
      dismissNativeNotifications();
      return;
    }

    event.preventDefault();
    appIsQuitting = true;
    dismissNativeNotifications();
    const win = mainWindow;
    if (win && !win.isDestroyed()) {
      desktopWindowState.save(win);
      showWindow(win);
      void loadSplashState("stopping").catch((error) => {
        console.warn("[desktop-main] Failed to display shutdown progress:", error);
      });
    }
    shutdownPromise = stopWorkerProcess().then(() => {
      shutdownPromise = null;
      app.quit();
    }).catch((error) => {
      shutdownPromise = null;
      console.error("[desktop-main] Worker shutdown before quit failed:", error);
      process.exitCode = 1;
      app.exit(1);
    });
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void startWorkerProcess("activate");
      return;
    }
    showWindow();
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

  ipcMain.handle("desktop-shell:get-preferences", (event) => {
    if (!isTrustedDesktopSender(event)) return null;
    return publicDesktopPreferences(preferences(), {
      trayAvailable: ensureTray(),
      notificationsSupported: hasNotificationSupport(),
    });
  });

  ipcMain.handle("desktop-shell:set-preferences", (event, patch: unknown) => {
    if (!isTrustedDesktopSender(event) || !patch || typeof patch !== "object" || Array.isArray(patch)) return null;
    const candidate = patch as { closeToTray?: unknown; notificationsEnabled?: unknown };
    return updateShellPreferences({
      closeToTray: typeof candidate.closeToTray === "boolean" ? candidate.closeToTray : undefined,
      notificationsEnabled: typeof candidate.notificationsEnabled === "boolean" ? candidate.notificationsEnabled : undefined,
    });
  });

  ipcMain.handle("desktop-shell:set-context", (event, context: unknown) => {
    if (!isTrustedDesktopSender(event)) return false;
    const candidate = parseDesktopContext(context);
    if (!candidate) return false;
    const priorCompanyId = desktopExperience.getContext().companyId;
    const priorLocale = desktopExperience.getContext().locale;
    desktopExperience.setContext(candidate);
    const contextChanged = priorCompanyId !== candidate.companyId || priorLocale !== candidate.locale;
    if (priorCompanyId !== candidate.companyId) dismissNativeNotifications();
    try {
      if (contextChanged) {
        writeDesktopPreferences(desktopPreferencesPath, { locale: candidate.locale });
        rebuildTrayMenu();
      }
    } catch (error) {
      console.warn("[desktop-main] Failed to persist desktop locale:", error);
    }
    return true;
  });

  ipcMain.handle("desktop-shell:notify", (event, request: unknown) => {
    if (!isTrustedDesktopSender(event)) return false;
    const normalized = parseDesktopNotification(request);
    if (!normalized) return false;
    const win = mainWindow;
    if (!desktopExperience.shouldDeliverNotification(normalized, {
      hiddenOrUnfocused: !win || !win.isVisible() || !win.isFocused(),
      notificationsEnabled: preferences().notificationsEnabled !== false,
      supported: hasNotificationSupport(),
    })) return false;
    try {
      const epoch = notificationEpoch;
      const notification = new Notification(desktopNotificationCopy(normalized.kind, desktopLocale()));
      if (activeNotifications.size >= 20) {
        const oldest = activeNotifications.values().next().value;
        if (oldest) { activeNotifications.delete(oldest); oldest.close(); }
      }
      activeNotifications.add(notification);
      notification.on("close", () => activeNotifications.delete(notification));
      notification.on("failed", () => activeNotifications.delete(notification));
      notification.on("click", () => {
        activeNotifications.delete(notification);
        if (epoch !== notificationEpoch || appIsQuitting || systemSessionEnding
          || desktopExperience.getContext().companyId !== normalized.companyId
          || preferences().notificationsEnabled === false) return;
        showWindow();
        sendDesktopNavigation(normalized.targetPath);
      });
      notification.show();
      desktopExperience.rememberNotification(normalized.id);
      return true;
    } catch (error) {
      console.warn("[desktop-main] Failed to show native notification:", error);
      return false;
    }
  });

  ipcMain.handle("desktop-shell:quit", async (event) => {
    if (!isTrustedDesktopSender(event)) return false;
    return requestUserQuit();
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

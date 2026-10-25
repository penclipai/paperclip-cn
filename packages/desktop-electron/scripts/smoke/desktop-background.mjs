#!/usr/bin/env node

/**
 * Real Electron acceptance for the background desktop experience.
 *
 * This deliberately drives the shipped main/preload bridge instead of adding
 * test-only IPC. It uses an isolated profile and never uses the developer's
 * Paperclip profile or a fixed development port. On Windows, set
 * PAPERCLIP_DESKTOP_SMOKE_REQUIRED_DRIVE (or --required-drive) when a run
 * must stay on a specific drive.
 *
 * Usage:
 *   node packages/desktop-electron/scripts/smoke/desktop-background.mjs
 *   node packages/desktop-electron/scripts/smoke/desktop-background.mjs --skip-build --artifact-dir D:/pc-sync-qa/desktop-background
 *   node packages/desktop-electron/scripts/smoke/desktop-background.mjs --required-drive D:
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { killProcessTree, runPnpm } from "../utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, "..", "..");
const repoRoot = path.resolve(packageDir, "..", "..");
const require = createRequire(import.meta.url);
const maxDurationMs = 300_000;
const timeoutAbortController = new AbortController();
const ownedElectronPids = new Set();
let watchdogTriggered = false;
const reservedPorts = new Set([3100, 3198, 54329]);

function parseArgs(argv) {
  const args = {
    artifactDir: path.resolve(packageDir, ".artifacts", "desktop-background"),
    skipBuild: false,
    keepUserData: false,
    requiredDrive: process.env.PAPERCLIP_DESKTOP_SMOKE_REQUIRED_DRIVE?.trim() || null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--skip-build") args.skipBuild = true;
    else if (argument === "--keep-user-data") args.keepUserData = true;
    else if (argument === "--artifact-dir") {
      args.artifactDir = path.resolve(argv[index + 1] ?? args.artifactDir);
      index += 1;
    } else if (argument.startsWith("--artifact-dir=")) {
      args.artifactDir = path.resolve(argument.slice("--artifact-dir=".length));
    } else if (argument === "--required-drive") {
      args.requiredDrive = argv[index + 1] ?? null;
      index += 1;
    } else if (argument.startsWith("--required-drive=")) {
      args.requiredDrive = argument.slice("--required-drive=".length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return args;
}

function requireDrive(candidate, label, requiredDrive) {
  if (process.platform !== "win32" || !requiredDrive) return;
  const drive = requiredDrive.replace(/[\\/]+$/, "").toLowerCase();
  if (!/^[a-z]:$/.test(drive)) {
    throw new Error(`--required-drive must be a Windows drive such as D:, received ${requiredDrive}.`);
  }
  const resolved = path.resolve(candidate);
  if (!resolved.toLowerCase().startsWith(`${drive}\\`) && resolved.toLowerCase() !== drive) {
    throw new Error(`${label} must be on ${requiredDrive} for this desktop acceptance run, received ${resolved}.`);
  }
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function within(timeoutMs, label, operation) {
  let timeout = null;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function throwIfTimedOut() {
  if (timeoutAbortController.signal.aborted) {
    throw new Error("Desktop background acceptance exceeded its time budget.");
  }
}

function fetchSignal(timeoutMs) {
  return AbortSignal.any([timeoutAbortController.signal, AbortSignal.timeout(timeoutMs)]);
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .split(/\n={10,}[\s\S]*$/)[0]
    .replace(/data:[^\s]*/gi, "data:<redacted>")
    .slice(0, 2_000);
}

function isExpectedRendererTeardown(error) {
  const message = safeErrorMessage(error);
  return /execution context was destroyed|target page, context or browser has been closed/i.test(message);
}

function killOwnedElectronTree(pid) {
  if (!pid || !ownedElectronPids.has(pid)) return;
  killProcessTree(pid, { cwd: packageDir });
}

async function findFreePort(excludedPorts = reservedPorts) {
  const server = net.createServer();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (address && typeof address !== "string" && Number.isInteger(address.port) && !excludedPorts.has(address.port)) {
      return address.port;
    }
  }
  throw new Error("Could not reserve an isolated desktop port outside the excluded set.");
}

function resolveViteHmrPort(serverPort) {
  return serverPort <= 55_535 ? serverPort + 10_000 : serverPort - 10_000;
}

async function canBindPort(port) {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    return true;
  } catch {
    return false;
  } finally {
    if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function findFreeHttpPortPair() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    // Vite's dev middleware starts a second listener at serverPort + 10,000.
    // Keep both explicit probes below the Windows high dynamic range where the
    // HMR companion may be denied after a successful preflight.
    const port = 35_000 + Math.floor(Math.random() * 10_000);
    const hmrPort = resolveViteHmrPort(port);
    if (reservedPorts.has(port) || reservedPorts.has(hmrPort)) continue;
    if (!(await canBindPort(port)) || !(await canBindPort(hmrPort))) continue;
    return { port, hmrPort };
  }
  throw new Error("Could not reserve isolated HTTP and Vite HMR ports.");
}

async function canConnect(port) {
  return await new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (connected) => { socket.destroy(); resolve(connected); };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
    socket.setTimeout(750);
    socket.connect(port, "127.0.0.1");
  });
}

async function waitForPort(port, shouldBeOpen, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    throwIfTimedOut();
    if ((await canConnect(port)) === shouldBeOpen) return;
    await pause(300);
  }
  throw new Error(`Timed out waiting for ${label} to become ${shouldBeOpen ? "available" : "closed"}.`);
}

async function waitForHealth(origin, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    throwIfTimedOut();
    try {
      const response = await fetch(new URL("/api/health", origin), { signal: fetchSignal(5_000) });
      if (response.ok) return await response.json();
    } catch {
      // Startup and graceful shutdown both legitimately race the HTTP socket.
    }
    await pause(500);
  }
  throw new Error(`Timed out waiting for the isolated desktop service at ${origin}.`);
}

async function waitForProcessExit(child, label, timeoutMs = 30_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let onExit;
  try {
    await within(timeoutMs, `${label} exit`, () => new Promise((resolve) => {
      onExit = resolve;
      child.once("exit", onExit);
    }));
  } finally {
    if (onExit) child.removeListener("exit", onExit);
  }
}

function assertGracefulProcessExit(child, label) {
  const exit = { exitCode: child.exitCode, signalCode: child.signalCode };
  if (exit.exitCode !== 0 || exit.signalCode !== null) {
    throw new Error(`${label} did not exit gracefully (code ${exit.exitCode}, signal ${exit.signalCode ?? "none"}).`);
  }
  return exit;
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function waitForPidExit(pid, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    throwIfTimedOut();
    if (!isProcessRunning(pid)) return;
    await pause(300);
  }
  throw new Error(`Timed out waiting for ${label} process ${pid} to exit.`);
}

function readOwnedEmbeddedPostgres(userDataDir, expectedPort) {
  const pidPath = path.join(userDataDir, "runtime", "instances", "default", "db", "postmaster.pid");
  if (!fs.existsSync(pidPath)) {
    throw new Error(`Isolated embedded PostgreSQL did not create ${pidPath}.`);
  }
  const lines = fs.readFileSync(pidPath, "utf8").split(/\r?\n/);
  const pid = Number(lines[0]?.trim());
  const port = Number(lines[3]?.trim());
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(port) || port <= 0) {
    throw new Error("Isolated embedded PostgreSQL postmaster.pid did not contain a PID and port.");
  }
  if (port !== expectedPort) {
    throw new Error(`Isolated embedded PostgreSQL used port ${port}, expected its reserved port ${expectedPort}.`);
  }
  return { pid, port };
}

async function writeIsolatedConfig(userDataDir, embeddedPostgresPort) {
  const runtimeDir = path.join(userDataDir, "runtime");
  await fs.promises.mkdir(runtimeDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(runtimeDir, "config.json"),
    `${JSON.stringify({
      $meta: { version: 1, updatedAt: new Date().toISOString(), source: "configure" },
      database: {
        embeddedPostgresDataDir: path.join(runtimeDir, "instances", "default", "db"),
        embeddedPostgresPort,
      },
      logging: { mode: "file" },
      server: {},
      telemetry: { enabled: false },
    }, null, 2)}\n`,
    "utf8",
  );
}

function prepareBuild() {
  // This follows the existing dev smoke harness: the server starts Vite's UI
  // middleware from source, so an independent UI production build is neither
  // required nor used by this development-mode acceptance path.
  runPnpm(["--dir", repoRoot, "--filter", "@penclipai/server...", "build"], { cwd: repoRoot });
  runPnpm(["--dir", packageDir, "build"], { cwd: packageDir });
}

function isolatedLaunchEnvironment(userDataDir, port) {
  const environment = { ...process.env };
  const deniedKeys = new Set([
    "PAPERCLIP_CONFIG",
    "PAPERCLIP_CONTEXT",
    "PAPERCLIP_HOME",
    "PAPERCLIP_INSTANCE_ID",
    "PAPERCLIP_IN_WORKTREE",
    "PAPERCLIP_WORKTREE_NAME",
    "PAPERCLIP_WORKTREE_COLOR",
    "PAPERCLIP_WORKTREES_DIR",
    "BETTER_AUTH_SECRET",
    "PAPERCLIP_AGENT_JWT_SECRET",
    "ELECTRON_RUN_AS_NODE",
  ]);
  for (const key of Object.keys(environment)) {
    if (deniedKeys.has(key.toUpperCase())) delete environment[key];
  }
  const paperclipHome = path.join(userDataDir, "runtime");
  return {
    ...environment,
    PAPERCLIP_DESKTOP_DEV: "true",
    PAPERCLIP_DESKTOP_SMOKE_START_DELAY_MS: "0",
    PAPERCLIP_DESKTOP_USER_DATA_DIR: userDataDir,
    PAPERCLIP_HOME: paperclipHome,
    PAPERCLIP_CONFIG: path.join(paperclipHome, "config.json"),
    PAPERCLIP_CONTEXT: path.join(paperclipHome, "context.json"),
    PORT: String(port),
    HOST: "127.0.0.1",
  };
}

function launchOptions(userDataDir, port) {
  return {
    executablePath: require("electron"),
    // Electron resolves app.getPath("userData") before the desktop main module
    // can apply PAPERCLIP_DESKTOP_USER_DATA_DIR. The native switch makes that
    // early Chromium path use this same isolated profile as well.
    args: [`--user-data-dir=${userDataDir}`, path.join(packageDir, "dist", "main.js")],
    cwd: packageDir,
    env: isolatedLaunchEnvironment(userDataDir, port),
  };
}

/**
 * Playwright's Electron launcher creates its process before its debugger
 * handshake resolves. On Windows it does so through a shell command, so a
 * launch timeout otherwise has no PID available to clean up. Patch only the
 * CommonJS child-process object used by Playwright for this one launch call,
 * and only register the exact requested Electron executable.
 */
async function launchOwnedElectron(options) {
  const childProcess = require("node:child_process");
  const originalSpawn = childProcess.spawn;
  const executable = path.resolve(options.executablePath).toLowerCase();
  childProcess.spawn = function captureElectronSpawn(command, args, spawnOptions) {
    const spawned = originalSpawn.call(this, command, args, spawnOptions);
    const commandText = [command, ...(Array.isArray(args) ? args : [])].join(" ").toLowerCase();
    if (commandText.includes(executable) && spawned.pid) {
      ownedElectronPids.add(spawned.pid);
    }
    return spawned;
  };
  try {
    return await electron.launch(options);
  } finally {
    childProcess.spawn = originalSpawn;
  }
}

async function createCompany(origin) {
  const response = await fetch(new URL("/api/companies", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `Desktop background smoke ${Date.now()}` }),
    signal: fetchSignal(15_000),
  });
  if (!response.ok) throw new Error(`Failed to create isolated smoke company (${response.status}).`);
  const company = await response.json();
  if (!company || typeof company.issuePrefix !== "string") {
    throw new Error("The isolated smoke company did not include an issue prefix.");
  }
  return company;
}

async function installTrayCapture(electronApp) {
  await electronApp.evaluate(({ Menu }) => {
    const state = globalThis.__paperclipDesktopBackgroundTray ??= {};
    if (!state.originalBuild) {
      state.originalBuild = Menu.buildFromTemplate;
      Menu.buildFromTemplate = (template, ...args) => {
        // The custom titlebar also builds menus. Preserve only the native tray
        // shape while the original callbacks are still plain constructor
        // options, before Electron turns them into MenuItems.
        const isTrayTemplate = Array.isArray(template)
          && template.length === 7
          && template[0]?.type !== "checkbox"
          && template[3]?.type === "checkbox"
          && template[4]?.type === "checkbox"
          && typeof template[0]?.click === "function"
          && typeof template[6]?.click === "function";
        if (isTrayTemplate) {
          state.trayTemplates ??= [];
          state.trayTemplates.push(template.map((item) => ({ ...item })));
        }
        return state.originalBuild.call(Menu, template, ...args);
      };
    }
  });
}

async function restoreTrayCapture(electronApp) {
  if (!electronApp) return;
  await electronApp.evaluate(({ Menu }) => {
    const state = globalThis.__paperclipDesktopBackgroundTray;
    if (state?.originalBuild) Menu.buildFromTemplate = state.originalBuild;
    delete globalThis.__paperclipDesktopBackgroundTray;
  }).catch(() => undefined);
}

async function trayTemplateSummary(electronApp) {
  return await electronApp.evaluate(() => {
    const templates = globalThis.__paperclipDesktopBackgroundTray?.trayTemplates ?? [];
    const template = templates.at(-1) ?? [];
    return template.map((item) => ({ label: typeof item.label === "string" ? item.label : null, type: item.type ?? "normal" }));
  });
}

async function invokeTrayAction(electronApp, index) {
  return await electronApp.evaluate((_electron, itemIndex) => {
    const template = globalThis.__paperclipDesktopBackgroundTray?.trayTemplates?.at(-1);
    const item = template?.[itemIndex];
    if (!item || typeof item.click !== "function") return false;
    item.click({ checked: item.checked });
    return true;
  }, index);
}

async function setDialogResponse(electronApp, response) {
  await electronApp.evaluate(({ dialog }, selectedResponse) => {
    const state = globalThis.__paperclipDesktopBackgroundDialog ??= {};
    if (!state.original) state.original = dialog.showMessageBox;
    dialog.showMessageBox = async () => ({ response: selectedResponse, checkboxChecked: false });
  }, response);
}

async function restoreDialog(electronApp) {
  if (!electronApp) return;
  await electronApp.evaluate(({ dialog }) => {
    const state = globalThis.__paperclipDesktopBackgroundDialog;
    if (state?.original) dialog.showMessageBox = state.original;
    delete globalThis.__paperclipDesktopBackgroundDialog;
  }).catch(() => undefined);
}

async function mainWindowState(electronApp) {
  return await electronApp.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    const window = windows.at(0);
    return {
      count: windows.length,
      id: window?.id ?? null,
      visible: window?.isVisible() ?? false,
      focused: window?.isFocused() ?? false,
      url: window?.webContents.getURL() ?? null,
    };
  });
}

async function setAndReadWindowGeometry(electronApp) {
  return await electronApp.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().at(0);
    if (!window) return null;
    const workArea = screen.getPrimaryDisplay().workArea;
    const [minimumWidth, minimumHeight] = window.getMinimumSize();
    if (workArea.width < minimumWidth || workArea.height < minimumHeight) {
      throw new Error("The primary display work area cannot fit the desktop window minimum size.");
    }
    const width = Math.max(minimumWidth, Math.min(960, workArea.width - 40));
    const height = Math.max(minimumHeight, Math.min(680, workArea.height - 40));
    window.setBounds({
      x: workArea.x + Math.max(0, Math.min(37, workArea.width - width)),
      y: workArea.y + Math.max(0, Math.min(23, workArea.height - height)),
      width,
      height,
    });
    const normalBounds = window.getNormalBounds();
    const display = screen.getDisplayMatching(normalBounds);
    return {
      bounds: normalBounds,
      maximized: window.isMaximized(),
      metrics: {
        bounds: window.getBounds(),
        normalBounds,
        contentBounds: window.getContentBounds(),
        size: window.getSize(),
        contentSize: window.getContentSize(),
        minimumSize: window.getMinimumSize(),
        display: { scaleFactor: display.scaleFactor, workArea: display.workArea },
      },
    };
  });
}

async function readWindowGeometry(electronApp) {
  return await electronApp.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().at(0);
    if (!window) return null;
    const normalBounds = window.getNormalBounds();
    const display = screen.getDisplayMatching(normalBounds);
    return {
      bounds: normalBounds,
      maximized: window.isMaximized(),
      metrics: {
        bounds: window.getBounds(),
        normalBounds,
        contentBounds: window.getContentBounds(),
        size: window.getSize(),
        contentSize: window.getContentSize(),
        minimumSize: window.getMinimumSize(),
        display: { scaleFactor: display.scaleFactor, workArea: display.workArea },
      },
    };
  });
}

async function readPersistedWindowGeometry(userDataDir) {
  const preferencesPath = path.join(userDataDir, "desktop-preferences.json");
  const preferences = JSON.parse(await fs.promises.readFile(preferencesPath, "utf8"));
  return preferences.window ?? null;
}

function assertWindowGeometryRestored(expected, actual) {
  if (!expected || !actual || expected.maximized !== actual.maximized) {
    throw new Error("Desktop window maximize state did not survive the real restart.");
  }
  for (const key of ["x", "y", "width", "height"]) {
    if (Math.abs(expected.bounds[key] - actual.bounds[key]) > 2) {
      throw new Error(
        `Desktop window ${key} did not survive the real restart (expected ${expected.bounds[key]}, received ${actual.bounds[key]}).`,
      );
    }
  }
}

async function waitForWindow(electronApp, predicate, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await mainWindowState(electronApp);
    if (predicate(latest)) return latest;
    await pause(200);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function writeEvidence(artifactDir, evidence) {
  await fs.promises.mkdir(artifactDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(artifactDir, "desktop-background-result.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
}

async function closeOwnedElectronApp(electronApp, pid) {
  if (!electronApp) return;
  try {
    // A failed probe must not restore the real dialog before closing: doing so
    // could display a human-facing quit confirmation and hang cleanup.
    await setDialogResponse(electronApp, 1);
    await within(8_000, "owned Electron process cleanup", () => electronApp.close());
  } catch {
    killOwnedElectronTree(pid);
  }
}

async function run(args) {
  requireDrive(os.tmpdir(), "os.tmpdir()", args.requiredDrive);
  requireDrive(args.artifactDir, "artifact directory", args.requiredDrive);
  if (!args.skipBuild) prepareBuild();

  const userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "paperclip-desktop-background-"));
  requireDrive(userDataDir, "isolated desktop profile", args.requiredDrive);
  const { port, hmrPort } = await findFreeHttpPortPair();
  const embeddedPostgresPort = await findFreePort(new Set([...reservedPorts, port, hmrPort]));
  await writeIsolatedConfig(userDataDir, embeddedPostgresPort);
  const origin = `http://127.0.0.1:${port}`;
  const evidence = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    port,
    hmrPort,
    embeddedPostgresPort,
    assertions: {},
    postgres: {},
    compiled: {
      mainSha256: sha256File(path.join(packageDir, "dist", "main.js")),
      preloadSha256: sha256File(path.join(packageDir, "dist", "preload.js")),
    },
  };
  let firstApp = null;
  let firstPid = null;
  let secondApp = null;
  let secondPid = null;
  let secondInstancePid = null;
  let firstPostgres = null;
  let secondPostgres = null;
  let succeeded = false;
  let runError = null;

  try {
    evidence.phase = "launching-first-electron";
    firstApp = await within(30_000, "the first Electron main process", () => launchOwnedElectron(launchOptions(userDataDir, port)));
    firstPid = firstApp.process()?.pid ?? null;
    if (firstPid) ownedElectronPids.add(firstPid);
    evidence.phase = "waiting-for-first-window";
    await waitForWindow(firstApp, (state) => state.count > 0, "the first Electron window", 30_000);
    const firstPage = await within(15_000, "the first Electron renderer page", () => firstApp.firstWindow());
    await firstPage.waitForURL(new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`), { timeout: 90_000 });
    await waitForHealth(origin);
    firstPostgres = readOwnedEmbeddedPostgres(userDataDir, embeddedPostgresPort);
    await waitForPort(firstPostgres.port, true, "first isolated embedded PostgreSQL");
    await firstPage.waitForFunction(() => Boolean(window.desktopShell?.getPreferences), undefined, { timeout: 30_000 });

    await installTrayCapture(firstApp);
    const company = await createCompany(origin);
    const routePath = `/${company.issuePrefix}/dashboard`;
    await firstPage.goto(`${origin}${routePath}`);
    await firstPage.waitForLoadState("domcontentloaded");
    await firstPage.waitForFunction(() => Boolean(document.querySelector("#root")?.childElementCount), undefined, { timeout: 30_000 });
    const bridgePreferences = await firstPage.evaluate(() => window.desktopShell?.setPreferences({ closeToTray: true, notificationsEnabled: false }));
    if (!bridgePreferences || bridgePreferences.closeToTray !== true || bridgePreferences.notificationsEnabled !== false) {
      throw new Error("The production desktop preferences bridge did not persist the requested settings.");
    }
    const persistedPreferences = JSON.parse(await fs.promises.readFile(path.join(userDataDir, "desktop-preferences.json"), "utf8"));
    if (persistedPreferences.closeToTray !== true || persistedPreferences.notificationsEnabled !== false) {
      throw new Error("The desktop preference file did not contain the bridge settings.");
    }
    evidence.assertions.preferencesBridge = true;

    const trayMenu = await trayTemplateSummary(firstApp);
    if (trayMenu.length < 6 || !trayMenu.some((entry) => entry.type === "checkbox")) {
      throw new Error("The production tray menu was not built with its expected controls.");
    }
    evidence.trayMenu = trayMenu;

    await setDialogResponse(firstApp, 0);
    const beforeHide = await mainWindowState(firstApp);
    await firstApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().at(0)?.close());
    await waitForWindow(firstApp, (state) => state.id === beforeHide.id && !state.visible, "window hidden to tray");
    await waitForHealth(origin);
    evidence.assertions.closeKeepsServiceRunning = true;

    if (!(await invokeTrayAction(firstApp, 0))) throw new Error("Could not invoke the production tray Open callback.");
    await waitForWindow(firstApp, (state) => state.id === beforeHide.id && state.visible, "tray Open restoring the existing window");
    evidence.assertions.trayOpenRestoresSameWindow = true;

    await firstApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().at(0)?.hide());
    const electronPath = require("electron");
    const secondInstance = spawn(electronPath, [
      `--user-data-dir=${userDataDir}`,
      path.join(packageDir, "dist", "main.js"),
    ], {
      cwd: packageDir,
      env: isolatedLaunchEnvironment(userDataDir, port),
      windowsHide: true,
      stdio: "ignore",
    });
    secondInstancePid = secondInstance.pid ?? null;
    if (secondInstancePid) ownedElectronPids.add(secondInstancePid);
    await waitForWindow(firstApp, (state) => state.id === beforeHide.id && state.visible, "second instance restoring the original window");
    await waitForProcessExit(secondInstance, "second Electron instance", 20_000);
    if (secondInstancePid) ownedElectronPids.delete(secondInstancePid);
    evidence.assertions.secondInstanceRestoresSameWindow = true;

    const expectedWindowGeometry = await setAndReadWindowGeometry(firstApp);
    if (!expectedWindowGeometry) {
      throw new Error("Could not set isolated desktop window geometry before restart.");
    }
    evidence.windowGeometry = { expected: expectedWindowGeometry };

    // Confirmed quit provides an actual process restart. The restored URL proves
    // that route persistence survived an on-disk profile rather than a renderer-only reload.
    await setDialogResponse(firstApp, 1);
    if (!(await invokeTrayAction(firstApp, trayMenu.length - 1))) {
      throw new Error("Could not invoke the production tray Quit callback.");
    }
    const firstProcess = firstApp.process();
    if (!firstProcess) throw new Error("Could not inspect the first Electron process before graceful quit.");
    await waitForProcessExit(firstProcess, "first Electron process", 120_000);
    evidence.processes ??= {};
    evidence.processes.first = assertGracefulProcessExit(firstProcess, "First Electron process");
    await waitForPort(port, false, "first desktop service", 120_000);
    await waitForPort(firstPostgres.port, false, "first isolated embedded PostgreSQL", 120_000);
    await waitForPidExit(firstPostgres.pid, "first isolated embedded PostgreSQL", 120_000);
    evidence.postgres.first = { ...firstPostgres, closed: true };
    evidence.windowGeometry.persistedBeforeRestart = await readPersistedWindowGeometry(userDataDir);
    await firstApp.close().catch(() => undefined);
    if (firstPid) ownedElectronPids.delete(firstPid);
    firstApp = null;

    evidence.phase = "launching-second-electron";
    secondApp = await within(30_000, "the restarted Electron main process", () => launchOwnedElectron(launchOptions(userDataDir, port)));
    secondPid = secondApp.process()?.pid ?? null;
    if (secondPid) ownedElectronPids.add(secondPid);
    evidence.phase = "waiting-for-restarted-window";
    await waitForWindow(secondApp, (state) => state.count > 0, "the restarted Electron window", 30_000);
    const secondPage = await within(15_000, "the restarted Electron renderer page", () => secondApp.firstWindow());
    await secondPage.waitForURL(new RegExp(`${company.issuePrefix}/dashboard/?$`), { timeout: 90_000 });
    await waitForHealth(origin);
    secondPostgres = readOwnedEmbeddedPostgres(userDataDir, embeddedPostgresPort);
    await waitForPort(secondPostgres.port, true, "second isolated embedded PostgreSQL");
    const restored = await secondPage.evaluate(() => window.desktopShell?.getPreferences());
    if (!restored || restored.closeToTray !== true || restored.notificationsEnabled !== false) {
      throw new Error("Desktop settings did not survive the real Electron restart.");
    }
    const restoredWindowGeometry = await readWindowGeometry(secondApp);
    evidence.windowGeometry.restored = restoredWindowGeometry;
    assertWindowGeometryRestored(expectedWindowGeometry, restoredWindowGeometry);
    evidence.assertions.restartRestoresWindowRouteAndPreferences = true;
    evidence.assertions.restartRestoresWindowGeometry = true;

    await setDialogResponse(secondApp, 0);
    const cancelledQuit = await secondPage.evaluate(() => window.desktopShell?.quit());
    if (cancelledQuit !== false) throw new Error("Cancelling desktop quit did not return false.");
    await waitForHealth(origin);
    evidence.assertions.quitCancelKeepsServiceRunning = true;

    await setDialogResponse(secondApp, 1);
    let confirmedQuit = false;
    try {
      confirmedQuit = await secondPage.evaluate(() => window.desktopShell?.quit());
    } catch (error) {
      if (!isExpectedRendererTeardown(error)) throw error;
      evidence.assertions.quitConfirmationRendererToreDown = true;
    }
    if (confirmedQuit !== true && !evidence.assertions.quitConfirmationRendererToreDown) {
      throw new Error("Confirming desktop quit did not return true.");
    }
    const secondProcess = secondApp.process();
    if (!secondProcess) throw new Error("Could not inspect the second Electron process before graceful quit.");
    await waitForProcessExit(secondProcess, "second Electron process", 120_000);
    evidence.processes ??= {};
    evidence.processes.second = assertGracefulProcessExit(secondProcess, "Second Electron process");
    await waitForPort(port, false, "second desktop service", 120_000);
    await waitForPort(secondPostgres.port, false, "second isolated embedded PostgreSQL", 120_000);
    await waitForPidExit(secondPostgres.pid, "second isolated embedded PostgreSQL", 120_000);
    evidence.postgres.second = { ...secondPostgres, closed: true };
    if (secondPid) ownedElectronPids.delete(secondPid);
    evidence.assertions.quitConfirmationGracefullyStopsService = true;
    evidence.assertions.embeddedPostgresGracefullyStops = true;
    evidence.phase = "complete";
    succeeded = true;
  } catch (error) {
    runError = error;
    evidence.error = safeErrorMessage(error);
    throw error;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    evidence.succeeded = succeeded;
    let evidenceWriteError = null;
    try {
      await writeEvidence(args.artifactDir, evidence);
    } catch (error) {
      evidenceWriteError = error;
      console.error(`[desktop-background] Could not write evidence: ${safeErrorMessage(error)}`);
    } finally {
      await closeOwnedElectronApp(firstApp, firstPid);
      await closeOwnedElectronApp(secondApp, secondPid);
      killOwnedElectronTree(firstPid);
      killOwnedElectronTree(secondPid);
      killOwnedElectronTree(secondInstancePid);
      for (const pid of ownedElectronPids) killOwnedElectronTree(pid);
      if (succeeded && !evidenceWriteError && !args.keepUserData) {
        await fs.promises.rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
          .catch((error) => console.error(`[desktop-background] Could not remove isolated profile: ${safeErrorMessage(error)}`));
      } else if (!succeeded || evidenceWriteError) {
        console.error(`[desktop-background] Preserved isolated profile after failure: ${userDataDir}`);
      }
    }
    if (evidenceWriteError && !runError) {
      throw new Error(`Desktop background acceptance could not write evidence: ${safeErrorMessage(evidenceWriteError)}`);
    }
  }
}

const args = parseArgs(process.argv.slice(2));
const watchdog = setTimeout(() => {
  watchdogTriggered = true;
  console.error(`[desktop-background] Timed out after ${maxDurationMs / 1000}s.`);
  timeoutAbortController.abort();
  for (const pid of ownedElectronPids) killOwnedElectronTree(pid);
  // Electron launch is not abortable. Give the normal finally block a brief
  // opportunity to preserve evidence, then guarantee no owned worker or
  // embedded PostgreSQL tree is left alive.
  setTimeout(() => process.exit(1), 8_000).unref();
}, maxDurationMs);

void (async () => {
  let exitCode = 0;
  try {
    await run(args);
    console.log(`[desktop-background] Passed. Evidence: ${path.join(args.artifactDir, "desktop-background-result.json")}`);
  } catch (error) {
    console.error("[desktop-background] Failed:", safeErrorMessage(error));
    // A failed probe can retain child or transport handles after cleanup.
    // Evidence and owned-process cleanup have already run above, so this CLI
    // process must end instead of holding its isolated wrapper forever.
    exitCode = 1;
  } finally {
    clearTimeout(watchdog);
  }
  // Electron/Playwright can retain a transport handle after every owned app
  // and child tree has closed. `run()` has already written evidence and run
  // its cleanup, so ending here gives the isolated wrapper a definitive exit.
  process.exit(exitCode);
})();

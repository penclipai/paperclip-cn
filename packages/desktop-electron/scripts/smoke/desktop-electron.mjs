#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { _electron as electron } from "playwright";
import { killProcessTree, runPnpm } from "../utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, "..", "..");
const repoRoot = path.resolve(packageDir, "..", "..");
const require = createRequire(import.meta.url);
const DESKTOP_PREFERENCES_FILENAME = "desktop-preferences.json";
const DESKTOP_THEMES = ["dark", "light"];
const DEV_PLUGIN_BUILD_FILTERS = [
  "@penclipai/plugin-hello-world-example",
  "@penclipai/plugin-file-browser-example",
  "@penclipai/plugin-kitchen-sink-example",
];

function parseArgs(argv) {
  const args = { mode: "dev" };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") {
      args.mode = argv[index + 1] ?? args.mode;
      index += 1;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      args.mode = arg.slice("--mode=".length);
    }
  }

  return args;
}

function resolveExpectedLocale() {
  const raw =
    process.env.PAPERCLIP_DESKTOP_SMOKE_EXPECT_LOCALE ??
    Intl.DateTimeFormat().resolvedOptions().locale ??
    "en";
  return raw.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function getSplashExpectation(locale, theme) {
  if (locale === "zh-CN") {
    return {
      statuses: [
        "\u6b63\u5728\u6253\u5f00 Paperclip",
        "\u9a6c\u4e0a\u5c31\u597d\uff0c\u6b63\u5728\u8fde\u63a5\u4f60\u7684\u672c\u5730\u5de5\u4f5c\u53f0",
      ],
      footer: "\u00a9 2026 Paperclip CN",
      theme,
      tokens: theme === "dark"
        ? { backgroundStart: "#1c1c1e", text: "#f5f5f7" }
        : { backgroundStart: "#f5f2ea", text: "#1c1c1f" },
    };
  }

  return {
    statuses: [
      "Opening Paperclip",
      "Almost there. Connecting your local workspace.",
    ],
    footer: "\u00a9 2026 Paperclip CN",
    theme,
    tokens: theme === "dark"
      ? { backgroundStart: "#1c1c1e", text: "#f5f5f7" }
      : { backgroundStart: "#f5f2ea", text: "#1c1c1f" },
  };
}

async function createSmokeUserDataDir(mode, theme) {
  const userDataDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), `paperclip-desktop-smoke-${mode}-${theme}-`),
  );

  await fs.promises.writeFile(
    path.resolve(userDataDir, DESKTOP_PREFERENCES_FILENAME),
    `${JSON.stringify({ theme }, null, 2)}\n`,
    "utf8",
  );

  return userDataDir;
}

function buildLaunchEnv(userDataDir) {
  const baseEnv = { ...process.env };
  for (const key of [
    "PAPERCLIP_CONFIG",
    "PAPERCLIP_CONTEXT",
    "PAPERCLIP_IN_WORKTREE",
    "PAPERCLIP_WORKTREE_NAME",
    "PAPERCLIP_WORKTREE_COLOR",
    "PAPERCLIP_WORKTREES_DIR",
  ]) {
    delete baseEnv[key];
  }

  const paperclipHome = path.resolve(userDataDir, "runtime");
  return {
    ...baseEnv,
    PAPERCLIP_DESKTOP_SMOKE_START_DELAY_MS: process.env.PAPERCLIP_DESKTOP_SMOKE_START_DELAY_MS ?? "1800",
    PAPERCLIP_DESKTOP_USER_DATA_DIR: userDataDir,
    PAPERCLIP_HOME: paperclipHome,
    PAPERCLIP_CONFIG: path.resolve(paperclipHome, "config.json"),
    PAPERCLIP_CONTEXT: path.resolve(paperclipHome, "context.json"),
  };
}

async function cleanupUserDataDir(userDataDir) {
  await fs.promises.rm(userDataDir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 500,
  });
}

function resolveDevLaunchOptions(userDataDir) {
  const electronBin =
    process.platform === "win32"
      ? require("electron")
      : path.resolve(packageDir, "node_modules", ".bin", "electron");

  return {
    executablePath: electronBin,
    args: [path.resolve(packageDir, "dist", "main.js")],
    cwd: packageDir,
    env: {
      ...buildLaunchEnv(userDataDir),
      PAPERCLIP_DESKTOP_DEV: "true",
    },
  };
}

function prepareDevLaunch() {
  runPnpm(["--dir", repoRoot, "--filter", "@penclipai/server...", "build"], { cwd: repoRoot });
  for (const filter of DEV_PLUGIN_BUILD_FILTERS) {
    runPnpm(["--dir", repoRoot, "--filter", filter, "build"], { cwd: repoRoot });
  }
  runPnpm(["--dir", packageDir, "build"], { cwd: packageDir });
}

function resolvePackagedExecutable() {
  const winUnpackedDir = path.resolve(packageDir, "release", "win-unpacked");
  const candidates = [
    path.resolve(winUnpackedDir, "Paperclip CN.exe"),
    path.resolve(winUnpackedDir, "Paperclip-CN.exe"),
    path.resolve(winUnpackedDir, "electron.exe"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const discoveredExe = fs
    .readdirSync(winUnpackedDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".exe"))
    .map((entry) => path.resolve(winUnpackedDir, entry.name))
    .at(0);

  if (discoveredExe) {
    return discoveredExe;
  }

  throw new Error(
    `Packaged desktop executable not found in ${winUnpackedDir}. Run "pnpm desktop:dist:win" first.`,
  );
}

function resolvePackagedLaunchOptions(userDataDir) {
  const executablePath = resolvePackagedExecutable();

  return {
    executablePath,
    args: [],
    cwd: path.dirname(executablePath),
    env: buildLaunchEnv(userDataDir),
  };
}

async function waitForHealth(origin, timeoutMs = 90_000) {
  const start = Date.now();
  const healthUrl = new URL("/api/health", origin).toString();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  throw new Error(`Timed out waiting for desktop health endpoint at ${healthUrl}`);
}

async function canConnect(host, port) {
  return await new Promise((resolve) => {
    const socket = new net.Socket();

    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };

    socket.once("connect", () => {
      finish(true);
    });
    socket.once("error", () => {
      finish(false);
    });
    socket.once("timeout", () => {
      finish(false);
    });
    socket.setTimeout(1_000);
    socket.connect(port, host);
  });
}

async function waitForPortClosed(port, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!(await canConnect("127.0.0.1", port))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${label} to stop listening on port ${port}.`);
}

function readEmbeddedPostgresPort(userDataDir) {
  const pidFile = path.resolve(
    userDataDir,
    "runtime",
    "instances",
    "default",
    "db",
    "postmaster.pid",
  );

  if (!fs.existsSync(pidFile)) {
    return null;
  }

  const portLine = fs.readFileSync(pidFile, "utf8").split(/\r?\n/)[3]?.trim();
  const port = Number(portLine);
  return Number.isInteger(port) && port > 0 ? port : null;
}

async function createSmokeCompany(origin, theme) {
  const response = await fetch(new URL("/api/companies", origin), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: `Desktop Smoke ${theme} ${Date.now()}`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create smoke company (${response.status}): ${await response.text()}`);
  }

  return await response.json();
}

async function fetchJson(origin, pathname, options) {
  const response = await fetch(new URL(pathname, origin), options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`Request failed for ${pathname} (${response.status}): ${text}`);
  }
  return body;
}

async function listPlugins(origin) {
  return await fetchJson(origin, "/api/plugins", {});
}

async function waitForPlugin(origin, matcher, timeoutMs = 90_000) {
  const start = Date.now();
  let lastSeen = [];
  while (Date.now() - start < timeoutMs) {
    const plugins = await listPlugins(origin);
    lastSeen = plugins;
    const plugin = plugins.find(matcher);
    if (plugin) {
      return plugin;
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error(`Timed out waiting for plugin to appear. Last seen packages: ${lastSeen.map((plugin) => `${plugin.packageName}:${plugin.status}`).join(", ")}`);
}

async function installPlugin(origin, body) {
  return await fetchJson(origin, "/api/plugins/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postPluginAction(origin, pluginId, action, body = {}) {
  return await fetchJson(origin, `/api/plugins/${pluginId}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function uninstallPlugin(origin, pluginId) {
  const response = await fetch(new URL(`/api/plugins/${pluginId}`, origin), {
    method: "DELETE",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to uninstall plugin ${pluginId} (${response.status}): ${text}`);
  }
}

async function visitRoute(page, url, routeLabel) {
  await page.goto(url);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => {
    const root = document.querySelector("#root");
    const main = document.querySelector("#main-content");
    return Boolean(root && root.childElementCount > 0 && main);
  }, undefined, { timeout: 30_000 });
  assertDesktopLayoutState(await readDesktopLayoutState(page), routeLabel);
  assertTitlebarChromeState(await readTitlebarChromeState(page), routeLabel);
}

async function runExtendedDevAcceptance(origin, page, company) {
  const companyBase = `${origin}/${company.issuePrefix}`;
  const routeChecks = [
    { url: `${companyBase}/dashboard`, label: "desktop dashboard" },
    { url: `${companyBase}/issues`, label: "desktop issues" },
    { url: `${companyBase}/projects`, label: "desktop projects" },
    { url: `${companyBase}/agents/all`, label: "desktop agents" },
    { url: `${companyBase}/activity`, label: "desktop activity" },
    { url: `${origin}/instance/settings/plugins`, label: "desktop plugin manager" },
  ];

  for (const route of routeChecks) {
    await visitRoute(page, route.url, route.label);
  }

  const examples = await fetchJson(origin, "/api/plugins/examples", {});
  if (!Array.isArray(examples) || examples.length === 0) {
    throw new Error("Expected bundled plugin examples to be available in dev mode.");
  }

  for (const example of examples) {
    const installed = await installPlugin(origin, {
      packageName: example.localPath,
      isLocalPath: true,
    });
    if (!installed?.id || !installed?.packageName) {
      throw new Error(`Example install for ${example.packageName} returned an unexpected payload.`);
    }

    const listed = await waitForPlugin(
      origin,
      (plugin) => plugin.id === installed.id || plugin.packageName === installed.packageName,
    );
    if (!["ready", "installed"].includes(listed.status)) {
      throw new Error(`Bundled example ${example.packageName} installed with unexpected status ${listed.status}.`);
    }
  }

  const installedExamples = await listPlugins(origin);
  const readyExample = installedExamples.find((plugin) =>
    plugin.packageName === "@penclipai/plugin-hello-world-example" && plugin.status === "ready");
  if (!readyExample) {
    throw new Error("Hello World example plugin was not ready after installation.");
  }

  const contributions = await fetchJson(origin, "/api/plugins/ui-contributions", {});
  if (!Array.isArray(contributions) || !contributions.some((entry) => entry.pluginId === readyExample.id)) {
    throw new Error("Expected Hello World example plugin to publish a UI contribution.");
  }

  await postPluginAction(origin, readyExample.id, "disable");
  await waitForPlugin(origin, (plugin) => plugin.id === readyExample.id && plugin.status === "disabled");

  await postPluginAction(origin, readyExample.id, "enable");
  await waitForPlugin(origin, (plugin) => plugin.id === readyExample.id && plugin.status === "ready");

  await visitRoute(page, `${origin}/instance/settings/plugins/${readyExample.id}`, "desktop plugin settings");
}

async function readDesktopLayoutState(page) {
  return await page.evaluate(() => {
    const rect = (element) => {
      if (!(element instanceof Element)) return null;
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        height: box.height,
      };
    };

    const root = document.querySelector("#root");
    const appShell = root?.firstElementChild ?? null;
    const cetContainer = document.querySelector(".cet-container");
    const main = document.querySelector("#main-content");

    return {
      appShellPaddingTop:
        appShell instanceof Element ? Number.parseFloat(getComputedStyle(appShell).paddingTop || "0") : null,
      cetContainer: rect(cetContainer),
      main: rect(main),
      root: rect(root),
    };
  });
}

async function readTitlebarChromeState(page) {
  return await page.evaluate(() => {
    const colorCanvas = document.createElement("canvas");
    const colorContext = colorCanvas.getContext("2d");
    const normalizeColor = (value, fallback) => {
      if (!colorContext) {
        return value || fallback;
      }

      try {
        colorContext.canvas.width = 1;
        colorContext.canvas.height = 1;
        colorContext.clearRect(0, 0, 1, 1);
        colorContext.fillStyle = fallback;
        colorContext.fillStyle = value;
        colorContext.fillRect(0, 0, 1, 1);
        const [red = 0, green = 0, blue = 0, alpha = 255] = colorContext.getImageData(0, 0, 1, 1).data;
        const toHex = (channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0");
        const base = `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
        return alpha >= 254 ? base : `${base}${toHex((alpha / 255) * 255)}`;
      } catch {
        return fallback;
      }
    };

    const resolveCssColor = (variableName, property) => {
      const probe = document.createElement("span");
      probe.style.position = "absolute";
      probe.style.width = "0";
      probe.style.height = "0";
      probe.style.opacity = "0";
      probe.style.pointerEvents = "none";
      probe.style.color = property === "color" ? `var(${variableName})` : "transparent";
      probe.style.backgroundColor = property === "backgroundColor" ? `var(${variableName})` : "transparent";
      (document.body ?? document.documentElement).append(probe);
      const value = getComputedStyle(probe)[property];
      probe.remove();
      return normalizeColor(value, property === "color" ? "#000000" : "#ffffff");
    };

    const titlebar = document.querySelector(".cet-titlebar");
    const divider = document.querySelector('[data-testid="desktop-titlebar-divider"]');
    const backButton = document.querySelector('[data-testid="desktop-nav-back"]');
    const forwardButton = document.querySelector('[data-testid="desktop-nav-forward"]');
    const titlebarStyles = titlebar instanceof HTMLElement ? getComputedStyle(titlebar) : null;
    const dividerStyles = divider instanceof HTMLElement ? getComputedStyle(divider) : null;

    return {
      hasBackButton: backButton instanceof HTMLElement,
      hasForwardButton: forwardButton instanceof HTMLElement,
      backDisabled: backButton instanceof HTMLButtonElement ? backButton.disabled : null,
      forwardDisabled: forwardButton instanceof HTMLButtonElement ? forwardButton.disabled : null,
      hasDivider: divider instanceof HTMLElement && dividerStyles?.display !== "none",
      titlebarBackground: titlebarStyles ? normalizeColor(titlebarStyles.backgroundColor, "#ffffff") : null,
      dividerBackground: dividerStyles ? normalizeColor(dividerStyles.backgroundColor, "#000000") : null,
      pageBackground: resolveCssColor("--background", "backgroundColor"),
      pageBorder: resolveCssColor("--border", "color"),
    };
  });
}

function assertDesktopLayoutState(state, routeLabel) {
  if (!state.cetContainer || !state.root || !state.main) {
    throw new Error(`Missing layout nodes while validating ${routeLabel}.`);
  }

  if (state.root.bottom > state.cetContainer.bottom + 1) {
    throw new Error(
      `${routeLabel} root overflowed the CET container (${state.root.bottom} > ${state.cetContainer.bottom}).`,
    );
  }

  if (state.main.bottom > state.cetContainer.bottom + 1) {
    throw new Error(
      `${routeLabel} main content overflowed the CET container (${state.main.bottom} > ${state.cetContainer.bottom}).`,
    );
  }

  if ((state.appShellPaddingTop ?? 0) > 1) {
    throw new Error(
      `${routeLabel} retained an unexpected desktop top inset (${state.appShellPaddingTop}px).`,
    );
  }
}

function assertTitlebarChromeState(state, routeLabel) {
  if (!state.hasBackButton || !state.hasForwardButton) {
    throw new Error(`${routeLabel} did not render both desktop navigation buttons.`);
  }

  if (state.titlebarBackground !== state.pageBackground) {
    throw new Error(
      `${routeLabel} titlebar background "${state.titlebarBackground}" did not match page background "${state.pageBackground}".`,
    );
  }

  if (!state.hasDivider) {
    throw new Error(`${routeLabel} did not render the desktop titlebar divider.`);
  }

  if (state.dividerBackground !== state.pageBorder) {
    throw new Error(
      `${routeLabel} titlebar divider "${state.dividerBackground}" did not match page border "${state.pageBorder}".`,
    );
  }
}

async function ensureDirectory(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function writeFailureSnapshot(page, artifactDir, locale) {
  const debugPath = path.resolve(artifactDir, `failure-${locale}.html`);
  await fs.promises.writeFile(debugPath, await page.content(), "utf8");
}

async function runThemeScenario(mode, theme, artifactDir) {
  const userDataDir = await createSmokeUserDataDir(mode, theme);
  const launchOptions = mode === "dev"
    ? resolveDevLaunchOptions(userDataDir)
    : resolvePackagedLaunchOptions(userDataDir);
  const electronApp = await electron.launch(launchOptions);
  const launchedProcess = electronApp.process();
  const launchedPid = launchedProcess?.pid ?? null;
  let serverPort = null;
  let embeddedPostgresPort = null;

  try {
    const actualLocale = await electronApp.evaluate(({ app }) => app.getLocale());
    const locale =
      typeof actualLocale === "string" && actualLocale.toLowerCase().startsWith("zh")
        ? "zh-CN"
        : resolveExpectedLocale();
    const expectation = getSplashExpectation(locale, theme);
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    try {
      await page.locator('[data-testid="splash-logo"]').waitFor({ timeout: 20_000 });
      await page.locator('[data-testid="splash-progress"]').waitFor({ timeout: 10_000 });
      await page.locator('[data-testid="splash-status"]').waitFor({ timeout: 10_000 });

      const splashState = await page.evaluate(() => {
        const statusText =
          document.querySelector('[data-testid="splash-status"]')?.textContent?.trim() ?? "";
        const footerText =
          document.querySelector('[data-testid="splash-footer"]')?.textContent?.trim() ?? "";
        const logoTag = document.querySelector('[data-testid="splash-logo"]')?.tagName ?? null;
        const progressBar = document.querySelector('[data-testid="splash-progress-bar"]');
        const progressVisible =
          progressBar instanceof HTMLElement && getComputedStyle(progressBar).display !== "none";
        const rootStyles = getComputedStyle(document.documentElement);

        return {
          backgroundStart: rootStyles.getPropertyValue("--bg-start").trim(),
          footerText,
          hasHeading: Boolean(document.querySelector("h1")),
          logoTag,
          progressVisible,
          statusText,
          textColor: rootStyles.getPropertyValue("--text").trim(),
        };
      });

      if (!expectation.statuses.includes(splashState.statusText)) {
        throw new Error(
          `Unexpected splash status "${splashState.statusText}" (expected one of ${expectation.statuses.join(", ")}).`,
        );
      }

      if (splashState.footerText !== expectation.footer) {
        throw new Error(
          `Unexpected splash footer "${splashState.footerText}" (expected "${expectation.footer}").`,
        );
      }

      if (splashState.logoTag !== "IMG") {
        throw new Error(`Expected splash logo to render as IMG, received ${String(splashState.logoTag)}.`);
      }

      if (!splashState.progressVisible) {
        throw new Error("Expected splash progress indicator to be visible before the app loads.");
      }

      if (splashState.hasHeading) {
        throw new Error("Splash should not render a large heading element in the minimalist layout.");
      }

      if (splashState.backgroundStart !== expectation.tokens.backgroundStart) {
        throw new Error(
          `Unexpected splash background "${splashState.backgroundStart}" for ${theme} theme (expected "${expectation.tokens.backgroundStart}").`,
        );
      }

      if (splashState.textColor !== expectation.tokens.text) {
        throw new Error(
          `Unexpected splash text token "${splashState.textColor}" for ${theme} theme (expected "${expectation.tokens.text}").`,
        );
      }

      if (await page.locator('[data-testid="desktop-nav-back"]').count() !== 0) {
        throw new Error("Splash should not render a desktop back button.");
      }

      if (await page.locator('[data-testid="desktop-nav-forward"]').count() !== 0) {
        throw new Error("Splash should not render a desktop forward button.");
      }
    } catch (error) {
      await writeFailureSnapshot(page, artifactDir, `${locale}-${theme}`);
      throw error;
    }

    const splashShot = path.resolve(artifactDir, `splash-${locale}-${theme}.png`);
    await page.screenshot({ path: splashShot, fullPage: true });

    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/?/, { timeout: 90_000 });
    const currentUrl = page.url();
    const origin = new URL(currentUrl).origin;
    serverPort = Number(new URL(currentUrl).port);
    const health = await waitForHealth(origin);
    if (!health || typeof health !== "object") {
      throw new Error("Desktop health endpoint returned an unexpected payload.");
    }
    embeddedPostgresPort = readEmbeddedPostgresPort(userDataDir);

    await page.locator("#root").waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => {
      const root = document.querySelector("#root");
      return Boolean(root && root.childElementCount > 0);
    }, undefined, { timeout: 30_000 });

    await page.locator('[data-testid="desktop-nav-back"]').waitFor({ timeout: 15_000 });
    await page.locator('[data-testid="desktop-nav-forward"]').waitFor({ timeout: 15_000 });

    const initialTitlebarState = await readTitlebarChromeState(page);
    assertTitlebarChromeState(initialTitlebarState, "desktop root");

    if (!initialTitlebarState.backDisabled || !initialTitlebarState.forwardDisabled) {
      throw new Error("Desktop root should start with disabled back/forward buttons after splash history is cleared.");
    }

    const company = await createSmokeCompany(origin, theme);
    const dashboardUrl = `${origin}/${company.issuePrefix}/dashboard`;
    const issuesUrl = `${origin}/${company.issuePrefix}/issues`;

    await page.goto(dashboardUrl);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForFunction(() => {
      const root = document.querySelector("#root");
      const main = document.querySelector("#main-content");
      return Boolean(root && root.childElementCount > 0 && main);
    }, undefined, { timeout: 30_000 });

    const layoutState = await readDesktopLayoutState(page);
    assertDesktopLayoutState(layoutState, "desktop dashboard");
    assertTitlebarChromeState(await readTitlebarChromeState(page), "desktop dashboard");

    await page.goto(issuesUrl);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForFunction(() => {
      const back = document.querySelector('[data-testid="desktop-nav-back"]');
      const forward = document.querySelector('[data-testid="desktop-nav-forward"]');
      return (
        back instanceof HTMLButtonElement &&
        forward instanceof HTMLButtonElement &&
        !back.disabled &&
        forward.disabled
      );
    }, undefined, { timeout: 15_000 });

    const issuesTitlebarState = await readTitlebarChromeState(page);
    assertTitlebarChromeState(issuesTitlebarState, "desktop issues");

    await Promise.all([
      page.waitForURL(new RegExp(`${company.issuePrefix}/dashboard/?$`), { timeout: 15_000 }),
      page.locator('[data-testid="desktop-nav-back"]').click(),
    ]);

    if (page.url().startsWith("data:")) {
      throw new Error("Desktop back navigation unexpectedly returned to the splash page.");
    }

    await Promise.all([
      page.waitForURL(new RegExp(`${company.issuePrefix}/issues/?$`), { timeout: 15_000 }),
      page.locator('[data-testid="desktop-nav-forward"]').click(),
    ]);

    if (mode === "dev") {
      await runExtendedDevAcceptance(origin, page, company);
    }

    const boardShot = path.resolve(artifactDir, `board-${locale}-${theme}.png`);
    await page.screenshot({ path: boardShot, fullPage: true });

    console.log(`[desktop-smoke] ${mode} mode passed for ${theme} theme.`);
    console.log(`[desktop-smoke] Splash screenshot: ${splashShot}`);
    console.log(`[desktop-smoke] App screenshot: ${boardShot}`);
    console.log(`[desktop-smoke] Health: ${JSON.stringify(health)}`);
  } finally {
    let shutdownError = null;
    try {
      await electronApp.close();
      if (serverPort) {
        await waitForPortClosed(serverPort, "desktop control plane");
      }
      if (embeddedPostgresPort) {
        await waitForPortClosed(embeddedPostgresPort, "embedded PostgreSQL");
      }
    } catch (error) {
      shutdownError = error;
    } finally {
      killProcessTree(launchedPid, { cwd: packageDir });
      await cleanupUserDataDir(userDataDir);
    }

    if (shutdownError) {
      throw shutdownError;
    }
  }
}

async function run() {
  const { mode } = parseArgs(process.argv.slice(2));
  if (!["dev", "packaged"].includes(mode)) {
    throw new Error(`Unsupported smoke mode "${mode}". Use "dev" or "packaged".`);
  }

  const artifactDir = path.resolve(packageDir, ".artifacts", "smoke", mode);

  await ensureDirectory(artifactDir);

  if (mode === "dev") {
    prepareDevLaunch();
  }

  for (const theme of DESKTOP_THEMES) {
    await runThemeScenario(mode, theme, artifactDir);
  }
}

void run().catch((error) => {
  console.error("[desktop-smoke] Failed:", error);
  process.exitCode = 1;
});

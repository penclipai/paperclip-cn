#!/usr/bin/env node

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
const THIRD_PARTY_PLUGIN_CANDIDATES = [
  "paperclip-plugin-knok",
  "paperclip-plugin-superpowers",
  "paperclip-plugin-acp",
  "paperclip-plugin-telegram",
  "paperclip-plugin-discord",
  "@agent-analytics/paperclip-live-analytics-plugin",
  "@sergioconejo/paperclip-plugin-agent-chat",
  "@lucitra/paperclip-plugin-chat",
  "@lucitra/paperclip-plugin-linear",
  "@yesterday-ai/paperclip-plugin-company-wizard",
];
const EXAMPLE_PLUGIN_INSTALLS = [
  {
    packageName: "@penclipai/plugin-authoring-smoke-example",
    localPath: path.resolve(repoRoot, "packages", "plugins", "examples", "plugin-authoring-smoke-example"),
  },
  {
    packageName: "@penclipai/plugin-file-browser-example",
    localPath: path.resolve(repoRoot, "packages", "plugins", "examples", "plugin-file-browser-example"),
  },
  {
    packageName: "@penclipai/plugin-hello-world-example",
    localPath: path.resolve(repoRoot, "packages", "plugins", "examples", "plugin-hello-world-example"),
  },
  {
    packageName: "@penclipai/plugin-kitchen-sink-example",
    localPath: path.resolve(repoRoot, "packages", "plugins", "examples", "plugin-kitchen-sink-example"),
  },
];

function parseArgs(argv) {
  const args = {
    theme: "dark",
    scope: "core",
    skipBuild: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--theme") {
      args.theme = argv[index + 1] ?? args.theme;
      index += 1;
      continue;
    }
    if (arg === "--scope") {
      args.scope = argv[index + 1] ?? args.scope;
      index += 1;
      continue;
    }
    if (arg === "--skip-build") {
      args.skipBuild = true;
      continue;
    }
    if (arg.startsWith("--theme=")) {
      args.theme = arg.slice("--theme=".length);
      continue;
    }
    if (arg.startsWith("--scope=")) {
      args.scope = arg.slice("--scope=".length);
    }
  }
  return args;
}

async function ensureDirectory(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function createSmokeUserDataDir(theme) {
  const userDataDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), `paperclip-desktop-acceptance-${theme}-`),
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

function buildExamplePlugins() {
  for (const filter of EXAMPLE_PLUGIN_INSTALLS.map((entry) => entry.packageName)) {
    runPnpm(["--dir", repoRoot, "--filter", filter, "build"], { cwd: repoRoot });
  }
}

function prepareDevLaunch() {
  runPnpm(["--dir", repoRoot, "--filter", "@penclipai/server...", "build"], { cwd: repoRoot });
  runPnpm(["--dir", packageDir, "build"], { cwd: packageDir });
  buildExamplePlugins();
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

    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
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

function assertResponseOk(response, body, label) {
  if (!response.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`${label} failed (${response.status}): ${detail}`);
  }
}

async function fetchJson(origin, pathname, init, label) {
  const response = await fetch(new URL(pathname, origin), init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  assertResponseOk(response, body, label);
  return body;
}

async function createCompany(origin) {
  return await fetchJson(
    origin,
    "/api/companies",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: `Desktop Acceptance ${Date.now()}`,
      }),
    },
    "create company",
  );
}

async function createProject(origin, companyId) {
  return await fetchJson(
    origin,
    `/api/companies/${companyId}/projects`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Acceptance Project",
        description: "Project used by the desktop dev acceptance smoke.",
        workspace: {
          name: "Repo Workspace",
          sourceType: "local_path",
          cwd: repoRoot,
          isPrimary: true,
        },
      }),
    },
    "create project",
  );
}

async function createIssue(origin, companyId, projectId) {
  return await fetchJson(
    origin,
    `/api/companies/${companyId}/issues`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        title: "Acceptance Issue",
        description: "Used to ensure the issues experience loads in the desktop acceptance smoke.",
        status: "backlog",
        priority: "medium",
      }),
    },
    "create issue",
  );
}

async function createAgent(origin, companyId, body) {
  return await fetchJson(
    origin,
    `/api/companies/${companyId}/agents`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    `create agent ${body.name ?? "<unnamed>"}`,
  );
}

async function wakeAgent(origin, agentId, body) {
  return await fetchJson(
    origin,
    `/api/agents/${agentId}/wakeup`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    "wake agent",
  );
}

async function addIssueComment(origin, issueId, body) {
  return await fetchJson(
    origin,
    `/api/issues/${issueId}/comments`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    "add issue comment",
  );
}

async function getRun(origin, runId) {
  return await fetchJson(origin, `/api/heartbeat-runs/${runId}`, undefined, "get heartbeat run");
}

async function getRunLog(origin, runId) {
  const response = await fetch(new URL(`/api/heartbeat-runs/${runId}/log`, origin));
  if (response.status === 404) {
    return null;
  }
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  assertResponseOk(response, body, "get heartbeat run log");
  return body;
}

async function waitForRunOutput(origin, runId, timeoutMs = 240_000) {
  const start = Date.now();
  let lastRun = null;
  let lastLog = null;
  let lastLogContentLength = 0;

  while (Date.now() - start < timeoutMs) {
    lastRun = await getRun(origin, runId);
    lastLog = await getRunLog(origin, runId);
    const logContent = typeof lastLog?.content === "string" ? lastLog.content : "";
    const stdoutExcerpt = typeof lastRun?.stdoutExcerpt === "string" ? lastRun.stdoutExcerpt : "";
    const stderrExcerpt = typeof lastRun?.stderrExcerpt === "string" ? lastRun.stderrExcerpt : "";
    if (logContent.length > 0) {
      lastLogContentLength = logContent.length;
    }
    if (
      lastRun?.status &&
      !["queued", "running"].includes(lastRun.status) &&
      (
        lastLogContentLength > 0 ||
        lastRun.resultJson != null ||
        typeof lastRun.error === "string" ||
        stdoutExcerpt.length > 0 ||
        stderrExcerpt.length > 0
      )
    ) {
      return { run: lastRun, log: lastLog };
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(
    `Timed out waiting for run ${runId} to produce log output. Last status: ${lastRun?.status ?? "unknown"}`,
  );
}

function buildRunEvidenceText(runEvidence) {
  return [
    typeof runEvidence.log?.content === "string" ? runEvidence.log.content : "",
    runEvidence.run?.resultJson ? JSON.stringify(runEvidence.run.resultJson, null, 2) : "",
    typeof runEvidence.run?.error === "string" ? runEvidence.run.error : "",
    typeof runEvidence.run?.errorCode === "string" ? runEvidence.run.errorCode : "",
    typeof runEvidence.run?.stdoutExcerpt === "string" ? runEvidence.run.stdoutExcerpt : "",
    typeof runEvidence.run?.stderrExcerpt === "string" ? runEvidence.run.stderrExcerpt : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function getPlugin(origin, pluginId) {
  return await fetchJson(origin, `/api/plugins/${pluginId}`, undefined, "get plugin");
}

async function getPluginHealth(origin, pluginId) {
  return await fetchJson(origin, `/api/plugins/${pluginId}/health`, undefined, "get plugin health");
}

async function getPluginDashboard(origin, pluginId) {
  return await fetchJson(origin, `/api/plugins/${pluginId}/dashboard`, undefined, "get plugin dashboard");
}

async function listPlugins(origin) {
  return await fetchJson(origin, "/api/plugins", undefined, "list plugins");
}

async function listPluginUiContributions(origin) {
  return await fetchJson(origin, "/api/plugins/ui-contributions", undefined, "list plugin ui contributions");
}

async function installPlugin(origin, options) {
  return await fetchJson(
    origin,
    "/api/plugins/install",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options),
    },
    `install plugin ${options.packageName}`,
  );
}

async function installPluginIfNeeded(origin, options, packageNames) {
  const existingPlugins = await listPlugins(origin);
  const existing = existingPlugins.find((plugin) => packageNames.includes(plugin.packageName));
  if (existing) {
    return existing;
  }

  try {
    return await installPlugin(origin, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already installed/i.test(message)) {
      throw error;
    }

    const installedPlugins = await listPlugins(origin);
    const installed = installedPlugins.find((plugin) => packageNames.includes(plugin.packageName));
    if (installed) {
      return installed;
    }
    throw error;
  }
}

async function setPluginEnabled(origin, pluginId, enabled) {
  const pathname = enabled ? `/api/plugins/${pluginId}/enable` : `/api/plugins/${pluginId}/disable`;
  return await fetchJson(
    origin,
    pathname,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
    `${enabled ? "enable" : "disable"} plugin ${pluginId}`,
  );
}

async function uninstallPlugin(origin, pluginId, purge = true) {
  return await fetchJson(
    origin,
    `/api/plugins/${pluginId}${purge ? "?purge=true" : ""}`,
    {
      method: "DELETE",
    },
    `uninstall plugin ${pluginId}`,
  );
}

async function waitForPluginStatus(origin, pluginId, acceptedStatuses, timeoutMs = 120_000) {
  const start = Date.now();
  let plugin = null;

  while (Date.now() - start < timeoutMs) {
    plugin = await getPlugin(origin, pluginId);
    if (acceptedStatuses.includes(plugin.status)) {
      return plugin;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }

  throw new Error(
    `Timed out waiting for plugin ${pluginId} to reach one of ${acceptedStatuses.join(", ")}. Last status: ${plugin?.status ?? "unknown"}`,
  );
}

async function installThirdPartyPlugin(origin) {
  const failures = [];

  for (const packageName of THIRD_PARTY_PLUGIN_CANDIDATES) {
    try {
      const installed = await installPluginIfNeeded(origin, { packageName }, [packageName]);
      const plugin = await waitForPluginStatus(origin, installed.id, ["ready", "installed", "disabled"], 180_000);
      return { plugin, packageName, failures };
    } catch (error) {
      failures.push({
        packageName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw new Error(
    `Failed to install any third-party plugin candidate: ${JSON.stringify(failures, null, 2)}`,
  );
}

async function waitForMainContent(page, routeLabel) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => {
    const root = document.querySelector("#root");
    const main = document.querySelector("#main-content");
    return Boolean(root && root.childElementCount > 0 && main);
  }, undefined, { timeout: 30_000 });

  const text = await page.locator("#main-content").innerText().catch(() => "");
  if (/not found|failed to load|加载失败|页面未找到|出现错误|unexpected application error/i.test(text)) {
    throw new Error(`${routeLabel} rendered a likely blocking error state.`);
  }
}

async function readDesktopLayoutState(page) {
  return await page.evaluate(() => {
    const rect = (element) => {
      if (!(element instanceof Element)) return null;
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height };
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
      if (!colorContext) return value || fallback;
      try {
        colorContext.canvas.width = 1;
        colorContext.canvas.height = 1;
        colorContext.clearRect(0, 0, 1, 1);
        colorContext.fillStyle = fallback;
        colorContext.fillStyle = value;
        colorContext.fillRect(0, 0, 1, 1);
        const [red = 0, green = 0, blue = 0, alpha = 255] = colorContext.getImageData(0, 0, 1, 1).data;
        const toHex = (channel) =>
          Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0");
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
    throw new Error(`${routeLabel} root overflowed the CET container.`);
  }
  if (state.main.bottom > state.cetContainer.bottom + 1) {
    throw new Error(`${routeLabel} main content overflowed the CET container.`);
  }
  if ((state.appShellPaddingTop ?? 0) > 1) {
    throw new Error(`${routeLabel} retained an unexpected desktop top inset.`);
  }
}

function assertTitlebarChromeState(state, routeLabel) {
  if (!state.hasBackButton || !state.hasForwardButton) {
    throw new Error(`${routeLabel} did not render both desktop navigation buttons.`);
  }
  if (state.titlebarBackground !== state.pageBackground) {
    throw new Error(`${routeLabel} titlebar background did not match page background.`);
  }
  if (!state.hasDivider) {
    throw new Error(`${routeLabel} did not render the desktop titlebar divider.`);
  }
  if (state.dividerBackground !== state.pageBorder) {
    throw new Error(`${routeLabel} titlebar divider did not match page border.`);
  }
}

async function verifyDesktopRoute(page, url, routeLabel) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/ERR_ABORTED|frame was detached/i.test(message) || attempt === 2) {
        throw error;
      }
      await page.waitForTimeout(1_000);
    }
  }
  if (lastError) {
    throw lastError;
  }
  await waitForMainContent(page, routeLabel);
  assertDesktopLayoutState(await readDesktopLayoutState(page), routeLabel);
  assertTitlebarChromeState(await readTitlebarChromeState(page), routeLabel);
}

async function runAcceptanceFlow({ page, origin, company, project, issue, agent, artifactDir, scope }) {
  const companyPrefix = company.issuePrefix;
  const fullScope = scope === "full";
  let ceo = null;
  let manager = null;
  let reviewer = null;
  let coordinationIssue = null;
  let implementationIssue = issue;
  let reviewIssue = null;

  if (fullScope) {
    ceo = await createAgent(origin, company.id, {
      name: "Acceptance CEO",
      role: "ceo",
      adapterType: "claude_local",
      adapterConfig: {},
    });
    manager = await createAgent(origin, company.id, {
      name: "Acceptance Manager",
      role: "general",
      reportsTo: ceo.id,
      adapterType: "claude_local",
      adapterConfig: {},
    });
    reviewer = await createAgent(origin, company.id, {
      name: "Acceptance Reviewer",
      role: "general",
      reportsTo: manager.id,
      adapterType: "claude_local",
      adapterConfig: {},
    });

    coordinationIssue = await fetchJson(
      origin,
      `/api/companies/${company.id}/issues`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          title: "Coordination Issue",
          description: "Tracks the multi-agent coordination layer for desktop acceptance.",
          status: "backlog",
          priority: "high",
          assigneeAgentId: manager.id,
        }),
      },
      "create coordination issue",
    );
    implementationIssue = await fetchJson(
      origin,
      `/api/companies/${company.id}/issues`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          title: "Implementation Issue",
          description: "Assigned to the Claude acceptance agent and blocked by coordination.",
          status: "backlog",
          priority: "medium",
          assigneeAgentId: agent.id,
          blockedByIssueIds: [coordinationIssue.id],
        }),
      },
      "create implementation issue",
    );
    reviewIssue = await fetchJson(
      origin,
      `/api/companies/${company.id}/issues`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          title: "Review Issue",
          description: "Assigned to the reviewer agent and blocked by implementation.",
          status: "backlog",
          priority: "medium",
          assigneeAgentId: reviewer.id,
          blockedByIssueIds: [implementationIssue.id],
        }),
      },
      "create review issue",
    );

    await addIssueComment(origin, implementationIssue.id, {
      body: `Coordination handoff prepared. Reviewer: ${reviewer.name}`,
    });
  }

  const routes = [
    { label: "dashboard", url: `${origin}/${companyPrefix}/dashboard` },
    { label: "issues", url: `${origin}/${companyPrefix}/issues` },
    { label: "org chart", url: `${origin}/${companyPrefix}/org` },
    { label: "projects", url: `${origin}/${companyPrefix}/projects` },
    { label: "project detail", url: `${origin}/${companyPrefix}/projects/${project.id}` },
    { label: "project issues", url: `${origin}/${companyPrefix}/projects/${project.id}/issues` },
    { label: "acceptance issue detail", url: `${origin}/${companyPrefix}/issues/${issue.id}` },
    { label: "plugin manager", url: `${origin}/instance/settings/plugins` },
  ];
  if (fullScope && implementationIssue && reviewIssue) {
    routes.push(
      { label: "implementation issue detail", url: `${origin}/${companyPrefix}/issues/${implementationIssue.id}` },
      { label: "review issue detail", url: `${origin}/${companyPrefix}/issues/${reviewIssue.id}` },
    );
  }

  for (const route of routes) {
    await verifyDesktopRoute(page, route.url, route.label);
  }

  let runEvidence = null;
  if (fullScope) {
    const run = await wakeAgent(origin, agent.id, {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "desktop_acceptance_multi_agent_issue",
      payload: {
        issueId: implementationIssue.id,
        projectId: project.id,
      },
      contextSnapshot: {
        issueId: implementationIssue.id,
        taskId: implementationIssue.id,
        projectId: project.id,
        source: "desktop.acceptance.multi-agent",
        wakeReason: "desktop_acceptance_multi_agent_issue",
      },
    });
    runEvidence = await waitForRunOutput(origin, run.id);
    const claudeEvidenceText = buildRunEvidenceText(runEvidence);

    await fs.promises.writeFile(
      path.resolve(artifactDir, "claude-run-log.txt"),
      claudeEvidenceText,
      "utf8",
    );

    if (!claudeEvidenceText.trim()) {
      throw new Error(`Claude acceptance run ${run.id} did not produce any terminal evidence.`);
    }

    if (!/API Error|assistant|result|summary|message|provider|provider_response_error|Arrearage|READY|claude/i.test(claudeEvidenceText)) {
      throw new Error("Claude acceptance run log did not contain recognizable real CLI output.");
    }
  }

  const installedExamples = [];
  for (const example of EXAMPLE_PLUGIN_INSTALLS) {
    const installed = await installPluginIfNeeded(origin, {
      packageName: example.localPath,
      isLocalPath: true,
    }, [example.packageName]);
    const plugin = await waitForPluginStatus(origin, installed.id, ["ready"], 180_000);
    await getPluginHealth(origin, plugin.id);
    await getPluginDashboard(origin, plugin.id);
    installedExamples.push(plugin);
  }

  const uiContributions = await listPluginUiContributions(origin);
  const helloWorldPlugin = installedExamples.find((plugin) => plugin.packageName === "@penclipai/plugin-hello-world-example");
  if (!helloWorldPlugin) {
    throw new Error("Hello World example plugin was not installed.");
  }
  if (!uiContributions.some((entry) => entry.pluginId === helloWorldPlugin.id)) {
    throw new Error("Hello World plugin did not appear in UI contributions.");
  }

  await verifyDesktopRoute(page, `${origin}/${companyPrefix}/dashboard`, "dashboard after hello-world install");
  await page.locator("text=This widget was added by @penclipai/plugin-hello-world-example.").waitFor({ timeout: 30_000 });

  const fileBrowserPlugin = installedExamples.find((plugin) => plugin.packageName === "@penclipai/plugin-file-browser-example");
  if (!fileBrowserPlugin) {
    throw new Error("File Browser example plugin was not installed.");
  }
  await verifyDesktopRoute(page, `${origin}/${companyPrefix}/projects/${project.id}`, "project detail after file-browser install");
  await page.locator("text=Files").first().waitFor({ timeout: 30_000 });

  const kitchenSinkPlugin = installedExamples.find((plugin) => plugin.packageName === "@penclipai/plugin-kitchen-sink-example");
  if (!kitchenSinkPlugin) {
    throw new Error("Kitchen Sink example plugin was not installed.");
  }
  await verifyDesktopRoute(page, `${origin}/instance/settings/plugins/${kitchenSinkPlugin.id}`, "kitchen sink settings");

  const authoringPlugin = installedExamples.find((plugin) => plugin.packageName === "@penclipai/plugin-authoring-smoke-example");
  if (!authoringPlugin) {
    throw new Error("Authoring Smoke example plugin was not installed.");
  }
  await verifyDesktopRoute(page, `${origin}/instance/settings/plugins/${authoringPlugin.id}`, "authoring smoke settings");

  await setPluginEnabled(origin, helloWorldPlugin.id, false);
  await waitForPluginStatus(origin, helloWorldPlugin.id, ["disabled"], 60_000);
  await setPluginEnabled(origin, helloWorldPlugin.id, true);
  await waitForPluginStatus(origin, helloWorldPlugin.id, ["ready"], 60_000);

  let thirdPartyInstall = null;
  if (fullScope) {
    thirdPartyInstall = await installThirdPartyPlugin(origin);
    await verifyDesktopRoute(page, `${origin}/instance/settings/plugins/${thirdPartyInstall.plugin.id}`, "third-party plugin settings");
  }

  const evidence = {
    scope,
    companyId: company.id,
    companyPrefix,
    projectId: project.id,
    issueId: issue.id,
    agentId: agent.id,
    multiAgent: fullScope ? {
      ceoAgentId: ceo.id,
      managerAgentId: manager.id,
      reviewerAgentId: reviewer.id,
      coordinationIssueId: coordinationIssue.id,
      implementationIssueId: implementationIssue.id,
      reviewIssueId: reviewIssue.id,
    } : null,
    claudeRun: fullScope && runEvidence ? {
      runId: runEvidence.run?.id ?? null,
      status: runEvidence.run?.status ?? null,
      errorCode: runEvidence.run?.errorCode ?? null,
      logBytes: typeof runEvidence.log?.content === "string" ? runEvidence.log.content.length : 0,
    } : null,
    examples: installedExamples.map((plugin) => ({
      id: plugin.id,
      packageName: plugin.packageName,
      status: plugin.status,
    })),
    thirdParty: thirdPartyInstall ? {
      packageName: thirdPartyInstall.packageName,
      pluginId: thirdPartyInstall.plugin.id,
      status: thirdPartyInstall.plugin.status,
      attemptedFailures: thirdPartyInstall.failures,
    } : null,
  };

  await fs.promises.writeFile(
    path.resolve(artifactDir, "acceptance-evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );

  const cleanupPluginIds = [
    ...installedExamples.map((plugin) => plugin.id),
    ...(thirdPartyInstall ? [thirdPartyInstall.plugin.id] : []),
  ];
  for (const pluginId of cleanupPluginIds.reverse()) {
    await uninstallPlugin(origin, pluginId, true);
  }
}

async function writeFailureSnapshot(page, artifactDir) {
  const debugPath = path.resolve(artifactDir, "acceptance-failure.html");
  await fs.promises.writeFile(debugPath, await page.content(), "utf8");
  await page.screenshot({
    path: path.resolve(artifactDir, "acceptance-failure.png"),
    fullPage: true,
  });
}

async function run() {
  const { theme, scope, skipBuild } = parseArgs(process.argv.slice(2));
  if (!["core", "full"].includes(scope)) {
    throw new Error(`Unsupported acceptance scope "${scope}". Use "core" or "full".`);
  }
  const artifactDir = path.resolve(packageDir, ".artifacts", "smoke", `acceptance-dev-${scope}`);

  await ensureDirectory(artifactDir);
  if (!skipBuild) {
    prepareDevLaunch();
  }

  const userDataDir = await createSmokeUserDataDir(theme);
  const launchOptions = resolveDevLaunchOptions(userDataDir);
  const electronApp = await electron.launch(launchOptions);
  const launchedProcess = electronApp.process();
  const launchedPid = launchedProcess?.pid ?? null;
  let serverPort = null;
  let embeddedPostgresPort = null;

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/?/, { timeout: 90_000 });

    const origin = new URL(page.url()).origin;
    serverPort = Number(new URL(page.url()).port);
    embeddedPostgresPort = readEmbeddedPostgresPort(userDataDir);
    const health = await waitForHealth(origin);

    const company = await createCompany(origin);
    const project = await createProject(origin, company.id);
    const issue = await createIssue(origin, company.id, project.id);
    const agent = await createAgent(origin, company.id, {
      name: "Claude Acceptance Agent",
      role: "general",
      adapterType: "claude_local",
      adapterConfig: {},
    });

    await runAcceptanceFlow({
      page,
      origin,
      company,
      project,
      issue,
      agent,
      artifactDir,
      scope,
    });

    await page.screenshot({
      path: path.resolve(artifactDir, "acceptance-final.png"),
      fullPage: true,
    });

    console.log(`[desktop-acceptance] Dev acceptance passed (${scope}).`);
    console.log(`[desktop-acceptance] Health: ${JSON.stringify(health)}`);
    console.log(`[desktop-acceptance] Evidence: ${path.resolve(artifactDir, "acceptance-evidence.json")}`);
  } catch (error) {
    const page = await electronApp.firstWindow().catch(() => null);
    if (page) {
      await writeFailureSnapshot(page, artifactDir).catch(() => {});
    }
    throw error;
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

void run().catch((error) => {
  console.error("[desktop-acceptance] Failed:", error);
  process.exitCode = 1;
});

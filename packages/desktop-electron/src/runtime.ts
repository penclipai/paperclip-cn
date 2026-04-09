import fs from "node:fs";
import path from "node:path";

export type DesktopMode = "development" | "packaged";
export type DesktopTheme = "light" | "dark";
export type DesktopPreferences = {
  theme?: DesktopTheme;
};

export type DesktopRuntimeInput = {
  appRoot: string;
  repoRoot: string;
  userDataDir: string;
  mode: DesktopMode;
};

export const DESKTOP_TITLEBAR_HEIGHT = 42;
export const DESKTOP_WINDOW_TITLE = "Paperclip CN";
export const DESKTOP_APP_ID = "ai.penclip.desktop";
export const DESKTOP_PREFERENCES_FILENAME = "desktop-preferences.json";
const DESKTOP_TEMP_INSTANCE_PATH_RE = /paperclip-desktop-(?:smoke|acceptance)-/i;

export type DesktopTitlebarThemeConfig = {
  version: 1;
  fontFamily: string;
  fontSize: number;
  iconFilter: string;
  colors: {
    titlebar: string;
    titlebarForeground: string;
    menuBar: string;
    menuItemSelection: string;
    menuSeparator: string;
    svg: string;
  };
};

const DESKTOP_TITLEBAR_THEME_CONFIGS: Record<DesktopTheme, DesktopTitlebarThemeConfig> = {
  light: {
    version: 1,
    fontFamily: "Segoe UI, Microsoft YaHei UI, Arial, sans-serif",
    fontSize: 13,
    iconFilter: "none",
    colors: {
      titlebar: "#f6f8fc",
      titlebarForeground: "#0f172a",
      menuBar: "#f8fbff",
      menuItemSelection: "#dbeafe",
      menuSeparator: "#cbd5e1",
      svg: "#475569",
    },
  },
  dark: {
    version: 1,
    fontFamily: "Segoe UI, Microsoft YaHei UI, Arial, sans-serif",
    fontSize: 13,
    iconFilter: "brightness(0) saturate(100%) invert(1)",
    colors: {
      titlebar: "#18181b",
      titlebarForeground: "#fafafa",
      menuBar: "#111214",
      menuItemSelection: "#27272a",
      menuSeparator: "#3f3f46",
      svg: "#e5e7eb",
    },
  },
};

export function getDesktopThemeFromDarkMode(isDark: boolean): DesktopTheme {
  return isDark ? "dark" : "light";
}

export function isDesktopTheme(value: unknown): value is DesktopTheme {
  return value === "light" || value === "dark";
}

export function getDesktopTitlebarThemeConfig(theme: DesktopTheme): DesktopTitlebarThemeConfig {
  return DESKTOP_TITLEBAR_THEME_CONFIGS[theme];
}

export function getDesktopTitlebarOverlay(theme: DesktopTheme): {
  color: string;
  symbolColor: string;
  height: number;
} {
  const config = getDesktopTitlebarThemeConfig(theme);
  return {
    color: config.colors.titlebar,
    symbolColor: config.colors.titlebarForeground,
    height: DESKTOP_TITLEBAR_HEIGHT,
  };
}

export function getDesktopWindowBackground(theme: DesktopTheme): string {
  return theme === "dark" ? "#1c1c1e" : "#f5f2ea";
}

export function resolveDesktopAppRoot(fromFile: string): string {
  return path.resolve(path.dirname(fromFile), "..");
}

export function resolveDesktopRepoRoot(appRoot: string): string {
  return path.resolve(appRoot, "../..");
}

export function resolvePackagedRuntimeRoot(appRoot: string): string {
  return path.resolve(appRoot, "..", "app-runtime");
}

function resolveDesktopPaperclipHome(userDataDir: string): string {
  return process.env.PAPERCLIP_HOME?.trim() || userDataDir;
}

function resolveDesktopPaperclipInstanceId(): string {
  return process.env.PAPERCLIP_INSTANCE_ID?.trim() || "default";
}

function resolveDesktopPaperclipConfigPath(
  paperclipHome: string,
  instanceId: string,
): string {
  return path.resolve(paperclipHome, "instances", instanceId, "config.json");
}

function resolveDesktopPaperclipContextPath(paperclipHome: string): string {
  return path.resolve(paperclipHome, "context.json");
}

export function resolveDesktopUserDataDir(defaultUserDataDir: string): string {
  const override = process.env.PAPERCLIP_DESKTOP_USER_DATA_DIR?.trim();
  return override ? path.resolve(override) : defaultUserDataDir;
}

export function resolveDesktopPreferencesPath(userDataDir: string): string {
  return path.resolve(userDataDir, DESKTOP_PREFERENCES_FILENAME);
}

export function readDesktopThemePreference(preferencesPath: string): DesktopTheme | null {
  try {
    const raw = fs.readFileSync(preferencesPath, "utf8");
    const parsed = JSON.parse(raw) as DesktopPreferences;
    return isDesktopTheme(parsed.theme) ? parsed.theme : null;
  } catch {
    return null;
  }
}

export function writeDesktopThemePreference(preferencesPath: string, theme: DesktopTheme): void {
  fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
  fs.writeFileSync(
    preferencesPath,
    `${JSON.stringify({ theme } satisfies DesktopPreferences, null, 2)}\n`,
    "utf8",
  );
}

export function resolveDesktopTheme(
  userDataDir: string,
  fallbackUsesDarkColors: boolean,
): DesktopTheme {
  return (
    readDesktopThemePreference(resolveDesktopPreferencesPath(userDataDir)) ??
    getDesktopThemeFromDarkMode(fallbackUsesDarkColors)
  );
}

function resolvePackagedServerEntrypoint(runtimeRoot: string): string {
  const candidates = [
    path.resolve(runtimeRoot, "server", "dist", "index.js"),
    path.resolve(runtimeRoot, "node_modules", "@penclipai", "server", "dist", "index.js"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

export function resolveServerEntrypoint(input: DesktopRuntimeInput): string {
  return input.mode === "development"
    ? path.resolve(input.repoRoot, "server", "src", "index.ts")
    : resolvePackagedServerEntrypoint(resolvePackagedRuntimeRoot(input.appRoot));
}

export function resolveTitlebarThemePath(appRoot: string): string {
  return path.resolve(appRoot, "dist", "titlebar.theme.json");
}

function isBrokenDesktopTempPath(candidate: string | undefined): boolean {
  const trimmed = candidate?.trim();
  if (!trimmed) return false;

  const resolved = path.resolve(trimmed);
  return DESKTOP_TEMP_INSTANCE_PATH_RE.test(resolved) && !fs.existsSync(resolved);
}

function isPathInsideDir(candidatePath: string, parentDir: string): boolean {
  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedParent = path.resolve(parentDir);
  const relative = path.relative(resolvedParent, resolvedCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isCurrentDesktopOverridePath(
  candidate: string | undefined,
  desktopUserDataDir: string,
): boolean {
  const trimmed = candidate?.trim();
  if (!trimmed) return false;
  return isPathInsideDir(trimmed, desktopUserDataDir);
}

function hasBrokenInheritedDesktopPaperclipEnv(desktopUserDataDir: string): boolean {
  return (
    (isBrokenDesktopTempPath(process.env.PAPERCLIP_HOME)
      && !isCurrentDesktopOverridePath(process.env.PAPERCLIP_HOME, desktopUserDataDir))
    || (isBrokenDesktopTempPath(process.env.PAPERCLIP_CONTEXT)
      && !isCurrentDesktopOverridePath(process.env.PAPERCLIP_CONTEXT, desktopUserDataDir))
    || (isBrokenDesktopTempPath(process.env.PAPERCLIP_CONFIG)
      && !isCurrentDesktopOverridePath(process.env.PAPERCLIP_CONFIG, desktopUserDataDir))
  );
}

export function buildWorkerEnvironment(input: DesktopRuntimeInput): NodeJS.ProcessEnv {
  const inheritedEnv: NodeJS.ProcessEnv = { ...process.env };

  // Desktop smoke/acceptance runs intentionally inject a temp PAPERCLIP_HOME.
  // If a later desktop session inherits one of those temp paths after cleanup,
  // the worker should fall back to the normal desktop instance instead of
  // crashing while trying to reuse a deleted temp runtime.
  if (hasBrokenInheritedDesktopPaperclipEnv(input.userDataDir)) {
    for (const key of [
      "PAPERCLIP_HOME",
      "PAPERCLIP_INSTANCE_ID",
      "PAPERCLIP_CONFIG",
      "PAPERCLIP_CONTEXT",
      "PAPERCLIP_IN_WORKTREE",
      "PAPERCLIP_WORKTREE_NAME",
      "PAPERCLIP_WORKTREE_COLOR",
      "PAPERCLIP_WORKTREES_DIR",
    ]) {
      delete inheritedEnv[key];
    }
  }

  const paperclipHome = inheritedEnv.PAPERCLIP_HOME?.trim() || input.userDataDir;
  const paperclipInstanceId = inheritedEnv.PAPERCLIP_INSTANCE_ID?.trim() || "default";
  const workerEnv: NodeJS.ProcessEnv = {
    ...inheritedEnv,
    PAPERCLIP_DESKTOP_MODE: input.mode,
    PAPERCLIP_DESKTOP_SERVER_ENTRY: resolveServerEntrypoint(input),
    PAPERCLIP_HOME: paperclipHome,
    PAPERCLIP_INSTANCE_ID: paperclipInstanceId,
    HOST: "127.0.0.1",
    PORT: process.env.PORT?.trim() || "3100",
    PAPERCLIP_OPEN_ON_LISTEN: "false",
  };

  if (input.mode === "development") {
    return {
      ...workerEnv,
      PAPERCLIP_UI_DEV_MIDDLEWARE: "true",
    };
  }

  // Packaged desktop builds must always serve the bundled ui-dist instead of inheriting dev/API-only flags.
  return {
    ...workerEnv,
    PAPERCLIP_CONFIG: resolveDesktopPaperclipConfigPath(paperclipHome, paperclipInstanceId),
    PAPERCLIP_CONTEXT: resolveDesktopPaperclipContextPath(paperclipHome),
    PAPERCLIP_IN_WORKTREE: "",
    PAPERCLIP_WORKTREE_NAME: "",
    PAPERCLIP_WORKTREES_DIR: "",
    SERVE_UI: "true",
    PAPERCLIP_UI_DEV_MIDDLEWARE: "false",
  };
}

export function shouldOpenExternalNavigation(
  targetUrl: string,
  currentAppUrl: string | null,
): boolean {
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return false;
  }

  if (target.protocol === "data:" || target.protocol === "devtools:") {
    return false;
  }

  if (!currentAppUrl) {
    return target.protocol === "http:" || target.protocol === "https:" || target.protocol === "mailto:";
  }

  try {
    const appUrl = new URL(currentAppUrl);
    if (target.origin === appUrl.origin) {
      return false;
    }
  } catch {
    // Fall back to conservative external-link handling below.
  }

  return target.protocol === "http:" || target.protocol === "https:" || target.protocol === "mailto:";
}

export function formatChildExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) return `signal ${signal}`;
  if (code === null) return "unknown exit";
  return `exit code ${code}`;
}

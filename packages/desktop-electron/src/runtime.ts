import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type DesktopMode = "development" | "packaged";
export type DesktopTheme = "light" | "dark";
export type DesktopWindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesktopWindowPreference = {
  bounds: DesktopWindowBounds;
  maximized: boolean;
  lastPath?: string;
};

export type DesktopPreferences = {
  theme?: DesktopTheme;
  closeToTray?: boolean;
  notificationsEnabled?: boolean;
  trayHintShown?: boolean;
  locale?: "zh-CN" | "en";
  window?: DesktopWindowPreference;
};

export type DesktopWorkArea = DesktopWindowBounds;

export type ResolvedDesktopWindowState = {
  bounds: DesktopWindowBounds;
  maximized: boolean;
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
export const DESKTOP_USER_DATA_DIRNAME = "penclip";
const DESKTOP_TEMP_INSTANCE_PATH_RE = /paperclip-desktop-(?:smoke|acceptance)-/i;

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

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
  if (override) return path.resolve(override);
  if (isWindowsAbsolutePath(defaultUserDataDir)) {
    return path.win32.resolve(path.win32.dirname(defaultUserDataDir), DESKTOP_USER_DATA_DIRNAME);
  }
  return path.resolve(path.dirname(defaultUserDataDir), DESKTOP_USER_DATA_DIRNAME);
}

export function resolveDesktopPreferencesPath(userDataDir: string): string {
  return path.resolve(userDataDir, DESKTOP_PREFERENCES_FILENAME);
}

const DEFAULT_DESKTOP_WINDOW_BOUNDS: DesktopWindowBounds = {
  x: 0,
  y: 0,
  width: 1280,
  height: 800,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDesktopWindowBounds(value: unknown): value is DesktopWindowBounds {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DesktopWindowBounds>;
  return (
    isFiniteNumber(candidate.x)
    && isFiniteNumber(candidate.y)
    && isFiniteNumber(candidate.width)
    && isFiniteNumber(candidate.height)
    && candidate.width > 0
    && candidate.height > 0
  );
}

function normalizeDesktopPreferences(value: unknown): DesktopPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      closeToTray: true,
      notificationsEnabled: true,
    };
  }

  const candidate = value as Partial<DesktopPreferences>;
  const preferences: DesktopPreferences = {
    closeToTray: typeof candidate.closeToTray === "boolean" ? candidate.closeToTray : true,
    notificationsEnabled:
      typeof candidate.notificationsEnabled === "boolean" ? candidate.notificationsEnabled : true,
  };

  if (isDesktopTheme(candidate.theme)) preferences.theme = candidate.theme;
  if (typeof candidate.trayHintShown === "boolean") preferences.trayHintShown = candidate.trayHintShown;
  if (candidate.locale === "zh-CN" || candidate.locale === "en") preferences.locale = candidate.locale;
  if (candidate.window && typeof candidate.window === "object") {
    const savedWindow = candidate.window as Partial<DesktopWindowPreference>;
    if (isDesktopWindowBounds(savedWindow.bounds) && typeof savedWindow.maximized === "boolean") {
      preferences.window = {
        bounds: { ...savedWindow.bounds },
        maximized: savedWindow.maximized,
      };
      const lastPath = normalizeDesktopAppPath(savedWindow.lastPath);
      if (lastPath) preferences.window.lastPath = lastPath;
    }
  }

  return preferences;
}

/** Reads and validates the whole desktop preference envelope. */
export function readDesktopPreferences(preferencesPath: string): DesktopPreferences {
  try {
    return normalizeDesktopPreferences(JSON.parse(fs.readFileSync(preferencesPath, "utf8")));
  } catch {
    return normalizeDesktopPreferences(null);
  }
}

/**
 * Synchronously merge known fields and atomically replace the preference file.
 * This is deliberately small and dependency-free because it runs during quit.
 */
export function writeDesktopPreferences(
  preferencesPath: string,
  patch: Partial<DesktopPreferences>,
): DesktopPreferences {
  const current = readDesktopPreferences(preferencesPath);
  const next: DesktopPreferences = { ...current };
  if (isDesktopTheme(patch.theme)) next.theme = patch.theme;
  if (typeof patch.closeToTray === "boolean") next.closeToTray = patch.closeToTray;
  if (typeof patch.notificationsEnabled === "boolean") {
    next.notificationsEnabled = patch.notificationsEnabled;
  }
  if (typeof patch.trayHintShown === "boolean") next.trayHintShown = patch.trayHintShown;
  if (patch.locale === "zh-CN" || patch.locale === "en") next.locale = patch.locale;

  if (patch.window !== undefined) {
    const windowPatch = patch.window;
    if (windowPatch && isDesktopWindowBounds(windowPatch.bounds) && typeof windowPatch.maximized === "boolean") {
      next.window = {
        bounds: { ...windowPatch.bounds },
        maximized: windowPatch.maximized,
      };
      const lastPath = normalizeDesktopAppPath(windowPatch.lastPath);
      if (lastPath) next.window.lastPath = lastPath;
    }
  }

  fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
  const temporaryPath = `${preferencesPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, preferencesPath);
  } finally {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // The rename already consumed the temporary file, or cleanup is best effort.
    }
  }

  return next;
}

export function readDesktopThemePreference(preferencesPath: string): DesktopTheme | null {
  return readDesktopPreferences(preferencesPath).theme ?? null;
}

export function writeDesktopThemePreference(preferencesPath: string, theme: DesktopTheme): void {
  writeDesktopPreferences(preferencesPath, { theme });
}

/**
 * Allow only internal app routes to be persisted or sent through the preload
 * navigation bridge. External, setup, and authentication routes never belong
 * in the desktop restore state.
 */
export function normalizeDesktopAppPath(candidate: unknown): string | null {
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  if (
    !trimmed
    || trimmed.length > 2048
    || /[\u0000-\u001f\u007f]/.test(trimmed)
    || trimmed.includes("\\")
    || trimmed.includes("%")
  ) return null;
  const suffixIndex = trimmed.search(/[?#]/);
  const pathname = suffixIndex === -1 ? trimmed : trimmed.slice(0, suffixIndex);
  if (!pathname.startsWith("/") || pathname.startsWith("//") || pathname.includes("@")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(pathname)) return null;
  const segments = pathname.slice(1).split("/");
  if (segments.some((segment, index) => (
    segment === "." || segment === ".." || (!segment && index < segments.length - 1)
  ))) {
    return null;
  }
  const firstSegment = pathname.split("/")[1]?.toLowerCase();
  if ([
    "api",
    "auth",
    "login",
    "setup",
    "invite",
    "invitation",
    "invitations",
    "pairing",
    "board-claim",
    "cli-auth",
    "mcp-connect",
    "dot-connect",
    "oauth-handoff",
  ].includes(firstSegment ?? "")) return null;
  return pathname;
}

function intersectionArea(left: DesktopWindowBounds, right: DesktopWorkArea): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
}

function normalizeWorkArea(value: DesktopWorkArea | undefined): DesktopWorkArea | null {
  return isDesktopWindowBounds(value) ? value : null;
}

export function resolveDesktopWindowState(
  savedWindow: unknown,
  workAreas: DesktopWorkArea[],
  primaryWorkArea: DesktopWorkArea,
): ResolvedDesktopWindowState {
  const validAreas = workAreas.map(normalizeWorkArea).filter((area): area is DesktopWorkArea => area !== null);
  const primary = normalizeWorkArea(primaryWorkArea) ?? validAreas[0] ?? {
    x: 0,
    y: 0,
    width: DEFAULT_DESKTOP_WINDOW_BOUNDS.width,
    height: DEFAULT_DESKTOP_WINDOW_BOUNDS.height,
  };
  const saved = savedWindow && typeof savedWindow === "object"
    ? savedWindow as Partial<DesktopWindowPreference>
    : null;
  const savedBounds = saved && isDesktopWindowBounds(saved.bounds) ? saved.bounds : null;
  const savedArea = savedBounds
    ? validAreas.reduce<DesktopWorkArea | null>((best, area) => {
      if (!best || intersectionArea(savedBounds, area) > intersectionArea(savedBounds, best)) return area;
      return best;
    }, null)
    : null;
  const hasVisibleSavedArea = savedBounds && savedArea && intersectionArea(savedBounds, savedArea) > 0;
  const targetArea = hasVisibleSavedArea ? savedArea : primary;
  const source = hasVisibleSavedArea ? savedBounds : DEFAULT_DESKTOP_WINDOW_BOUNDS;
  const minimumWidth = Math.min(800, targetArea.width);
  const minimumHeight = Math.min(600, targetArea.height);
  const width = Math.min(targetArea.width, Math.max(minimumWidth, Math.round(source.width)));
  const height = Math.min(targetArea.height, Math.max(minimumHeight, Math.round(source.height)));
  const x = Math.min(targetArea.x + targetArea.width - width, Math.max(targetArea.x, Math.round(source.x)));
  const y = Math.min(targetArea.y + targetArea.height - height, Math.max(targetArea.y, Math.round(source.y)));

  return {
    bounds: { x, y, width, height },
    maximized: saved?.maximized === true,
  };
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
  const packagedRuntimeRoot = input.mode === "development" ? null : resolvePackagedRuntimeRoot(input.appRoot);

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
    PAPERCLIP_BUNDLED_PLUGINS_DIR: packagedRuntimeRoot
      ? path.resolve(packagedRuntimeRoot, "packages", "plugins")
      : undefined,
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

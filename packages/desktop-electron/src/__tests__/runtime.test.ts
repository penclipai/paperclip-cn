import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildWorkerEnvironment,
  getDesktopTitlebarThemeConfig,
  normalizeDesktopAppPath,
  readDesktopPreferences,
  readDesktopThemePreference,
  resolveDesktopPreferencesPath,
  resolveDesktopTheme,
  resolveDesktopWindowState,
  resolveServerEntrypoint,
  resolveDesktopUserDataDir,
  type DesktopRuntimeInput,
  writeDesktopPreferences,
  writeDesktopThemePreference,
} from "../runtime.js";

const ORIGINAL_ENV = { ...process.env };
const TEMP_DIRS: string[] = [];

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }

  for (const dir of TEMP_DIRS.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function buildInput(mode: DesktopRuntimeInput["mode"]): DesktopRuntimeInput {
  return {
    appRoot: "C:\\paperclip\\desktop-electron",
    repoRoot: "C:\\paperclip",
    userDataDir: "C:\\Users\\chenj\\AppData\\Roaming\\penclip",
    mode,
  };
}

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-desktop-runtime-"));
  TEMP_DIRS.push(dir);
  return dir;
}

describe("buildWorkerEnvironment", () => {
  it("forces packaged workers onto the bundled static UI", () => {
    process.env.SERVE_UI = "false";
    process.env.PAPERCLIP_UI_DEV_MIDDLEWARE = "true";
    process.env.PAPERCLIP_HOME = "C:\\legacy-paperclip-home";
    process.env.PAPERCLIP_CONFIG = "C:\\legacy\\config.json";
    process.env.PAPERCLIP_CONTEXT = "C:\\legacy\\context.json";
    process.env.PAPERCLIP_IN_WORKTREE = "true";
    process.env.PAPERCLIP_WORKTREE_NAME = "legacy-worktree";
    process.env.PORT = "3201";

    const env = buildWorkerEnvironment(buildInput("packaged"));

    expect(env.PAPERCLIP_DESKTOP_MODE).toBe("packaged");
    expect(env.PAPERCLIP_DESKTOP_SERVER_ENTRY).toBe(
      path.resolve(
        "C:\\paperclip\\desktop-electron",
        "..",
        "app-runtime",
        "server",
        "dist",
        "index.js",
      ),
    );
    expect(env.SERVE_UI).toBe("true");
    expect(env.PAPERCLIP_UI_DEV_MIDDLEWARE).toBe("false");
    expect(env.PAPERCLIP_HOME).toBe("C:\\legacy-paperclip-home");
    expect(env.PAPERCLIP_CONFIG).toBe(
      path.resolve("C:\\legacy-paperclip-home", "instances", "default", "config.json"),
    );
    expect(env.PAPERCLIP_CONTEXT).toBe(
      path.resolve("C:\\legacy-paperclip-home", "context.json"),
    );
    expect(env.PAPERCLIP_BUNDLED_PLUGINS_DIR).toBe(
      path.resolve(
        "C:\\paperclip\\desktop-electron",
        "..",
        "app-runtime",
        "packages",
        "plugins",
      ),
    );
    expect(env.PAPERCLIP_IN_WORKTREE).toBe("");
    expect(env.PAPERCLIP_WORKTREE_NAME).toBe("");
    expect(env.PORT).toBe("3201");
  });

  it("falls back to the legacy packaged server location when the split-shell layout is absent", () => {
    const baseDir = createTempDir();
    const appRoot = path.join(baseDir, "app");
    const legacyEntrypoint = path.join(
      baseDir,
      "app-runtime",
      "node_modules",
      "@penclipai",
      "server",
      "dist",
      "index.js",
    );

    fs.mkdirSync(appRoot, { recursive: true });
    fs.mkdirSync(path.dirname(legacyEntrypoint), { recursive: true });
    fs.writeFileSync(legacyEntrypoint, "", "utf8");

    expect(resolveServerEntrypoint({
      appRoot,
      repoRoot: "C:\\paperclip",
      userDataDir: "C:\\Users\\chenj\\AppData\\Roaming\\penclip",
      mode: "packaged",
    })).toBe(legacyEntrypoint);
  });

  it("keeps development workers on Vite middleware", () => {
    process.env.SERVE_UI = "false";
    process.env.PAPERCLIP_UI_DEV_MIDDLEWARE = "false";

    const env = buildWorkerEnvironment(buildInput("development"));

    expect(env.PAPERCLIP_DESKTOP_MODE).toBe("development");
    expect(env.PAPERCLIP_DESKTOP_SERVER_ENTRY).toBe(
      path.resolve("C:\\paperclip", "server", "src", "index.ts"),
    );
    expect(env.PAPERCLIP_UI_DEV_MIDDLEWARE).toBe("true");
    expect(env.SERVE_UI).toBe("false");
  });

  it("ignores deleted desktop smoke runtimes inherited through PAPERCLIP_* env", () => {
    process.env.PAPERCLIP_HOME = "C:\\Users\\chenj\\AppData\\Local\\Temp\\paperclip-desktop-smoke-dev-light-aur69x\\runtime";
    process.env.PAPERCLIP_CONTEXT = "C:\\Users\\chenj\\AppData\\Local\\Temp\\paperclip-desktop-smoke-dev-light-aur69x\\runtime\\context.json";
    process.env.PAPERCLIP_CONFIG = "D:\\penclipai\\paperclip\\.paperclip\\config.json";
    process.env.PAPERCLIP_IN_WORKTREE = "true";
    process.env.PAPERCLIP_WORKTREE_NAME = "stale-worktree";

    const env = buildWorkerEnvironment(buildInput("development"));

    expect(env.PAPERCLIP_HOME).toBe("C:\\Users\\chenj\\AppData\\Roaming\\penclip");
    expect(env.PAPERCLIP_CONTEXT).toBeUndefined();
    expect(env.PAPERCLIP_CONFIG).toBeUndefined();
    expect(env.PAPERCLIP_IN_WORKTREE).toBeUndefined();
    expect(env.PAPERCLIP_WORKTREE_NAME).toBeUndefined();
    expect(env.PAPERCLIP_UI_DEV_MIDDLEWARE).toBe("true");
  });

  it("preserves fresh desktop temp overrides for the current user-data dir", () => {
    const userDataDir = "C:\\Users\\chenj\\AppData\\Local\\Temp\\paperclip-desktop-acceptance-dark-12345";
    process.env.PAPERCLIP_HOME = path.resolve(userDataDir, "runtime");
    process.env.PAPERCLIP_CONTEXT = path.resolve(userDataDir, "runtime", "context.json");
    process.env.PAPERCLIP_CONFIG = path.resolve(userDataDir, "runtime", "config.json");

    const env = buildWorkerEnvironment({
      ...buildInput("development"),
      userDataDir,
    });

    expect(env.PAPERCLIP_HOME).toBe(path.resolve(userDataDir, "runtime"));
    expect(env.PAPERCLIP_CONTEXT).toBe(path.resolve(userDataDir, "runtime", "context.json"));
    expect(env.PAPERCLIP_CONFIG).toBe(path.resolve(userDataDir, "runtime", "config.json"));
  });

  it("uses a contrasting title bar icon filter in dark mode", () => {
    expect(getDesktopTitlebarThemeConfig("light").iconFilter).toBe("none");
    expect(getDesktopTitlebarThemeConfig("dark").iconFilter).toContain("invert(1)");
  });

  it("prefers the saved desktop theme over the system fallback", () => {
    const userDataDir = createTempDir();
    const preferencesPath = resolveDesktopPreferencesPath(userDataDir);

    writeDesktopThemePreference(preferencesPath, "light");

    expect(readDesktopThemePreference(preferencesPath)).toBe("light");
    expect(resolveDesktopTheme(userDataDir, true)).toBe("light");
  });

  it("falls back to the system theme when desktop preferences are missing or invalid", () => {
    const missingUserDataDir = createTempDir();
    expect(resolveDesktopTheme(missingUserDataDir, true)).toBe("dark");
    expect(resolveDesktopTheme(missingUserDataDir, false)).toBe("light");

    const invalidUserDataDir = createTempDir();
    fs.writeFileSync(resolveDesktopPreferencesPath(invalidUserDataDir), '{"theme":"sepia"}', "utf8");
    expect(readDesktopThemePreference(resolveDesktopPreferencesPath(invalidUserDataDir))).toBeNull();
    expect(resolveDesktopTheme(invalidUserDataDir, false)).toBe("light");
  });

  it("keeps valid defaults when the preference document is malformed", () => {
    const userDataDir = createTempDir();
    const preferencesPath = resolveDesktopPreferencesPath(userDataDir);
    fs.writeFileSync(preferencesPath, '{"theme":"dark","window":{"bounds":{"x":null}}}', "utf8");

    expect(readDesktopPreferences(preferencesPath)).toEqual({
      theme: "dark",
      closeToTray: true,
      notificationsEnabled: true,
    });
  });

  it("atomically merges known preference fields without overwriting theme or layout", () => {
    const userDataDir = createTempDir();
    const preferencesPath = resolveDesktopPreferencesPath(userDataDir);
    writeDesktopPreferences(preferencesPath, {
      theme: "dark",
      window: {
        bounds: { x: 20, y: 30, width: 1000, height: 700 },
        maximized: true,
        lastPath: "/companies/acme/issues/42?stale=query",
      },
    });

    const written = writeDesktopPreferences(preferencesPath, {
      closeToTray: false,
      notificationsEnabled: false,
    });

    expect(written).toMatchObject({
      theme: "dark",
      closeToTray: false,
      notificationsEnabled: false,
      window: {
        bounds: { x: 20, y: 30, width: 1000, height: 700 },
        maximized: true,
        lastPath: "/companies/acme/issues/42",
      },
    });
    expect(JSON.parse(fs.readFileSync(preferencesPath, "utf8"))).toEqual(written);
    expect(fs.readdirSync(userDataDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("retains the last valid preference file when atomic replacement is interrupted", () => {
    const userDataDir = createTempDir();
    const preferencesPath = resolveDesktopPreferencesPath(userDataDir);
    writeDesktopPreferences(preferencesPath, { theme: "light", closeToTray: false });
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("simulated interrupted rename");
    });

    expect(() => writeDesktopPreferences(preferencesPath, { theme: "dark" })).toThrow("simulated interrupted rename");
    expect(readDesktopPreferences(preferencesPath)).toMatchObject({ theme: "light", closeToTray: false });
    expect(fs.readdirSync(userDataDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    rename.mockRestore();
  });

  it("restores a visible, bounded window after monitors change", () => {
    expect(resolveDesktopWindowState({
      bounds: { x: 5000, y: 100, width: 1200, height: 900 },
      maximized: true,
    }, [{ x: 0, y: 0, width: 1024, height: 768 }], { x: 0, y: 0, width: 1024, height: 768 })).toEqual({
      bounds: { x: 0, y: 0, width: 1024, height: 768 },
      maximized: true,
    });

    expect(resolveDesktopWindowState(null, [{ x: 0, y: 0, width: 1600, height: 1000 }], {
      x: 0,
      y: 0,
      width: 1600,
      height: 1000,
    })).toEqual({
      bounds: { x: 0, y: 0, width: 1280, height: 800 },
      maximized: false,
    });

    expect(resolveDesktopWindowState({
      bounds: { x: 5000, y: 100, width: 1200, height: 900 },
      maximized: false,
    }, [
      { x: 4000, y: 0, width: 1000, height: 800 },
      { x: 0, y: 0, width: 1600, height: 1000 },
    ], { x: 0, y: 0, width: 1600, height: 1000 })).toEqual({
      bounds: { x: 0, y: 0, width: 1280, height: 800 },
      maximized: false,
    });
  });

  it("accepts only internal, non-sensitive desktop routes", () => {
    expect(normalizeDesktopAppPath("/companies/acme/issues/42?tab=activity#comment")).toBe(
      "/companies/acme/issues/42",
    );
    for (const candidate of [
      "https://example.test/",
      "//example.test/",
      "/api/companies",
      "/auth/callback",
      "/dot-connect/pairing-token",
      "/login",
      "/setup",
      "/invite/abc",
      "/invitations/abc",
      "/pairing/code",
      "/board-claim/secret",
      "/cli-auth/device",
      "/mcp-connect/service",
      "/oauth-handoff",
      "/companies/../secrets",
      "/companies%2fsecret",
      "\\\\server\\share",
      "/companies/acme\nissues",
    ]) {
      expect(normalizeDesktopAppPath(candidate)).toBeNull();
    }
  });

  it("allows tests to override the desktop user data directory", () => {
    process.env.PAPERCLIP_DESKTOP_USER_DATA_DIR = "C:\\temp\\paperclip-desktop-user-data";

    expect(resolveDesktopUserDataDir("C:\\Users\\chenj\\AppData\\Roaming\\Paperclip CN")).toBe(
      path.resolve("C:\\temp\\paperclip-desktop-user-data"),
    );
  });

  it("uses the penclip data directory even when the Electron default includes the branded name", () => {
    expect(resolveDesktopUserDataDir("C:\\Users\\chenj\\AppData\\Roaming\\Paperclip CN")).toBe(
      "C:\\Users\\chenj\\AppData\\Roaming\\penclip",
    );
  });
});

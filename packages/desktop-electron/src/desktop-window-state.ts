import type { BrowserWindow } from "electron";
import {
  normalizeDesktopAppPath,
  readDesktopPreferences,
  writeDesktopPreferences,
  type DesktopWindowBounds,
} from "./runtime.js";

/** Persists only trusted local window geometry and internal app routes. */
export class DesktopWindowState {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly preferencesPath: string) {}

  restoreBounds(
    win: Pick<BrowserWindow, "getBounds" | "setBounds">,
    desired: DesktopWindowBounds,
    platform: NodeJS.Platform = process.platform,
  ): void {
    if (platform !== "win32") return;
    // Fractional Windows DPI can make constructor and setBounds rectangles
    // round differently. Measure the native result rather than applying a
    // fixed scale offset. Native minimum sizes may make exact recovery
    // impossible, so stop when constrained or after four synchronous attempts.
    const keys = ["x", "y", "width", "height"] as const;
    let requested = { ...desired };
    let previous: DesktopWindowBounds | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      win.setBounds(requested);
      const actual = win.getBounds();
      if (keys.every((key) => actual[key] === desired[key])) return;
      const prior = previous;
      if (prior && keys.every((key) => actual[key] === prior[key])) return;
      previous = actual;
      requested = {
        x: requested.x + desired.x - actual.x,
        y: requested.y + desired.y - actual.y,
        width: Math.max(1, requested.width + desired.width - actual.width),
        height: Math.max(1, requested.height + desired.height - actual.height),
      };
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  save(win: BrowserWindow): void {
    if (win.isDestroyed()) return;
    try {
      const current = readDesktopPreferences(this.preferencesPath);
      writeDesktopPreferences(this.preferencesPath, {
        window: {
          bounds: win.getNormalBounds(),
          maximized: win.isMaximized(),
          lastPath: current.window?.lastPath,
        },
      });
    } catch (error) {
      console.warn("[desktop-main] Failed to save window state:", error);
    }
  }

  scheduleSave(win: BrowserWindow): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.save(win);
    }, 300);
  }

  rememberPath(win: BrowserWindow, appUrl: string | null): void {
    if (!appUrl) return;
    try {
      const url = new URL(win.webContents.getURL());
      if (url.origin !== new URL(appUrl).origin) return;
      const lastPath = normalizeDesktopAppPath(url.pathname);
      if (!lastPath) return;
      writeDesktopPreferences(this.preferencesPath, {
        window: { bounds: win.getNormalBounds(), maximized: win.isMaximized(), lastPath },
      });
    } catch {
      // Splash, navigation, and teardown URLs are not restorable state.
    }
  }
}

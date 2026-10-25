import { afterEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
}));
const renderer = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: bridge,
  ipcRenderer: renderer,
}));

vi.mock("custom-electron-titlebar", () => ({
  createTitlebar: vi.fn(),
  createTitlebarOnDOMContentLoaded: vi.fn(),
  TitlebarColor: {},
}));

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;

afterEach(() => {
  vi.resetModules();
  bridge.exposeInMainWorld.mockReset();
  renderer.invoke.mockReset();
  renderer.on.mockReset();
  renderer.removeListener.mockReset();
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
});

describe("desktop preload bootstrap", () => {
  it("exposes the desktop bridge before documentElement is available", async () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        readyState: "loading",
        documentElement: null,
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        addEventListener: vi.fn(),
      },
    });

    await import("../preload.js");

    expect(bridge.exposeInMainWorld).toHaveBeenCalledWith(
      "desktopShell",
      expect.objectContaining({
        isDesktop: true,
        setTheme: expect.any(Function),
        titlebarHeight: 42,
      }),
    );
  });

  it("keeps the initial titlebar tokens when documentElement is available", async () => {
    const setProperty = vi.fn();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        readyState: "loading",
        documentElement: { style: { setProperty } },
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        addEventListener: vi.fn(),
      },
    });

    await import("../preload.js");

    expect(setProperty).toHaveBeenCalledWith("--paperclip-desktop-titlebar-height", "42px");
    expect(setProperty).toHaveBeenCalledWith("--paperclip-available-height", "calc(100vh - 42px)");
  });

  it("uses fixed IPC channels and unsubscribes navigation callbacks", async () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { readyState: "loading", documentElement: null },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { addEventListener: vi.fn() },
    });
    renderer.invoke.mockResolvedValue(true);

    await import("../preload.js");
    const desktopShell = bridge.exposeInMainWorld.mock.calls.at(-1)?.[1] as {
      getPreferences(): Promise<unknown>;
      setPreferences(value: unknown): Promise<unknown>;
      setContext(value: unknown): Promise<unknown>;
      notify(value: unknown): Promise<unknown>;
      quit(): Promise<unknown>;
      onNavigate(callback: (path: string) => void): () => void;
    };

    await desktopShell.getPreferences();
    await desktopShell.setPreferences({ closeToTray: false });
    await desktopShell.setContext({ locale: "zh-CN", companyId: "acme", activeRuns: 2 });
    await desktopShell.notify({
      id: "evt-1",
      companyId: "acme",
      kind: "approval",
      targetPath: "/companies/acme/issues/1",
    });
    await desktopShell.quit();
    const callback = vi.fn();
    const unsubscribe = desktopShell.onNavigate(callback);
    const listener = renderer.on.mock.calls.find(([channel]) => channel === "desktop-shell:navigate")?.[1];
    listener({}, "/companies/acme/issues/1");
    unsubscribe();

    expect(renderer.invoke.mock.calls.map(([channel]) => channel)).toEqual([
      "desktop-shell:get-preferences",
      "desktop-shell:set-preferences",
      "desktop-shell:set-context",
      "desktop-shell:notify",
      "desktop-shell:quit",
    ]);
    expect(callback).toHaveBeenCalledWith("/companies/acme/issues/1");
    expect(renderer.removeListener).toHaveBeenCalledWith("desktop-shell:navigate", listener);
  });
});

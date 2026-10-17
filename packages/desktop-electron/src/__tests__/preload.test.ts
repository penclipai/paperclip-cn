import { afterEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: bridge,
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
  },
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
});

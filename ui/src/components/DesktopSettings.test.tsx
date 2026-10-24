// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ translateInstant: (key: string) => key }));

import { DesktopSettings } from "./DesktopSettings";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DesktopSettings", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    window.desktopShell = undefined;
    vi.clearAllMocks();
  });

  async function render() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root!.render(<DesktopSettings />));
    await act(async () => Promise.resolve());
  }

  it("does not render in the web app", async () => {
    await render();
    expect(container?.textContent).toBe("");
  });

  it("restores the saved value and reports a failed preference update", async () => {
    const setPreferences = vi.fn().mockRejectedValue(new Error("offline"));
    window.desktopShell = {
      isDesktop: true,
      getPreferences: vi.fn().mockResolvedValue({
        closeToTray: true,
        notificationsEnabled: true,
        trayAvailable: true,
        notificationsSupported: true,
      }),
      setPreferences,
    } as unknown as typeof window.desktopShell;
    await render();
    const toggle = container?.querySelector<HTMLButtonElement>('[aria-label="desktopSettings.closeToTray"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle?.click());
    await act(async () => Promise.resolve());
    expect(setPreferences).toHaveBeenCalledWith({ closeToTray: false });
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(container?.textContent).toContain("desktopSettings.saveFailed");
  });
});

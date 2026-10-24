import { describe, expect, it, vi } from "vitest";
import { DesktopWindowState } from "../desktop-window-state.js";
import type { DesktopWindowBounds } from "../runtime.js";

type BoundsWindow = {
  getBounds: ReturnType<typeof vi.fn>;
  setBounds: ReturnType<typeof vi.fn>;
};

function restore(
  desired: DesktopWindowBounds,
  actuals: DesktopWindowBounds[],
  platform: NodeJS.Platform = "win32",
): BoundsWindow {
  let index = 0;
  const win: BoundsWindow = {
    setBounds: vi.fn(),
    getBounds: vi.fn(() => actuals[Math.min(index++, actuals.length - 1)]!),
  };
  new DesktopWindowState("unused").restoreBounds(
    win as unknown as Pick<import("electron").BrowserWindow, "getBounds" | "setBounds">,
    desired,
    platform,
  );
  return win;
}

describe("DesktopWindowState.restoreBounds", () => {
  const desired = { x: 50, y: 60, width: 961, height: 682 };

  it("corrects observed Windows DPI rounding in two position-and-size-aware passes", () => {
    const win = restore(desired, [
      { x: 51, y: 62, width: 962, height: 684 },
      desired,
    ]);

    expect(win.setBounds).toHaveBeenCalledTimes(2);
    expect(win.setBounds).toHaveBeenNthCalledWith(1, desired);
    expect(win.setBounds).toHaveBeenNthCalledWith(2, { x: 49, y: 58, width: 960, height: 680 });
  });

  it("does not retain correction state between fresh windows", () => {
    const first = restore(desired, [{ x: 51, y: 62, width: 962, height: 684 }, desired]);
    const second = restore(desired, [{ x: 51, y: 62, width: 962, height: 684 }, desired]);

    expect(first.setBounds).toHaveBeenNthCalledWith(1, desired);
    expect(second.setBounds).toHaveBeenNthCalledWith(1, desired);
    expect(first.setBounds).toHaveBeenCalledTimes(2);
    expect(second.setBounds).toHaveBeenCalledTimes(2);
  });

  it("stops after two attempts when a native minimum-size constraint makes no progress", () => {
    const constrained = { x: 0, y: 0, width: 800, height: 600 };
    const win = restore({ x: 0, y: 0, width: 640, height: 480 }, [constrained, constrained]);

    expect(win.setBounds).toHaveBeenCalledTimes(2);
  });

  it("stops after one attempt when the native rectangle is exact", () => {
    const win = restore(desired, [desired]);

    expect(win.setBounds).toHaveBeenCalledTimes(1);
  });

  it("does not attempt Windows correction on other platforms", () => {
    const win = restore(desired, [desired], "darwin");

    expect(win.setBounds).not.toHaveBeenCalled();
    expect(win.getBounds).not.toHaveBeenCalled();
  });

  it("caps a changing nonconvergent native result at four attempts", () => {
    const win = restore(desired, [
      { x: 51, y: 61, width: 962, height: 683 },
      { x: 52, y: 62, width: 963, height: 684 },
      { x: 53, y: 63, width: 964, height: 685 },
      { x: 54, y: 64, width: 965, height: 686 },
    ]);

    expect(win.setBounds).toHaveBeenCalledTimes(4);
  });
});

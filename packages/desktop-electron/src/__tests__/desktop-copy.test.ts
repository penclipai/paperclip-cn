import { describe, expect, it } from "vitest";
import { desktopText } from "../desktop-copy.js";

describe("native desktop messages", () => {
  it("uses the reviewed Chinese catalog and falls back to English for other locales", () => {
    expect(desktopText("desktop.tray.open", "zh-CN")).toBe("打开 Paperclip CN");
    expect(desktopText("desktop.tray.open", "zh-TW")).toBe("打开 Paperclip CN");
    expect(desktopText("desktop.tray.open", "fr-FR")).toBe("Open Paperclip CN");
  });

  it("formats counts without treating replacement strings as regular expressions", () => {
    expect(desktopText("desktop.quit.runningDetail", "en", { count: 3 }))
      .toContain("At least 3 task(s)");
    expect(desktopText("desktop.quit.runningDetail", "zh-CN", { count: "$&" }))
      .toContain("$& 个任务");
    expect(desktopText("desktop.unknown", "en")).toBe("desktop.unknown");
  });
});

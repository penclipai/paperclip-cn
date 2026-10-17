import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { taskDateGroup, taskDateGroupSeparator } from "./task-date-groups";

describe("task date groups", () => {
  const now = new Date(2026, 7, 31, 9, 30);

  it("uses local calendar boundaries instead of rolling 24-hour windows", () => {
    expect(taskDateGroup(new Date(2026, 7, 31, 0, 1), now)).toBe("today");
    expect(taskDateGroup(new Date(2026, 7, 30, 23, 59), now)).toBe("yesterday");
    expect(taskDateGroup(new Date(2026, 7, 29, 23, 59), now)).toBe("earlier");
  });

  it("does not emit duplicate or leading Earlier separators", async () => {
    await i18n.changeLanguage("en");
    expect(taskDateGroupSeparator(null, "earlier")).toBeNull();
    expect(taskDateGroupSeparator(null, "today")).toBe("Today");
    expect(taskDateGroupSeparator("today", "today")).toBeNull();
    expect(taskDateGroupSeparator("today", "yesterday")).toBe("Yesterday");
    expect(taskDateGroupSeparator("yesterday", "earlier")).toBe("Earlier");
  });

  it("uses the active locale for visible separators while preserving group IDs", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(taskDateGroup(new Date(2026, 7, 31, 0, 1), now)).toBe("today");
    expect(taskDateGroupSeparator(null, "today")).toBe("今天");
    expect(taskDateGroupSeparator("today", "yesterday")).toBe("昨天");
    await i18n.changeLanguage("en");
  });
});

import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { translateEntityTypeLabel, translateStatusLabel } from "./i18n-labels";

function testTranslator(translations: Record<string, string>): TFunction {
  return ((key: string, options?: { defaultValue?: string }) =>
    translations[key] ?? options?.defaultValue ?? key) as TFunction;
}

describe("translateStatusLabel", () => {
  it("localizes goal statuses through shared status keys", () => {
    const t = testTranslator({
      "status.planned": "已规划",
      "status.achieved": "已达成",
      "status.invalidOrgChain": "报告链无效",
      "status.suspended": "已暂停",
    });

    expect(translateStatusLabel(t, "planned")).toBe("已规划");
    expect(translateStatusLabel(t, "achieved")).toBe("已达成");
    expect(translateStatusLabel(t, "invalid_org_chain")).toBe("报告链无效");
    expect(translateStatusLabel(t, "suspended")).toBe("已暂停");
  });
});

describe("translateEntityTypeLabel", () => {
  it("localizes the application-owned plugin entity type while preserving unknown technical values", () => {
    const t = testTranslator({ "entityType.plugin": "插件" });

    expect(translateEntityTypeLabel(t, "plugin")).toBe("插件");
    expect(translateEntityTypeLabel(t, "plugin:@penclipai/example")).toBe("plugin:@penclipai/example");
  });
});

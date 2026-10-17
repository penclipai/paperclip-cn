import i18next from "i18next";
import { describe, expect, it } from "vitest";
import en from "../../public/locales/en/common.json";
import zhCN from "../../public/locales/zh-CN/common.json";

async function translator(language: "en" | "zh-CN") {
  const instance = i18next.createInstance();
  await instance.init({
    lng: language,
    fallbackLng: "en",
    defaultNS: "common",
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    resources: { en: { common: en }, "zh-CN": { common: zhCN } },
  });
  return instance;
}

describe("DecisionsToolbar decision count", () => {
  it("selects the runtime plural form for zero, one, and many in English and zh-CN", async () => {
    const english = await translator("en");
    expect(english.t("whatNeedsMe.decisionCount", { count: 0 })).toBe("0 decisions");
    expect(english.t("whatNeedsMe.decisionCount", { count: 1 })).toBe("1 decision");
    expect(english.t("whatNeedsMe.decisionCount", { count: 2 })).toBe("2 decisions");

    const chinese = await translator("zh-CN");
    expect(chinese.t("whatNeedsMe.decisionCount", { count: 0 })).toBe("0 条决策");
    expect(chinese.t("whatNeedsMe.decisionCount", { count: 1 })).toBe("1 条决策");
    expect(chinese.t("whatNeedsMe.decisionCount", { count: 2 })).toBe("2 条决策");
  });
});

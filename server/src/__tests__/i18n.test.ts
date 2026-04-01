import { describe, expect, it } from "vitest";
import { DEFAULT_UI_LOCALE, normalizeUiLocale } from "@penclipai/shared";
import { resolveRequestLocale, translate } from "../i18n.js";

describe("request locale resolution", () => {
  it("normalizes supported UI locales", () => {
    expect(normalizeUiLocale("en-US")).toBe("en");
    expect(normalizeUiLocale("zh-TW")).toBe("zh-CN");
  });

  it("falls back when normalizing unsupported locales directly", () => {
    expect(normalizeUiLocale("fr-FR")).toBe(DEFAULT_UI_LOCALE);
  });

  it("skips unsupported Accept-Language entries before falling back", () => {
    expect(resolveRequestLocale("fr-FR,en-US;q=0.9")).toBe("en");
  });

  it("prefers the supported locale with the highest quality weight", () => {
    expect(resolveRequestLocale("en;q=0.1,zh-CN;q=0.9")).toBe("zh-CN");
  });

  it("skips zero-quality locale candidates", () => {
    expect(resolveRequestLocale("en;q=0,zh-CN;q=1")).toBe("zh-CN");
  });

  it("falls back only after exhausting all header candidates", () => {
    expect(resolveRequestLocale("fr-FR,de-DE;q=0.9")).toBe(
      DEFAULT_UI_LOCALE,
    );
  });

  it("translates restore document errors from the shared locale bundles", () => {
    expect(translate("zh-CN", "Document revision not found")).toBe("未找到文档修订版本");
    expect(translate("zh-CN", "Selected revision is already the latest revision")).toBe("所选修订版本已经是最新版本");
    expect(translate("zh-CN", "Document was updated by someone else")).toBe("文档已被其他人更新");
    expect(translate("en", "Document revision not found")).toBe("Document revision not found");
  });
});

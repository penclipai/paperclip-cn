import { describe, expect, it } from "vitest";
import { DEFAULT_UI_LOCALE, normalizeUiLocale } from "@penclipai/shared";
import { resolveRequestLocale } from "../i18n.js";

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
});

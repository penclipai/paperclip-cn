import { describe, expect, it } from "vitest";
import { DEFAULT_UI_LOCALE } from "@paperclipai/shared";
import { applyUiLocaleToHtml, resolveInitialUiLocale } from "../ui-locale.js";

describe("UI locale helpers", () => {
  it("lets the querystring override the request locale", () => {
    expect(resolveInitialUiLocale("zh-CN", "en-US")).toEqual({
      locale: "en",
      source: "query",
    });
  });

  it("falls back to the request locale when the querystring is unsupported", () => {
    expect(resolveInitialUiLocale("en", "fr-FR")).toEqual({
      locale: "en",
      source: "request",
    });
  });

  it("falls back to the default locale when no supported signal exists", () => {
    expect(resolveInitialUiLocale(undefined, undefined)).toEqual({
      locale: DEFAULT_UI_LOCALE,
      source: "default",
    });
  });

  it("rewrites the html locale attributes", () => {
    expect(applyUiLocaleToHtml('<html lang="zh-CN" class="dark">', {
      locale: "en",
      source: "request",
    })).toBe(
      '<html data-ui-locale-source="request" lang="en" class="dark">',
    );
  });
});

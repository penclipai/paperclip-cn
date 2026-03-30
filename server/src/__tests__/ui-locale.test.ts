import { describe, expect, it } from "vitest";
import { DEFAULT_UI_LOCALE } from "@penclipai/shared";
import {
  applyUiLocaleToHtml,
  resolveExplicitRequestUiLocale,
  resolveInitialUiLocale,
} from "../ui-locale.js";

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

  it("extracts an explicit supported locale from Accept-Language without fallback", () => {
    expect(
      resolveExplicitRequestUiLocale({
        get: () => "fr-FR,en-US;q=0.9",
        query: {},
      }),
    ).toBe("en");
  });

  it("returns null when the request does not explicitly ask for a supported locale", () => {
    expect(
      resolveExplicitRequestUiLocale({
        get: () => "fr-FR,de-DE;q=0.9",
        query: {},
      }),
    ).toBeNull();
    expect(
      resolveExplicitRequestUiLocale({
        get: () => undefined,
        query: {},
      }),
    ).toBeNull();
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

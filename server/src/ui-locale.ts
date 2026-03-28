import {
  DEFAULT_UI_LOCALE,
  resolveUiLocaleFromHeader,
  type UiLocale,
} from "@paperclipai/shared";

export type InitialUiLocaleSource = "query" | "request" | "default";

export type InitialUiLocale = {
  locale: UiLocale;
  source: InitialUiLocaleSource;
};

function parseSupportedUiLocale(value: string): UiLocale | null {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("en")) return "en";
  return null;
}

function parseQueryLocale(value: unknown): UiLocale | null {
  if (Array.isArray(value)) {
    return parseQueryLocale(value[0]);
  }
  if (typeof value !== "string") return null;
  return parseSupportedUiLocale(value);
}

export function resolveInitialUiLocale(
  acceptLanguageHeader: string | undefined,
  queryLng: unknown,
): InitialUiLocale {
  const queryLocale = parseQueryLocale(queryLng);
  if (queryLocale) {
    return { locale: queryLocale, source: "query" };
  }

  if (typeof acceptLanguageHeader === "string" && acceptLanguageHeader.trim().length > 0) {
    return {
      locale: resolveUiLocaleFromHeader(acceptLanguageHeader),
      source: "request",
    };
  }

  return {
    locale: DEFAULT_UI_LOCALE,
    source: "default",
  };
}

function setHtmlAttribute(html: string, attribute: string, value: string): string {
  const escapedAttribute = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attributePattern = new RegExp(
    `<html\\b([^>]*?)\\b${escapedAttribute}="[^"]*"(.*?)>`,
    "i",
  );

  if (attributePattern.test(html)) {
    return html.replace(
      attributePattern,
      `<html$1${attribute}="${value}"$2>`,
    );
  }

  return html.replace(/<html\b([^>]*)>/i, `<html ${attribute}="${value}"$1>`);
}

export function applyUiLocaleToHtml(html: string, initialLocale: InitialUiLocale): string {
  return setHtmlAttribute(
    setHtmlAttribute(html, "lang", initialLocale.locale),
    "data-ui-locale-source",
    initialLocale.source,
  );
}

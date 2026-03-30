import type { Request } from "express";
import {
  DEFAULT_UI_LOCALE,
  resolveUiLocaleFromHeader,
  type UiLocale,
} from "@penclipai/shared";

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

function parseAcceptLanguageQuality(parameterSegments: string[]): number {
  const qualityToken = parameterSegments
    .map((segment) => segment.trim())
    .find((segment) => segment.toLowerCase().startsWith("q="));
  if (!qualityToken) return 1;

  const quality = Number(qualityToken.slice(2));
  if (!Number.isFinite(quality)) return 0;
  return Math.min(1, Math.max(0, quality));
}

function resolveExplicitUiLocaleFromHeader(headerValue: string | null | undefined): UiLocale | null {
  if (!headerValue) return null;

  const candidates = headerValue
    .split(",")
    .map((segment, index) => {
      const [localeSegment, ...parameterSegments] = segment.split(";");
      return {
        locale: parseSupportedUiLocale(localeSegment),
        quality: parseAcceptLanguageQuality(parameterSegments),
        index,
      };
    })
    .filter(
      (candidate): candidate is { locale: UiLocale; quality: number; index: number } =>
        candidate.locale !== null && candidate.quality > 0,
    )
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  return candidates[0]?.locale ?? null;
}

export function resolveExplicitRequestUiLocale(
  req: Pick<Request, "get" | "query">,
): UiLocale | null {
  const queryLocale = parseQueryLocale(req.query?.lng);
  if (queryLocale) return queryLocale;
  return resolveExplicitUiLocaleFromHeader(req.get("Accept-Language"));
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

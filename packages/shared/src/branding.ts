export const SUPPORTED_UI_LOCALES = ["zh-CN", "en"] as const;

export type UiLocale = (typeof SUPPORTED_UI_LOCALES)[number];

export const DEFAULT_UI_LOCALE: UiLocale = "zh-CN";

export const BRANDING = {
  productName: "Penclip",
  legacyProductName: "Paperclip",
  organizationName: "penclipai",
  repositoryUrl: "https://github.com/penclipai/paperclip",
  websiteUrl: "https://penclip.ing",
  docsUrl: "https://penclip.ing/docs",
  chinaWebsiteUrl: "https://paperclipai.cn",
} as const;

function parseSupportedUiLocale(value: string | null | undefined): UiLocale | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("en")) return "en";
  return null;
}

export function normalizeUiLocale(value: string | null | undefined): UiLocale {
  return parseSupportedUiLocale(value) ?? DEFAULT_UI_LOCALE;
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

export function resolveUiLocaleFromHeader(headerValue: string | null | undefined): UiLocale {
  if (!headerValue) return DEFAULT_UI_LOCALE;

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

  return candidates[0]?.locale ?? DEFAULT_UI_LOCALE;
}

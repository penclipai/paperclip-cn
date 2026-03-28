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

export function resolveUiLocaleFromHeader(headerValue: string | null | undefined): UiLocale {
  if (!headerValue) return DEFAULT_UI_LOCALE;

  const candidates = headerValue
    .split(",")
    .map((segment) => segment.split(";")[0]?.trim())
    .filter((segment): segment is string => Boolean(segment));

  for (const candidate of candidates) {
    const locale = parseSupportedUiLocale(candidate);
    if (locale && SUPPORTED_UI_LOCALES.includes(locale)) return locale;
  }

  return DEFAULT_UI_LOCALE;
}

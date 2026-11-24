import i18n, { type TOptions } from "i18next";
import Backend from "i18next-http-backend";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { useTranslation as useReactI18nextTranslation } from "react-i18next";
import {
  DEFAULT_UI_LOCALE,
  normalizeUiLocale,
  type UiLocale,
  SUPPORTED_UI_LOCALES,
} from "@penclipai/shared";
import { convertDetectedUiLocale } from "./lib/locale-detection";
import { i18nextResources } from "./i18n/locales";

export const LOCALE_STORAGE_KEY = "paperclip.locale";

function resolveDetectionOrder() {
  if (typeof document === "undefined") {
    return ["querystring", "localStorage", "htmlTag"] as const;
  }

  return document.documentElement.dataset.uiLocaleSource === "request"
    ? ["querystring", "localStorage", "htmlTag", "navigator"] as const
    : ["querystring", "localStorage", "htmlTag"] as const;
}

function applyDocumentLanguage(language: string) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = normalizeUiLocale(language);
}

if (!i18n.isInitialized) {
  void i18n
    .use(Backend)
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      fallbackLng: DEFAULT_UI_LOCALE,
      supportedLngs: [...SUPPORTED_UI_LOCALES],
      load: "currentOnly",
      defaultNS: "common",
      ns: ["common"],
      keySeparator: false,
      nsSeparator: false,
      returnNull: false,
      interpolation: {
        escapeValue: false,
      },
      backend: {
        loadPath: "/locales/{{lng}}/common.json",
      },
      detection: {
        order: [...resolveDetectionOrder()],
        caches: ["localStorage"],
        lookupLocalStorage: LOCALE_STORAGE_KEY,
        convertDetectedLanguage: convertDetectedUiLocale,
      },
    });
}

// Upstream owns a small set of startup-copy resources under `src/i18n/`.
// Keep them in their own namespace so they augment, rather than reinitialize
// or replace, the CN fork's server-loaded `common` catalog.
for (const [locale, resources] of Object.entries(i18nextResources)) {
  const translation = resources?.translation;
  if (translation && typeof translation === "object") {
    i18n.addResourceBundle(locale, "translation", translation, true, true);
  }
}

applyDocumentLanguage(i18n.resolvedLanguage ?? i18n.language);
i18n.on("languageChanged", applyDocumentLanguage);

export function getCurrentLocale(): UiLocale {
  return normalizeUiLocale(i18n.resolvedLanguage ?? i18n.language);
}

export function translateInstant(
  key: string,
  options?: Record<string, string | number | boolean | null | undefined>,
): string {
  return i18n.t(key, options);
}

/** Compatibility surface for upstream imports from `@/i18n`. */
export function t(key: string, options: TOptions = {}): string {
  return i18n.t(key, { ns: "translation", keySeparator: ".", ...options });
}

export const useTranslation = useReactI18nextTranslation;
export { i18n };

export default i18n;

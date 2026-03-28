import i18n from "i18next";
import Backend from "i18next-http-backend";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import {
  SUPPORTED_UI_LOCALES,
  normalizeUiLocale,
  type UiLocale,
} from "@paperclipai/shared";

export const LOCALE_STORAGE_KEY = "paperclip.locale";

function applyDocumentLanguage(language: string) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = normalizeUiLocale(language);
}

void i18n
  .use(Backend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "en",
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
      order: ["querystring", "localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"],
      lookupLocalStorage: LOCALE_STORAGE_KEY,
      convertDetectedLanguage: (value: string) => normalizeUiLocale(value),
    },
  });

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

export default i18n;

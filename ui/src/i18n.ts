import i18n from "i18next";
import Backend from "i18next-http-backend";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import {
  DEFAULT_UI_LOCALE,
  normalizeUiLocale,
  type UiLocale,
  SUPPORTED_UI_LOCALES,
} from "@penclipai/shared";
import { convertDetectedUiLocale } from "./lib/locale-detection";

export const LOCALE_STORAGE_KEY = "paperclip.locale";

function resolveDetectionOrder() {
  if (typeof document === "undefined") {
    return ["querystring", "localStorage", "navigator", "htmlTag"] as const;
  }

  return document.documentElement.dataset.uiLocaleSource === "request"
    ? ["querystring", "localStorage", "htmlTag", "navigator"] as const
    : ["querystring", "localStorage", "navigator", "htmlTag"] as const;
}

function applyDocumentLanguage(language: string) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = normalizeUiLocale(language);
}

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

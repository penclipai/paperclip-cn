import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_UI_LOCALE,
  resolveUiLocaleFromHeader,
  type UiLocale,
} from "@penclipai/shared";

type TranslationParams = Record<string, string | number | boolean | null | undefined>;
type TranslationDictionary = Record<string, string>;
type TranslationBundles = Record<UiLocale, TranslationDictionary>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function localeRoots(): string[] {
  return [
    path.resolve(__dirname, "../ui-dist/locales"),
    path.resolve(__dirname, "../../ui/public/locales"),
    path.resolve(__dirname, "../../ui/dist/locales"),
  ];
}

function readLocaleFile(root: string, locale: UiLocale): TranslationDictionary {
  const filePath = path.join(root, locale, "common.json");
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as TranslationDictionary;
}

function loadBundles(): TranslationBundles {
  const root = localeRoots().find((candidate) => fs.existsSync(path.join(candidate, DEFAULT_UI_LOCALE, "common.json")));
  if (!root) {
    return {
      "zh-CN": {},
      en: {},
    };
  }

  return {
    "zh-CN": readLocaleFile(root, "zh-CN"),
    en: readLocaleFile(root, "en"),
  };
}

const cachedBundles = process.env.NODE_ENV === "production" ? loadBundles() : null;

function getBundles(): TranslationBundles {
  return cachedBundles ?? loadBundles();
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, key) => {
    const value = params[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

export function resolveRequestLocale(acceptLanguageHeader: string | undefined): UiLocale {
  return resolveUiLocaleFromHeader(acceptLanguageHeader);
}

export function translate(
  locale: UiLocale,
  key: string,
  params?: TranslationParams,
): string {
  const bundles = getBundles();
  const translated = bundles[locale]?.[key] ?? bundles.en[key] ?? key;
  return interpolate(translated, params);
}

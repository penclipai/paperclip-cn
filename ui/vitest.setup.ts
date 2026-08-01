import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { beforeEach } from "vitest";

import { SUPPORTED_UI_LOCALES } from "@penclipai/shared";

import enCommon from "./public/locales/en/common.json";
import zhCnCommon from "./public/locales/zh-CN/common.json";

const storageEntries = new Map<string, string>();

function installStorageMock(target: Record<string, unknown>) {
  Object.defineProperty(target, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storageEntries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storageEntries.set(key, String(value));
      },
      removeItem: (key: string) => {
        storageEntries.delete(key);
      },
      clear: () => {
        storageEntries.clear();
      },
    },
  });
}

if (
  typeof globalThis.localStorage?.getItem !== "function"
  || typeof globalThis.localStorage?.setItem !== "function"
  || typeof globalThis.localStorage?.removeItem !== "function"
  || typeof globalThis.localStorage?.clear !== "function"
) {
  installStorageMock(globalThis);
}

if (typeof window !== "undefined" && window.localStorage !== globalThis.localStorage) {
  installStorageMock(window as unknown as Record<string, unknown>);
}

// jsdom does not implement Element.prototype.scrollIntoView. Several surfaces
// (e.g. IssueChatThread's auto-scroll-to-latest) call it during normal render,
// so provide a no-op default. Tests that assert on scroll behaviour override
// this on the prototype themselves and restore it afterwards.
if (typeof Element !== "undefined" && typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

if (!i18n.isInitialized) {
  await i18n.use(initReactI18next).init({
    resources: {
      en: { common: enCommon },
      "zh-CN": { common: zhCnCommon },
    },
    lng: "en",
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_UI_LOCALES],
    load: "currentOnly",
    defaultNS: "common",
    ns: ["common"],
    keySeparator: false,
    nsSeparator: false,
    returnNull: false,
    initImmediate: false,
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });
} else {
  i18n.options.react = {
    ...(i18n.options.react ?? {}),
    useSuspense: false,
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

import enCommon from "../../public/locales/en/common.json";
import zhCnCommon from "../../public/locales/zh-CN/common.json";

type TranslationOptions = Record<string, unknown> & { defaultValue?: string };

const catalogs: Record<string, Record<string, string>> = {
  en: enCommon,
  "zh-CN": zhCnCommon,
};

function interpolate(template: string, options?: TranslationOptions) {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, token: string) =>
    String(options?.[token] ?? ""),
  );
}

export function translateForTest(
  key: string,
  options?: TranslationOptions,
  language = "en",
  overrides: Record<string, string> = {},
) {
  const catalog = catalogs[language] ?? catalogs.en;
  const template =
    overrides[key] ??
    catalog[key] ??
    (typeof options?.defaultValue === "string" ? options.defaultValue : key);
  return interpolate(template, options);
}

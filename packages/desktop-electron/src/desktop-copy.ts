import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DesktopNotificationKind } from "./desktop-experience.js";

type DesktopLocales = Record<string, Record<string, string>>;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
let cachedLocales: DesktopLocales | undefined;

function readLocales(): DesktopLocales {
  if (cachedLocales) return cachedLocales;
  try {
    cachedLocales = JSON.parse(fs.readFileSync(path.join(moduleDir, "desktop-locales.json"), "utf8"));
  } catch {
    // Unit tests and source execution share the generated UI catalog. Packaged
    // builds always carry the narrow desktop-locales.json asset beside main.js.
    const localesRoot = path.resolve(moduleDir, "../../../ui/public/locales");
    cachedLocales = Object.fromEntries(["en", "zh-CN"].map((locale) => [locale,
      JSON.parse(fs.readFileSync(path.join(localesRoot, locale, "common.json"), "utf8")),
    ]));
  }
  return cachedLocales!;
}

export function desktopText(
  key: string,
  locale: string,
  values: Record<string, string | number> = {},
): string {
  const locales = readLocales();
  const language = locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  const template = locales[language]?.[key] ?? locales.en?.[key] ?? key;
  return template.replace(/{{\s*(\w+)\s*}}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder);
}

export function desktopNotificationCopy(kind: DesktopNotificationKind, locale: string) {
  const stem = { approval: "approval", run_failed: "runFailed", run_timed_out: "runTimedOut" }[kind];
  return {
    title: desktopText(`desktop.notification.${stem}Title`, locale),
    body: desktopText(`desktop.notification.${stem}Body`, locale),
  };
}

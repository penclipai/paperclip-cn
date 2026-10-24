import fs from "node:fs";
import path from "node:path";

/** Package the same reviewed messages the renderer uses, without the full UI catalog. */
export function collectDesktopLocales(repoRoot) {
  const locales = {};
  for (const locale of ["en", "zh-CN"]) {
    const source = JSON.parse(fs.readFileSync(
      path.join(repoRoot, "ui", "public", "locales", locale, "common.json"), "utf8",
    ));
    locales[locale] = Object.fromEntries(Object.entries(source)
      .filter(([key]) => key.startsWith("desktop."))
      .sort(([left], [right]) => left.localeCompare(right)));
    if (!Object.keys(locales[locale]).length
      || Object.values(locales[locale]).some((value) => typeof value !== "string" || !value.trim())) {
      throw new Error(`Missing desktop messages for ${locale}; run pnpm i18n:build`);
    }
  }
  if (Object.keys(locales.en).join("\n") !== Object.keys(locales["zh-CN"]).join("\n")) {
    throw new Error("Desktop locale keys differ; run pnpm check:i18n");
  }
  return locales;
}

import type { UiLocale } from "@paperclipai/shared";

export function parseSupportedDetectedLocale(value: string): UiLocale | null {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("en")) return "en";
  return null;
}

export function convertDetectedUiLocale(value: string): string {
  return parseSupportedDetectedLocale(value) ?? value;
}

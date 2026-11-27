import i18n, { getCurrentLocale, translateInstant } from "@/i18n";

const DAY = 86_400_000;

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

function activeDateLocale(): string {
  if (!i18n.isInitialized) return "en-US";
  const locale = getCurrentLocale();
  return i18n.hasResourceBundle(locale, "common") ? locale : "en-US";
}

/** The Artifacts page's form: "4:05 PM" · "Yesterday" · "Monday" · "Sep 12". */
export function updatedLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const locale = activeDateLocale();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (days <= 0) return date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (days === 1) return translateInstant("artifacts.when.yesterday", { defaultValue: "Yesterday" });
  if (days < 7) return date.toLocaleDateString(locale, { weekday: "long" });
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

/** The panel row's form: "Today" · "Yesterday" · "2D ago" · "July 23". */
export function panelDateLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const locale = activeDateLocale();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (days <= 0) return translateInstant("artifacts.when.today", { defaultValue: "Today" });
  if (days === 1) return translateInstant("artifacts.when.yesterday", { defaultValue: "Yesterday" });
  if (days < 7) return translateInstant("artifacts.when.daysAgoShort", { days, defaultValue: "{{days}}D ago" });
  return date.toLocaleDateString(locale, { month: "long", day: "numeric" });
}

export const countLabel = (count: number) =>
  translateInstant("artifacts.when.count", {
    count,
    defaultValue: count === 1 ? "{{count}} Artifact" : "{{count}} Artifacts",
  });

export function sizeLabel(bytes: number | null | undefined): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

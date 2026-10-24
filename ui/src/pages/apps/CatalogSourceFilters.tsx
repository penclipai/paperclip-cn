import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import { TabFilters } from "@/components/TabBar";

export const CATALOG_SOURCES = ["paperclip", "composio", "arcade", "installed", "all"] as const;
export type CatalogSource = typeof CATALOG_SOURCES[number];
export const CATALOG_SOURCE_NAMES = { paperclip: "Paperclip", composio: "Composio", arcade: "Arcade", executor: "Executor", get installed() { return translateInstant("Installed"); }, get all() { return translateInstant("All"); } };

export function CatalogSourceFilters({ source, onChange }: { source: CatalogSource; onChange: (source: CatalogSource) => void }) {
  useTranslation();
  return <TabFilters label={translateInstant("App filters")} size="standard"
    items={CATALOG_SOURCES.map(value => ({ value, label: CATALOG_SOURCE_NAMES[value] }))}
    value={source} onValueChange={onChange} />;
}

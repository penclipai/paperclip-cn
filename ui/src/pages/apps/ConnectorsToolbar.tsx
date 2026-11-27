import { useTranslation } from "react-i18next";
import { ToolbarSearch } from "@/components/ToolbarSearch";
import { CatalogSourceFilters, type CatalogSource } from "./CatalogSourceFilters";

/** Shared catalog search and source filters; data and scope changes stay in Browse. */
export function ConnectorsToolbar({ query, onQueryChange, source, onSourceChange, hideSources = false }: {
  query: string;
  onQueryChange: (value: string) => void;
  source: CatalogSource;
  onSourceChange: (value: CatalogSource) => void;
  /** A category page searches inside one category, so the source tabs do not apply. */
  hideSources?: boolean;
}) {
  const { t } = useTranslation();
  return <header data-canonical-toolbar="connectors" role="toolbar" aria-label={t("apps.connectors.toolbar", { defaultValue: "Connectors controls" })} className="flex flex-wrap items-center gap-3">
    {hideSources ? null : <CatalogSourceFilters source={source} onChange={onSourceChange} />}
    <div className="ml-auto w-full sm:w-80 [&_.design-task-search]:w-full!">
      <ToolbarSearch query={query} onQueryChange={onQueryChange} label={t("apps.connectors.searchLabel", { defaultValue: "Search plugins" })} placeholder={t("apps.connectors.searchPlaceholder", { defaultValue: "Search plugins…" })} inputType="search" />
    </div>
  </header>;
}

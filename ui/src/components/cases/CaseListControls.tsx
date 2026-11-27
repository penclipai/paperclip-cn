import type { ReactNode } from "react";
import { ArrowUpDown, Check, Columns3, Filter, Layers } from "lucide-react";
import type { CaseGroupBy, CaseSortField } from "@/api/cases";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CASE_COLUMNS, CASE_GROUP_OPTIONS, CASE_SORT_OPTIONS, DEFAULT_CASE_COLUMNS, type CaseColumn } from "@/lib/case-list-view";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const CASE_COLUMN_LABEL_KEYS: Record<CaseColumn, { key: string; defaultValue: string }> = {
  identifier: { key: "cases.columns.identifier", defaultValue: "Identifier" },
  type: { key: "cases.columns.type", defaultValue: "Type" },
  project: { key: "cases.columns.project", defaultValue: "Project" },
  phase: { key: "cases.columns.phase", defaultValue: "Phase" },
  assignee: { key: "Agent", defaultValue: "Agent" },
  status: { key: "cases.columns.status", defaultValue: "Status" },
  updated: { key: "cases.columns.updated", defaultValue: "Updated" },
};

const CASE_SORT_LABEL_KEYS: Record<CaseSortField, { key: string; defaultValue: string }> = {
  updated: { key: "cases.columns.updated", defaultValue: "Updated" },
  created: { key: "Created", defaultValue: "Created" },
  title: { key: "cases.sort.title", defaultValue: "Title" },
  status: { key: "cases.sort.status", defaultValue: "Status" },
  type: { key: "cases.sort.type", defaultValue: "Type" },
};

const CASE_GROUP_LABEL_KEYS: Record<CaseGroupBy, { key: string; defaultValue: string }> = {
  none: { key: "cases.group.none", defaultValue: "None" },
  status: { key: "cases.group.status", defaultValue: "Status" },
  type: { key: "cases.group.type", defaultValue: "Type" },
  project: { key: "cases.group.project", defaultValue: "Project" },
};

export function CaseListControls({ filters, activeFilterCount, columns, onColumnsChange, sortField, sortDir, onSortChange, groupBy, onGroupChange }: {
  filters: ReactNode;
  activeFilterCount: number;
  columns: readonly CaseColumn[];
  onColumnsChange: (columns: CaseColumn[]) => void;
  sortField: CaseSortField;
  sortDir: "asc" | "desc";
  onSortChange: (field: CaseSortField, direction: "asc" | "desc") => void;
  groupBy: CaseGroupBy;
  onGroupChange: (value: CaseGroupBy) => void;
}) {
  const { t } = useTranslation();
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label={t("cases.toolbar.columns")} title={t("cases.toolbar.columns")}><Columns3 aria-hidden className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{t("cases.columns.visibleFields", { defaultValue: "Visible fields" })}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {CASE_COLUMNS.map(([key]) => <DropdownMenuCheckboxItem key={key} checked={columns.includes(key)}
          onSelect={event => event.preventDefault()}
          onCheckedChange={checked => onColumnsChange(CASE_COLUMNS.map(([value]) => value).filter(value => value === key ? checked === true : columns.includes(value)))}>{t(CASE_COLUMN_LABEL_KEYS[key].key, { defaultValue: CASE_COLUMN_LABEL_KEYS[key].defaultValue })}</DropdownMenuCheckboxItem>)}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onColumnsChange(DEFAULT_CASE_COLUMNS)}>{t("cases.columns.resetDefaults")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Popover>
      <PopoverTrigger asChild><Button variant="outline" size="icon" className={cn("relative h-8 w-8 shrink-0", activeFilterCount > 0 && "text-(--collection-filter-active)")}
        aria-label={activeFilterCount ? t("cases.filters.ariaActive", { count: activeFilterCount, defaultValue: `Filter cases (${activeFilterCount} active)` }) : t("cases.filters.aria", { defaultValue: "Filter cases" })} title={t("cases.toolbar.filters")}>
        <Filter aria-hidden className="h-3.5 w-3.5" />
        {activeFilterCount > 0 && <span aria-hidden className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-(--collection-filter-badge) text-(length:--text-nano) font-bold text-(--collection-filter-badge-foreground)">{activeFilterCount}</span>}
      </Button></PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3" aria-label={t("cases.filters.popoverAria", { defaultValue: "Case filters" })}>
        <h2 className="text-sm font-medium">{t("cases.toolbar.filters")}</h2>
        {filters}
      </PopoverContent>
    </Popover>
    <Popover>
      <PopoverTrigger asChild><Button variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label={t("cases.toolbar.sort")} title={t("cases.toolbar.sort")}><ArrowUpDown aria-hidden className="h-3.5 w-3.5" /></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-2" aria-label={t("cases.sort.popoverAria", { defaultValue: "Sort cases" })}>
        {CASE_SORT_OPTIONS.map(([value]) => <button key={value} type="button" aria-pressed={sortField === value}
          className={cn("flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm", sortField === value ? "bg-accent/50 text-foreground" : "text-muted-foreground hover:bg-accent/50")}
          onClick={() => onSortChange(value, sortField === value ? sortDir === "asc" ? "desc" : "asc" : "asc")}>
          <span>{t(CASE_SORT_LABEL_KEYS[value].key, { defaultValue: CASE_SORT_LABEL_KEYS[value].defaultValue })}</span>{sortField === value && <span aria-label={sortDir === "asc" ? t("Ascending", { defaultValue: "Ascending" }) : t("Descending", { defaultValue: "Descending" })} className="text-xs text-muted-foreground">{sortDir === "asc" ? "↑" : "↓"}</span>}
        </button>)}
      </PopoverContent>
    </Popover>
    <Popover>
      <PopoverTrigger asChild><Button variant="outline" size="icon" className={cn("h-8 w-8 shrink-0", groupBy !== "none" && "bg-accent")} aria-label={t("cases.toolbar.group")} title={t("cases.toolbar.group")}><Layers aria-hidden className="h-3.5 w-3.5" /></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-2" aria-label={t("cases.group.popoverAria", { defaultValue: "Group cases" })}>
        {CASE_GROUP_OPTIONS.map(([value]) => <button key={value} type="button" aria-pressed={groupBy === value}
          className={cn("flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm", groupBy === value ? "bg-accent/50 text-foreground" : "text-muted-foreground hover:bg-accent/50")}
          onClick={() => onGroupChange(value)}><span>{t(CASE_GROUP_LABEL_KEYS[value].key, { defaultValue: CASE_GROUP_LABEL_KEYS[value].defaultValue })}</span>{groupBy === value && <Check aria-hidden className="h-3.5 w-3.5" />}</button>)}
      </PopoverContent>
    </Popover>
  </>;
}

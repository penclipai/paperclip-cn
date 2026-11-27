import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { routineColumns, type RoutineColumn } from "@/lib/routine-list-view";
export type { RoutineColumn } from "@/lib/routine-list-view";

export function routineColumnGrid(columns: RoutineColumn[], selectMode = false) {
  return [selectMode ? "var(--routine-select-width)" : null, "minmax(var(--routine-title-min), 1fr)", ...columns.map(column => `var(--routine-column-${column})`), "var(--routine-actions-width)"].filter(Boolean).join(" ");
}
export function RoutineTable({ columns, children, label, selectMode = false }: { columns: RoutineColumn[]; children: ReactNode; label: string; selectMode?: boolean }) {
  const { t } = useTranslation();
  return <div className="overflow-x-auto"><div role="table" aria-label={label} className="routine-table">
    <div role="row" className="routine-table-grid px-3 py-2 text-xs text-muted-foreground" style={{ gridTemplateColumns: routineColumnGrid(columns, selectMode) }}>
      {selectMode ? <span role="columnheader"><span className="sr-only">{t("Select", { defaultValue: "Select" })}</span></span> : null}
      <span role="columnheader">{t("Routine", { defaultValue: "Routine" })}</span>
      {columns.map(id => <span role="columnheader" key={id}>{routineColumns.find(column => column.id === id)!.label}</span>)}
      <span role="columnheader" className="text-right">{t("Actions", { defaultValue: "Actions" })}</span>
    </div>
    <div role="rowgroup">{children}</div>
  </div></div>;
}

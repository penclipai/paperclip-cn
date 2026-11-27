import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import type { IssueFilterState } from "../lib/issue-filters";
import { cn } from "../lib/utils";

function localDateString(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Start and end days for the Updated filter's custom range, in the browser's time zone. */
export function IssueUpdatedRangeInputs({
  state,
  onChange,
  className,
  inputClassName,
}: {
  state: Pick<IssueFilterState, "updatedFrom" | "updatedTo">;
  onChange: (patch: Partial<IssueFilterState>) => void;
  className?: string;
  inputClassName?: string;
}) {
  const { t } = useTranslation();
  const today = localDateString(new Date());
  return (
    <div className={cn("grid grid-cols-2 gap-2", className)} data-filter-options="updated-range">
      <label className="min-w-0 space-y-1">
        <span className="text-xs text-muted-foreground">{t("whatNeedsMe.dateRange.from", { defaultValue: "From" })}</span>
        <Input
          type="date"
          aria-label={t("issueFilters.updatedFromAria", { defaultValue: "Updated from" })}
          value={state.updatedFrom ?? ""}
          max={state.updatedTo ?? today}
          onChange={(event) => onChange({ updatedFrom: event.target.value || null })}
          className={cn("h-8 min-w-0 text-base md:text-xs", inputClassName)}
        />
      </label>
      <label className="min-w-0 space-y-1">
        <span className="text-xs text-muted-foreground">{t("whatNeedsMe.dateRange.to", { defaultValue: "To" })}</span>
        <Input
          type="date"
          aria-label={t("issueFilters.updatedToAria", { defaultValue: "Updated to" })}
          value={state.updatedTo ?? ""}
          min={state.updatedFrom ?? undefined}
          max={today}
          onChange={(event) => onChange({ updatedTo: event.target.value || null })}
          className={cn("h-8 min-w-0 text-base md:text-xs", inputClassName)}
        />
      </label>
    </div>
  );
}

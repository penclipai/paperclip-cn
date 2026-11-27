import { useId, type ReactNode } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { TruncatedText } from "./TruncatedText";

export function FilterGroup({ title, searchLabel, searchPlaceholder, query, onQueryChange, children, optionsKey }: { title: string; searchLabel?: string; searchPlaceholder?: string; query?: string; onQueryChange?: (value: string) => void; children: ReactNode; optionsKey: string }) {
  const { t } = useTranslation();
  const headingId = useId();
  const resolvedAriaLabel = searchLabel ? t("issueFilters.searchGroupAria", { target: searchLabel, defaultValue: `Search ${searchLabel}` }) : undefined;
  const resolvedPlaceholder = searchPlaceholder ?? (searchLabel ? t("issueFilters.searchGroupPlaceholder", { target: searchLabel, defaultValue: `Search ${searchLabel}...` }) : undefined);
  return (
    <section className="task-filter-group" aria-labelledby={headingId}>
      <h3 id={headingId}>{title}</h3>
      <div className="task-filter-group-body">
        {searchLabel || searchPlaceholder ? <div className="task-filter-search"><Search aria-hidden /><Input aria-label={resolvedAriaLabel ?? resolvedPlaceholder} placeholder={resolvedPlaceholder} value={query} onChange={event => onQueryChange?.(event.target.value)} /></div> : null}
        <div className="task-filter-options" data-filter-options={optionsKey}>{children}</div>
      </div>
    </section>
  );
}

export function FilterRow({ label, checked, onToggle, icon }: { label: string; checked: boolean; onToggle: () => void; icon?: ReactNode }) {
  return <label className="task-filter-option" data-marquee-surface><Checkbox aria-label={label} checked={checked} onCheckedChange={onToggle} />{icon ? <span className="task-filter-icon" aria-hidden>{icon}</span> : null}<TruncatedText className="task-filter-option-label">{label}</TruncatedText></label>;
}

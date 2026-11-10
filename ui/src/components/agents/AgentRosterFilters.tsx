import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Filter } from "lucide-react";
import type { Agent } from "@penclipai/shared";
import { aiConnectionsApi } from "@/api/ai-connections";
import { agentRosterFilterFields, buildAgentRosterIndex, emptyAgentRosterFilters, matchesAgentRosterFilters, type AgentRosterFilterField, type AgentRosterFilters as FilterState, type AgentRosterOption } from "@/lib/agent-roster-filters";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NativeSelect } from "@/components/ui/select";

const emptyAgents: Agent[] = [];
const labelKeys: Record<AgentRosterFilterField, string> = { model: "agents.filters.model", status: "agents.filters.status", harness: "agents.filters.harness", connection: "agents.filters.connection" };
const allLabelKeys: Record<AgentRosterFilterField, string> = { model: "agents.filters.allModels", status: "agents.filters.allStatuses", harness: "agents.filters.allHarnesses", connection: "agents.filters.allConnections" };

/** Page-owned state keeps filters when switching views and isolates them by company. */
export function useAgentRosterFilters(companyId: string | null, agents: Agent[] = emptyAgents) {
  const { t, i18n } = useTranslation();
  const [selection, setSelection] = useState({ companyId, filters: emptyAgentRosterFilters });
  const filters = selection.companyId === companyId ? selection.filters : emptyAgentRosterFilters;
  const accounts = useQuery({ queryKey: ["ai-connections", companyId], queryFn: () => aiConnectionsApi.list(companyId!), enabled: !!companyId });
  const index = useMemo(() => buildAgentRosterIndex(agents, accounts.data, t), [agents, accounts.data, i18n.language, t]);
  const activeCount = agentRosterFilterFields.filter(field => filters[field]).length;
  return {
    filters, options: index.options, activeCount,
    onChange: (next: FilterState) => setSelection({ companyId, filters: next }),
    matches: (agent: Agent) => matchesAgentRosterFilters(index.byAgentId.get(agent.id), filters),
    connectionError: accounts.error,
    retryConnections: () => void accounts.refetch(),
  };
}

export function AgentRosterFilters({ filters, options, onChange, activeCount, count, connectionError, retryConnections }: {
  filters: FilterState;
  options: Record<AgentRosterFilterField, AgentRosterOption[]>;
  onChange: (filters: FilterState) => void;
  activeCount: number;
  count: number;
  connectionError?: unknown;
  retryConnections: () => void;
}) {
  const { t, i18n } = useTranslation();
  const labelFor = (field: AgentRosterFilterField) => t(labelKeys[field]);
  return <div data-canonical-toolbar="agent-filters" role="toolbar" aria-label={t("agents.filters.toolbar")} className="flex flex-wrap items-center justify-between gap-3">
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("agents.filters.filterAgents")} title={activeCount ? t("agents.filters.count", { count: activeCount }) : t("agents.filters.filterAgents")}
          className={cn("relative shrink-0", activeCount > 0 && "text-primary")}>
          <Filter className="size-3.5" aria-hidden />
          {activeCount > 0 && <span aria-hidden className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-primary text-(length:--text-nano) font-bold text-primary-foreground">{activeCount}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label={t("agents.filters.choices")} align="start" className="max-h-96 w-72 space-y-3 overflow-y-auto p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t("agents.filters.title")}</span>
          {activeCount > 0 && <Button variant="ghost" size="sm" onClick={() => onChange(emptyAgentRosterFilters)}>{t("agents.filters.clear")}</Button>}
        </div>
        {agentRosterFilterFields.map(field => <label key={field} className="block space-y-1 text-xs font-medium text-muted-foreground">
          <span>{labelFor(field)}</span>
          <NativeSelect aria-label={labelFor(field)} value={filters[field]} onChange={event => onChange({ ...filters, [field]: event.target.value })}
            className="h-11 text-base md:text-sm">
            <option value="">{t(allLabelKeys[field])}</option>
            {filters[field] && !options[field].some(option => option.value === filters[field]) && <option value={filters[field]}>{t("agents.filters.previouslySelected", { field: labelFor(field).toLocaleLowerCase(i18n.language) })}</option>}
            {options[field].map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </NativeSelect>
        </label>)}
      </PopoverContent>
    </Popover>
    <span className="text-xs text-muted-foreground">{t("agents.count", { count })}</span>
    {!!connectionError && <p role="alert" className="basis-full text-xs text-destructive">{t("agents.filters.connectionNamesLoadFailed")} <Button variant="link" size="sm" onClick={retryConnections}>{t("Retry")}</Button></p>}
  </div>;
}

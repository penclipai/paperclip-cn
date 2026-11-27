import { useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { QueryErrorState, useQueryView } from "@/components/QueryView";
import type { Agent, DecisionHistoryScope } from "@penclipai/shared";
import { attentionApi } from "@/api/attention";
import { projectsApi } from "@/api/projects";
import { useNavigate } from "@/lib/router";
import { queryKeys } from "@/lib/queryKeys";
import { DECISION_HISTORY_OUTCOME_OPTIONS, DECISION_HISTORY_SCOPE_OPTIONS, DEFAULT_DECISION_HISTORY_SCOPE } from "@/lib/coordinator-attention";
import { CoordinatorDecisionReceipt as Receipt } from "@/components/coordinator/CoordinatorDecisionReceipt";
import { ToolbarSearch } from "@/components/ToolbarSearch";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { InboxFilter } from "@/components/InboxFilter";

type Group = "none" | "task" | "agent" | "project";

/** "Handled for me" is a filter on who the card was for, not an outcome (PAP-749 plan §6). */
const HANDLED_FOR_ME = "handled_for_me";

/**
 * The Decision history panel of both Decisions pages (PAP-749 plan §3): every
 * closed card — answered, approved, withdrawn, expired or closed with its
 * task, approvals included. It opens on "Handled by me or for me"; Everyone
 * lists every person's (PAP-768). Search, filter by outcome, agent and
 * project within either, and open the task or approval.
 */
export function DecisionHistoryPanel({
  companyId,
  agents,
  userLabelMap,
  afterControls,
}: {
  companyId: string;
  agents: Agent[];
  userLabelMap?: ReadonlyMap<string, string>;
  afterControls?: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState("");
  const [agentId, setAgentId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [groupBy, setGroupBy] = useState<Group>("none");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [scope, setScope] = useState<DecisionHistoryScope>(DEFAULT_DECISION_HISTORY_SCOPE);
  const projects = useQuery({ queryKey: queryKeys.projects.list(companyId), queryFn: () => projectsApi.list(companyId) });
  const history = useInfiniteQuery({
    queryKey: [...queryKeys.attention(companyId), "history", { search, outcome, agentId, projectId, sort, scope }],
    queryFn: ({ pageParam }) => attentionApi.history(companyId, {
      search, agentId, projectId, sort, scope, cursor: pageParam, limit: 40,
      ...(outcome === HANDLED_FOR_ME ? { handledForMe: true } : { outcome }),
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const historyView = useQueryView(history);
  const waiting = historyView.kind === "loading" || historyView.kind === "reconnecting";
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const label = groupBy === "task" ? item.issueIdentifier ?? item.issueTitle ?? t("decisions.history.noTask", { defaultValue: "No task" }) : groupBy === "agent" ? item.agentName ?? t("decisions.history.otherAgents", { defaultValue: "Other agents" }) : groupBy === "project" ? item.projectName ?? t("No project") : "";
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return <div className="space-y-5" data-decision-history>
    <div role="toolbar" aria-label={t("decisions.history.toolbarAria", { defaultValue: "Decision history controls" })} className="space-y-5">
      <ToolbarSearch query={search} onQueryChange={setSearch} label={t("decisions.history.searchAria", { defaultValue: "Search decision history" })} placeholder={t("decisions.history.searchPlaceholder", { defaultValue: "Search decisions or task IDs…" })} />
      <div data-canonical-toolbar="history">
        <InboxFilter<DecisionHistoryScope> label={t("decisions.history.scopeAria", { defaultValue: "Whose decision history" })} heading={t("decisions.history.scopeHeading", { defaultValue: "Whose decisions" })} value={scope}
          options={DECISION_HISTORY_SCOPE_OPTIONS} onChange={setScope} />
        <InboxFilter label={t("decisions.history.outcomeAria", { defaultValue: "Filter decision outcomes" })} heading={t("decisions.history.outcomeHeading", { defaultValue: "Outcome" })} value={outcome} onChange={setOutcome}
          options={[{ value: "", label: t("decisions.history.allOutcomes", { defaultValue: "All outcomes" }) }, ...DECISION_HISTORY_OUTCOME_OPTIONS, { value: HANDLED_FOR_ME, label: t("decisions.history.handledForMe", { defaultValue: "Handled for me" }) }]} />
        <InboxFilter<typeof sort> label={t("decisions.history.sortAria", { defaultValue: "Sort decision history" })} heading={t("decisions.history.sortHeading", { defaultValue: "Sort by" })} value={sort} onChange={setSort}
          options={[{ value: "newest", label: t("decisions.history.newestFirst", { defaultValue: "Newest first" }) }, { value: "oldest", label: t("decisions.history.oldestFirst", { defaultValue: "Oldest first" }) }]} />
        <InboxFilter label={t("decisions.history.agentAria", { defaultValue: "Filter decision history by agent" })} heading={t("Agents")} value={agentId} onChange={setAgentId}
          options={[{ value: "", label: t("All agents") }, ...agents.map(agent => ({ value: agent.id, label: agent.name }))]} />
        <InboxFilter label={t("decisions.history.projectAria", { defaultValue: "Filter decision history by project" })} heading={t("Projects")} value={projectId} onChange={setProjectId}
          options={[{ value: "", label: t("All projects") }, ...(projects.data ?? []).map(project => ({ value: project.id, label: project.name }))]} />
        <InboxFilter<Group> label={t("decisions.history.groupAria", { defaultValue: "Group decision history" })} heading={t("decisions.groupHeading", { defaultValue: "Group by" })} value={groupBy} onChange={setGroupBy}
          options={[{ value: "none", label: t("decisions.group.none", { defaultValue: "No grouping" }) }, { value: "task", label: t("decisions.group.task", { defaultValue: "By task" }) }, { value: "agent", label: t("decisions.group.agent", { defaultValue: "By agent" }) }, { value: "project", label: t("decisions.group.project", { defaultValue: "By project" }) }]} />
      </div>
    </div>
    {afterControls}
    {waiting ? <p role="status" className="text-sm text-muted-foreground">{t("decisions.loading", { defaultValue: "Loading decisions…" })}</p> : null}
    {historyView.kind === "error" ? <QueryErrorState error={historyView.error} onRetry={historyView.retry} /> : null}
    {!waiting && historyView.kind !== "error" && !items.length && <EmptyState placement="upper"
      message={scope === "mine" && !search && !outcome && !agentId && !projectId ? t("decisions.history.emptyMine", { defaultValue: "No decisions handled by you or for you yet." }) : t("decisions.history.emptyFiltered", { defaultValue: "No decisions match these filters." })}
      action={scope === "mine" ? t("decisions.history.showEveryones", { defaultValue: "Show everyone's decisions" }) : undefined}
      onAction={() => setScope("all")}
      hideActionIcon
    />}
    <div className="space-y-4">{[...groups].map(([label, entries]) => <section key={label} className="space-y-3">
      {label && <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>}
      {entries.map(item => <Receipt key={item.id} item={item} onOpen={navigate} userLabelMap={userLabelMap} showTimestamp />)}
    </section>)}</div>
    {history.hasNextPage ? <Button variant="outline" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>{history.isFetchingNextPage ? t("Loading…", { defaultValue: "Loading…" }) : t("decisions.history.loadMore", { defaultValue: "Load more decisions" })}</Button> : null}
  </div>;
}

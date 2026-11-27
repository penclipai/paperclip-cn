import type { ReactNode } from "react";
import type { AttentionItem, AttentionProviderLimit } from "@penclipai/shared";
import { useTranslation } from "react-i18next";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";

function RetryStatus({ limit }: { limit: AttentionProviderLimit }) {
  const { t } = useTranslation();
  if (limit.state === "needs_retry") return t("decisions.limit.needsRetry", { defaultValue: "Needs retry" });
  if (limit.state === "retry_requested") return t("decisions.limit.retryRequested", { defaultValue: "Retry requested" });
  return <>
    {t("decisions.limit.retryScheduled", { defaultValue: "Retry scheduled" })}
    {limit.retryAt && <> {t("decisions.limit.forPrefix", { defaultValue: "for" })} <time dateTime={limit.retryAt}>{formatDateTime(limit.retryAt)}</time></>}
  </>;
}

/** This disclosure has no dismissal or retry action. Both belong to the child cards. */
export function InboxLimitCards({ items, renderCard }: {
  items: readonly AttentionItem[];
  renderCard: (item: AttentionItem) => ReactNode;
}) {
  const { t } = useTranslation();
  const chains = items.filter(item => item.providerLimit?.grouping === "retry_chain" && item.relatedIssue);
  const taskCount = new Set(chains.map(item => item.relatedIssue!.id)).size;
  if (taskCount < 2) return items.map(renderCard);
  const grouped = new Set(chains);
  return items.map(item => {
    if (!grouped.has(item)) return renderCard(item);
    if (item !== chains[0]) return null;
    return <details key="usage-limits" className="coordinator-decision-card">
      <summary className="cursor-pointer font-medium">{t("decisions.limit.tasksHitUsageLimits", { count: taskCount, defaultValue: `${taskCount} tasks hit usage limits` })}</summary>
      <div className="mt-3 space-y-3">{chains.map(renderCard)}</div>
    </details>;
  });
}

export function InboxProviderLimit({ item, evidence }: { item: AttentionItem; evidence: readonly AttentionItem[] }) {
  const { t } = useTranslation();
  const state = item.providerLimit!;
  if (state.grouping === "retry_chain" && item.relatedIssue) {
    const task = item.relatedIssue;
    return <div className="space-y-2">
      <h2><Link to={task.href!}>{task.identifier} {task.title}</Link></h2>
      <p className="text-sm"><RetryStatus limit={state} /></p>
      <p className="text-sm text-muted-foreground">{t("decisions.limit.attemptsCount", { count: state.attempts, defaultValue: `${state.attempts} ${state.attempts === 1 ? "attempt" : "attempts"}` })} · {state.resetAt
        ? <>{t("decisions.limit.providerResetAtPrefix", { defaultValue: "Provider reset at" })} <time dateTime={state.resetAt}>{formatDateTime(state.resetAt)}</time></>
        : t("decisions.limit.resetUnknown", { defaultValue: "Reset time unknown" })}</p>
      <div className="flex flex-wrap items-center gap-3">
        {state.state === "needs_retry" && <Button size="sm" asChild><Link to={task.href!}>{t("decisions.limit.openTaskToRetry", { defaultValue: "Open task to retry" })}</Link></Button>}
        <Link to={`/agents/${state.agentId}/runs/${state.runId}`} className="text-sm underline">{t("decisions.limit.agentRunLog", { agent: state.agentName, defaultValue: `${state.agentName} run log` })}</Link>
      </div>
    </div>;
  }
  const members = [item, ...evidence].filter(member => member.providerLimit && member.relatedIssue);
  const tasks = [...new Map(members.map(member => [member.relatedIssue!.id, member])).values()];
  const manual = tasks.filter(task => task.providerLimit!.state === "needs_retry");
  const title = manual.length
    ? t("decisions.limit.tasksNeedRetry", { count: manual.length, defaultValue: `${manual.length} ${manual.length === 1 ? "task needs" : "tasks need"} a retry after the usage limit` })
    : t("decisions.limit.tasksPaused", { count: tasks.length, defaultValue: `${tasks.length} ${tasks.length === 1 ? "task paused" : "tasks paused"} by the provider usage limit` });
  const scheduled = tasks.filter(task => task.providerLimit!.state === "scheduled");
  const firstRetry = scheduled[0]?.providerLimit?.retryAt;
  const sharedRetryAt = firstRetry && scheduled.every(task => task.providerLimit!.retryAt === firstRetry) ? firstRetry : null;
  return <div className="space-y-3">
    <h2>{title}</h2>
    {state.resetAt && <p className="text-sm text-muted-foreground">{t("decisions.limit.providerResetAtPrefix", { defaultValue: "Provider reset at" })} <time dateTime={state.resetAt}>{formatDateTime(state.resetAt)}</time>.</p>}
    {scheduled.length > 0 && <p className="text-sm text-muted-foreground">{t("decisions.limit.retryScheduledForTasks", { count: scheduled.length, defaultValue: `Retry scheduled for ${scheduled.length} ${scheduled.length === 1 ? "task" : "tasks"}` })}
      {sharedRetryAt && <> {t("decisions.limit.atPrefix", { defaultValue: "at" })} <time dateTime={sharedRetryAt}>{formatDateTime(sharedRetryAt)}</time></>}.
    </p>}
    {!scheduled.length && !manual.length && <p className="text-sm text-muted-foreground">{t("decisions.limit.retryRequestedWaiting", { defaultValue: "Retry requested. Waiting for work to resume." })}</p>}
    {manual.length > 0 && <p className="text-sm text-muted-foreground">{t("decisions.limit.openAffectedTask", { defaultValue: "Open the affected task to retry it when capacity is available." })}</p>}
    <details><summary className="cursor-pointer text-sm">{t("decisions.limit.viewTasks", { count: tasks.length, defaultValue: `View ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}` })}</summary>
      <ul className="mt-2 space-y-2">{tasks.map(member => {
        const task = member.relatedIssue!;
        const limit = member.providerLimit!;
        return <li key={task.id} className="flex flex-wrap items-center gap-2 text-sm">
          <Link to={task.href!} className="underline">{task.identifier} {task.title}</Link>
          <span>{limit.agentName} · <RetryStatus limit={limit} /></span>
          <Link to={`/agents/${limit.agentId}/runs/${limit.runId}`} className="underline">{t("decisions.runHistory.runLog", { defaultValue: "Run log" })}</Link>
        </li>;
      })}</ul>
    </details>
    {manual.length === 1 && <Button size="sm" asChild><Link to={manual[0]!.relatedIssue!.href!}>{t("decisions.limit.openTaskToRetry", { defaultValue: "Open task to retry" })}</Link></Button>}
  </div>;
}

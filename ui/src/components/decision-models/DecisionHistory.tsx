import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { DecisionHistoryEntry } from "@penclipai/shared";
import { decisionModelsApi } from "@/api/decision-models";
import { Link } from "@/lib/router";
import { formatDateTime, formatTokens, formatDetailedCents } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ANALYTICS_MASK_CLASS } from "@/lib/analytics/privacy";

const STATUS_KEYS: Record<string, { key: string; defaultValue: string }> = {
  succeeded: { key: "decisionHistory.status.succeeded", defaultValue: "Succeeded" },
  running: { key: "decisionHistory.status.running", defaultValue: "Running" },
  unknown: { key: "decisionHistory.status.unknown", defaultValue: "Unresolved" },
  skipped: { key: "decisionHistory.status.skipped", defaultValue: "Skipped" },
  pending: { key: "decisionHistory.status.pending", defaultValue: "Pending" },
  failed: { key: "decisionHistory.status.failed", defaultValue: "Failed" },
};

export function DecisionHistoryTable({ entries, fastResponse = false, fastResponsesEnabled = true }: { entries: (DecisionHistoryEntry & { publicationStatus?: string; connectionName?: string | null })[]; fastResponse?: boolean; fastResponsesEnabled?: boolean }) {
  useTranslation();
  if (!entries.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {fastResponse
          ? translateInstant("fastResponses.emptyInPeriod", { defaultValue: "No fast responses in this period." })
          : translateInstant("decisionHistory.emptyInPeriod", { defaultValue: "No decision requests in this period." })}{" "}
        <Link to={fastResponse && !fastResponsesEnabled ? "/company/settings/instance/experimental" : "/company/settings/connections"} className="underline underline-offset-4">
          {fastResponse
            ? fastResponsesEnabled
              ? translateInstant("fastResponses.configureLink", { defaultValue: "Configure fast response" })
              : translateInstant("fastResponses.enableExperimentalLink", { defaultValue: "Enable experimental fast responses" })
            : translateInstant("decisionHistory.configureModelLink", { defaultValue: "Configure a decision model" })}
        </Link>
        {translateInstant("decisionHistory.toRunTestSuffix", { defaultValue: " to run a test." })}
      </p>
    );
  }
  const columns = [
    translateInstant("decisionHistory.col.whenFeature", { defaultValue: "When / feature" }),
    translateInstant("decisionHistory.col.responsible", { defaultValue: "Responsible" }),
    translateInstant("decisionHistory.col.task", { defaultValue: "Task" }),
    ...(fastResponse ? [translateInstant("decisionHistory.col.connection", { defaultValue: "Connection" })] : []),
    translateInstant("decisionHistory.col.model", { defaultValue: "Model" }),
    translateInstant("decisionHistory.col.status", { defaultValue: "Status" }),
    translateInstant("decisionHistory.col.duration", { defaultValue: "Duration" }),
    translateInstant("decisionHistory.col.tokensInOut", { defaultValue: "Tokens in / out" }),
    translateInstant("decisionHistory.col.cost", { defaultValue: "Cost" }),
  ];
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">{translateInstant("Recent requests. Inputs are not retained.")}</p>
    <div className="overflow-x-auto"><table className="w-full text-sm" aria-label={fastResponse ? translateInstant("fastResponses.tableAria", { defaultValue: "Fast responses" }) : translateInstant("decisionHistory.tableAria", { defaultValue: "Decision requests" })}>
      <thead><tr className="border-b border-border text-muted-foreground">{columns.map(label => <th key={label} className="px-3 py-2 text-left font-medium">{label}</th>)}</tr></thead>
      <tbody>{entries.map(row => {
        const statusInfo = STATUS_KEYS[row.status] ?? STATUS_KEYS.failed;
        return <tr key={row.id} className="border-b border-border last:border-0">
          <td className="px-3 py-3"><div className="whitespace-nowrap">{formatDateTime(row.startedAt)}</div><div className="text-xs text-muted-foreground">{row.feature === "settings.test" ? translateInstant("decisionHistory.setupTest", { defaultValue: "Setup test" }) : row.feature}</div></td>
          <td className="px-3 py-3">{row.actorType === "system" ? translateInstant("Paperclip services") : row.userName ?? (row.responsibleUserId === "local-board" ? translateInstant("Board") : translateInstant("decisionHistory.formerUser", { defaultValue: "Former user" }))}</td>
          <td className="px-3 py-3">{row.issueId ? <Link className="underline underline-offset-4" to={`/issues/${row.issueIdentifier ?? row.issueId}`}>{row.issueIdentifier ?? translateInstant("View task")}</Link> : "—"}</td>
          {fastResponse && <td className={`px-3 py-3 ${ANALYTICS_MASK_CLASS}`}>{row.connectionName ?? (row.connectionId ? translateInstant("decisionHistory.removedConnection", { defaultValue: "Removed connection" }) : "—")}</td>}
          <td className="px-3 py-3 font-mono text-xs">{row.model}</td>
          <td className="px-3 py-3"><div>{translateInstant(statusInfo.key, { defaultValue: statusInfo.defaultValue })}</div>{row.publicationStatus && <div className="text-xs text-muted-foreground">{row.publicationStatus}</div>}{row.errorCode && <div className="text-xs text-muted-foreground">{row.errorCode.replaceAll("_", " ")}</div>}</td>
          <td className="px-3 py-3 font-mono">{row.durationMs === null ? "—" : `${(row.durationMs / 1000).toFixed(1)}s`}</td>
          <td className="whitespace-nowrap px-3 py-3 font-mono">{row.inputTokens === null ? "—" : formatTokens(row.inputTokens)} / {row.outputTokens === null ? "—" : formatTokens(row.outputTokens)}</td>
          <td className="px-3 py-3 font-mono"><div>{row.costCents === null ? translateInstant("Unknown") : formatDetailedCents(row.costCents)}</div>{row.costStatus !== "unpriced" && row.costStatus && <span className="text-xs text-muted-foreground">{row.costStatus === "estimated" ? translateInstant("Estimated") : translateInstant("decisionHistory.reported", { defaultValue: "Reported" })}</span>}</td>
        </tr>;
      })}</tbody>
    </table></div>
  </div>;
}
export function DecisionHistory({ companyId, from, to }: { companyId: string; from?: string | null; to?: string | null }) {
  useTranslation();
  const query = useQuery({ queryKey: ["decision-history", companyId, from, to], queryFn: () => decisionModelsApi.history(companyId, from, to), refetchInterval: q => q.state.data?.some(row => row.status === "running") ? 5000 : false });
  if (query.isPending) return <p className="text-sm text-muted-foreground">{translateInstant("decisionHistory.loading", { defaultValue: "Loading decision requests…" })}</p>;
  if (query.error) return <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{translateInstant("decisionHistory.loadError", { defaultValue: "Could not load decision requests." })}</p><Button variant="outline" onClick={() => void query.refetch()}>{translateInstant("Try again")}</Button></div>;
  return <DecisionHistoryTable entries={query.data ?? []} />;
}

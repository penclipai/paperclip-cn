import { useTranslation } from "react-i18next";
import { Link } from "@/lib/router";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { timeAgo } from "../lib/timeAgo";
import { displaySeededName } from "../lib/seeded-display";
import type { LiveRunForIssue } from "../api/heartbeats";

interface FailedRunIndicatorProps {
  failedRuns: LiveRunForIssue[];
}

export function FailedRunIndicator({ failedRuns }: FailedRunIndicatorProps) {
  const { t } = useTranslation();

  if (failedRuns.length === 0) return null;

  // Show only the most recent failures (max 3)
  const recentFailures = failedRuns.slice(0, 3);

  return (
    <div className="rounded-md border border-red-500/20 bg-red-500/5 px-4 py-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">
              {t("failedRuns.title", {
                count: failedRuns.length,
                defaultValue: `${failedRuns.length} failed run${failedRuns.length > 1 ? "s" : ""}`,
              })}
            </p>
            <Link
              to="/runs?status=failed,timed_out"
              className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
            >
              {t("failedRuns.viewAll", { defaultValue: "View all" })}
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-1.5">
            {recentFailures.map((run) => (
              <div
                key={run.id}
                className="flex items-start justify-between gap-2 rounded-md bg-card px-2.5 py-2 text-xs border border-border/50"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">
                    {displaySeededName(run.agentName)}
                  </p>
                  {run.issueId && (
                    <Link
                      to={`/issues/${run.issueId}`}
                      className="text-muted-foreground hover:text-foreground transition-colors truncate block"
                    >
                      {t("failedRuns.onIssue", { defaultValue: "On issue" })}: {run.issueId.slice(0, 8)}
                    </Link>
                  )}
                  <p className="text-muted-foreground mt-0.5">
                    {run.status === "timed_out"
                      ? t("failedRuns.timedOut", { defaultValue: "Timed out" })
                      : t("failedRuns.failed", { defaultValue: "Failed" })}
                    {run.finishedAt ? ` ${timeAgo(run.finishedAt)}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

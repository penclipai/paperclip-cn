import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ExecutionBlocker } from "@penclipai/shared";
import { agentsApi } from "../api/agents";
import { activityApi } from "../api/activity";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { Link } from "../lib/router";

export function ExecutionBlockerNotice({ companyId, issueId, blocker, onRetried, className }: {
  className?: string;
  companyId: string;
  issueId: string;
  blocker: ExecutionBlocker;
  onRetried: () => void;
}) {
  useTranslation();
  const queryClient = useQueryClient();
  const { data: runs, error: runsError } = useQuery({
    queryKey: queryKeys.issues.runs(issueId),
    queryFn: () => activityApi.runsForIssue(issueId),
  });
  const failedRun = runs?.find(run => run.runId === blocker.runId &&
    ["failed", "timed_out"].includes(run.status));
  const modelRejected = failedRun?.errorCode === "native_provider_model_rejected";
  const requiresInspection = blocker.cause === "native_continuation_requires_reconciliation" ||
    blocker.cause === "native_session_cleanup_quarantined";
  const retry = useMutation({
    mutationFn: () => agentsApi.retryFailedRun(blocker.agentId!, blocker.runId!, companyId),
    onSuccess: () => {
      onRetried();
      for (const queryKey of [queryKeys.issues.detail(issueId), queryKeys.issues.runs(issueId),
        queryKeys.issues.liveRuns(issueId), queryKeys.issues.activeRun(issueId)]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
  return (
    <div role="status" aria-label={translateInstant("Task recovery")} className={cn("task-context-notice flex flex-wrap items-center justify-between gap-2", className)}>
      <div className="min-w-0 flex-1 break-words">
        <p>
          {translateInstant(modelRejected ? "Model unavailable." : "Recovery needed.")}
          {blocker.runError ? ` ${blocker.runError}` : ""}
        </p>
        {modelRejected && <p>{translateInstant("Choose a supported model or clear the task's model override, then retry.")}</p>}
        {blocker.workspaceRepairRequired ? (
          <>
            <p>
              {translateInstant("Paperclip could not restore the agent's workspace files after its last run. A board operator must recover the files before the agent can continue.")}
            </p>
            <details>
              <summary className="cursor-pointer">{translateInstant("Technical details")}</summary>
              <p>{blocker.nextAction}</p>
            </details>
          </>
        ) : <p>{blocker.nextAction}</p>}
        {Boolean(blocker.savedMessageCount) && (
          <p>
            {translateInstant(
              blocker.savedMessageCount === 1
                ? "{{count}} saved message is waiting for recovery."
                : "{{count}} saved messages are waiting for recovery.",
              { count: blocker.savedMessageCount },
            )}
          </p>
        )}
      </div>
      {blocker.agentId && blocker.runId && (
        <Button variant="outline" size="sm" asChild>
          <Link to={`/agents/${blocker.agentId}/runs/${blocker.runId}`}>{translateInstant("Inspect run")}</Link>
        </Button>
      )}
      {!blocker.workspaceRepairRequired && (!requiresInspection || blocker.canRetry) && blocker.agentId && blocker.runId &&
        ((blocker.cause === "legacy_execution_requires_reconciliation" && failedRun) || blocker.canContinue || blocker.canRetry) && (
        <Button variant="outline" size="sm" disabled={retry.isPending} onClick={() => retry.mutate()}>
          {retry.isPending
            ? translateInstant("Starting…")
            : blocker.canContinue
              ? translateInstant("common.continue")
              : translateInstant("Retry")}
        </Button>
      )}
      {retry.isError && (
        <p role="alert" className="w-full text-destructive">{retry.error.message}</p>
      )}
      {runsError && <p role="alert" className="w-full text-destructive">{runsError.message}</p>}
    </div>
  );
}

import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { IssueRecoveryAction } from "@penclipai/shared";
import { isNativeWorkspaceExportRepairCause } from "@penclipai/shared";
import { issuesApi } from "../api/issues";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

/** Copyback repair preserves the accepted result and never wakes the provider. */
export function WorkspaceExportRecovery({ issueId, action, canManage, onQueued, className }: {
  className?: string;
  issueId: string; action: IssueRecoveryAction | null; canManage: boolean; onQueued: () => void;
}) {
  useTranslation();
  const noteId = useId();
  const [repairNote, setRepairNote] = useState("");
  const [queuedActionVersion, setQueuedActionVersion] = useState<string | null>(null);
  const retry = useMutation({
    mutationFn: () => issuesApi.retryWorkspaceExport(issueId, {
      actionId: action!.id, runId: action!.evidence.runId as string, repairNote: repairNote.trim(),
    }),
    onSuccess: () => { setQueuedActionVersion(String(action!.updatedAt)); onQueued(); },
  });
  if (!action || !isNativeWorkspaceExportRepairCause(action.cause) || action.ownerType !== "board"
    || !["active", "escalated"].includes(action.status) || typeof action.evidence.runId !== "string") return null;
  const queued = queuedActionVersion === String(action.updatedAt) || action.wakePolicy?.kind === "resume_native_run";
  return <section aria-label={translateInstant("Workspace export repair")} className={cn("task-context-notice flex flex-col gap-2", className)}>
    <p className="font-medium">{translateInstant("Workspace export needs repair")}</p>
    {queued ? <p role="status">{translateInstant("Export is queued for the saved result. The agent will not repeat its work.")}</p> : <>
      <p className="text-muted-foreground">{translateInstant("Automatic workspace export retries stopped. Inspect the export failure, restore provider or destination availability, and preserve the saved files in the retained sandbox. Retry export here when the cause is resolved.")}</p>
      {canManage ? <>
        <Label htmlFor={noteId}>{translateInstant("Repair performed")}</Label>
        <Textarea id={noteId} value={repairNote} onChange={event => setRepairNote(event.target.value)} maxLength={12_000}
          placeholder={translateInstant("Describe the repair and how the saved workspace files were preserved.")} disabled={retry.isPending} />
        <div className="flex justify-end">
          <Button onClick={() => retry.mutate()} disabled={retry.isPending || repairNote.trim().length < 20}>
            {retry.isPending ? "Queueing export…" : "Retry workspace export"}
          </Button>
        </div>
      </> : <p className="text-muted-foreground">{translateInstant("A board member with runtime access can retry this export after repair.")}</p>}
      {retry.isError && <p role="alert" className="text-destructive">{retry.error instanceof Error ? retry.error.message : "Could not queue export. Refresh the task and inspect its run."}</p>}
    </>}
  </section>;
}

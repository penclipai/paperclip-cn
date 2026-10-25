import { and, eq, sql } from "drizzle-orm";
import { agentWakeupRequests, environmentLeases, heartbeatRuns, issueRecoveryActions, nativeRunFinalizations, type Db } from "@penclipai/db";
import { readTaskRetryIntent } from "../task-retry.js";
import { hasNativeLocalProcessStop, hasHistoricalSuspendedNativeSession, recordedLocalExecutionStopped } from "../native-local-process-stop.js";
import { hasRemoteTerminationReceipt } from "../remote-execution-termination.js";
import { adapterExecutionControls } from "../adapter-execution-control.js";
import { getExecutionBlocker } from "../execution-blocker.js";
import { readSystemRecovery } from "../system-recovery-state.js";

/** This receipt changes the workspace strategy, never the external principal,
 * accepted inbound batch, publication scope, or current conversation access. */
export async function readTaskChatRetryIntent(db: Db, input: {
  companyId: string; issueId: string; agentId: string; sourceRunId: string;
  intentId: string; chatActionId?: string;
}) {
  const [wake] = await db.select().from(agentWakeupRequests).where(and(
    eq(agentWakeupRequests.companyId, input.companyId), eq(agentWakeupRequests.id, input.intentId),
    eq(agentWakeupRequests.agentId, input.agentId), eq(agentWakeupRequests.reason, "task_retry"),
    eq(agentWakeupRequests.requestedByActorType, "user"),
    sql`${agentWakeupRequests.payload}->>'issueId' = ${input.issueId}`,
    sql`${agentWakeupRequests.idempotencyKey} like 'task-retry:%'`,
  ));
  const intent = readTaskRetryIntent(wake?.payload);
  return wake && intent && intent.generationId === wake.id && !intent.canonicalIntentId &&
    intent.sourceRunId === input.sourceRunId && intent.actorId === wake.requestedByActorId &&
    (!input.chatActionId || intent.chatActionId === input.chatActionId)
    ? { wake, intent } : null;
}

/** An unusable checkpoint does not prevent an isolated attempt. The old
 * executor must still be contained; a terminal database row is insufficient. */
export async function taskChatRetryExecutionStopped(db: Db, run: typeof heartbeatRuns.$inferSelect) {
  if (adapterExecutionControls.has(run.id) ||
      (run.controllerLeaseExpiresAt && run.controllerLeaseExpiresAt > new Date())) return false;
  const [coordinator] = await db.select().from(nativeRunFinalizations).where(and(
    eq(nativeRunFinalizations.companyId, run.companyId), eq(nativeRunFinalizations.runId, run.id),
  )).for("share", { noWait: true });
  if (coordinator && (coordinator.leaseOwner || coordinator.resultId || coordinator.failureDetail?.successorRunId ||
      !["terminal_failure", "committed"].includes(coordinator.phase))) return false;
  const leases = await db.select().from(environmentLeases).where(and(
    eq(environmentLeases.companyId, run.companyId), eq(environmentLeases.heartbeatRunId, run.id),
  )).for("share", { noWait: true });
  if (leases.some(lease => lease.provider !== "local")) return leases.every(hasRemoteTerminationReceipt);
  return await recordedLocalExecutionStopped(db, run) ||
    await hasNativeLocalProcessStop(db, run.companyId, run.id) ||
    await hasHistoricalSuspendedNativeSession(db, run);
}

/** Admission may persist a wait for the exact recovery this user requested.
 * This grants no execution authority: promotion and execution still require
 * containment, and the queue retains the source's current execution blocker. */
export async function taskChatRetryCanAwaitRecovery(db: Db, run: typeof heartbeatRuns.$inferSelect,
  issueId: string, intentId: string) {
  const retry = await readTaskChatRetryIntent(db, { companyId: run.companyId, issueId,
    agentId: run.agentId, sourceRunId: run.id, intentId });
  if (!retry || retry.wake.status !== "deferred_issue_execution" || retry.wake.runId) return false;
  const blocker = await getExecutionBlocker(db, run.companyId, issueId);
  if (blocker?.runId !== run.id || !blocker.recoveryActionId) return false;
  const [action] = await db.select({ evidence: issueRecoveryActions.evidence }).from(issueRecoveryActions).where(and(
    eq(issueRecoveryActions.companyId, run.companyId), eq(issueRecoveryActions.sourceIssueId, issueId),
    eq(issueRecoveryActions.id, blocker.recoveryActionId),
  )).for("share", { noWait: true });
  const recovery = readSystemRecovery(action?.evidence);
  // Attaching Retry to active automatic recovery preserves that recovery's
  // generation and budget. Its current intentId binds this user request; the
  // Retry receipt's generation is a different identity.
  return Boolean(recovery && recovery.sourceRunId === run.id && recovery.intentId === intentId &&
    ["scheduled", "running", "awaiting_evidence"].includes(recovery.state));
}

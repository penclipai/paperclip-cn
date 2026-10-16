import { and, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import {
  budgetReservations,
  costEvents,
  environmentLeases,
  heartbeatRunEvents,
  heartbeatRuns,
  nativeRunFinalizations,
  runUsageReceipts,
  type Db,
} from "@penclipai/db";
import { claimedAdapterType } from "./conversation-continuation.js";
import { legacyControllerBootId } from "./legacy-controller-lease.js";
import { hasRequiredWorkspaceRecovery } from "./workspace-restore-recovery-state.js";

type Run = typeof heartbeatRuns.$inferSelect;

function hasOnlyHostLedgerScope(usageJson: unknown): boolean {
  if (usageJson === null || usageJson === undefined) return true;
  if (typeof usageJson !== "object" || Array.isArray(usageJson)) return false;
  const usage = usageJson as Record<string, unknown>;
  if (!Object.hasOwn(usage, "ledgerScope") || Object.keys(usage).length !== 1)
    return false;
  return typeof usage.ledgerScope === "object" && usage.ledgerScope !== null &&
    !Array.isArray(usage.ledgerScope);
}

/**
 * A narrowly-scoped compatibility proof for an old Grok cancellation window.
 * The old legacy selector had already persisted the immutable Grok dispatch
 * claim. Its only adapter handoff passes controllerLease.assertOwned(
 * "dispatching"), which atomically requires the current, running, unexpired
 * owner and persists the dispatching stage. A terminal unresolved preparing row
 * therefore cannot have crossed that door. Grok's onMeta-before-spawn contract
 * and lifecycle-only events are contradiction checks, not the primary proof.
 * The old marker was introduced after that dispatch gate; the newer
 * beforeRuntimeSelection field excludes current-build cancellations here.
 * Other legacy adapters retain their conservative recovery hold.
 */
export function hasHistoricalCancelledGrokStartupShape(
  run: Run,
  now = new Date(),
): boolean {
  const cancellation = run.resultJson?.startupCancellation;
  const requestedAt =
    cancellation && typeof cancellation === "object" && !Array.isArray(cancellation)
      ? (cancellation as Record<string, unknown>).requestedAt
      : null;
  const requestedAtDate = typeof requestedAt === "string" ? new Date(requestedAt) : null;
  const hasValidTimeWindow =
    requestedAtDate !== null &&
    !Number.isNaN(requestedAtDate.getTime()) &&
    run.startedAt !== null &&
    run.finishedAt !== null &&
    run.startedAt <= requestedAtDate &&
    requestedAtDate <= run.finishedAt &&
    run.finishedAt <= now;
  const hasHistoricalCancellationMarker =
    cancellation &&
    typeof cancellation === "object" &&
    !Array.isArray(cancellation) &&
    typeof requestedAt === "string" &&
    requestedAt.trim().length > 0 &&
    hasValidTimeWindow &&
    !Object.hasOwn(cancellation, "beforeRuntimeSelection") &&
    (cancellation as Record<string, unknown>).beforeNativeSelection === false;
  if (
    run.runtimeMode !== "legacy" ||
    run.status !== "cancelled" ||
    !run.finishedAt ||
    !["agent_paused", "operator_interrupted"].includes(run.errorCode ?? "") ||
    run.runtimeModeResolvedAt !== null ||
    run.executionStage !== "preparing" ||
    run.nativePhase ||
    claimedAdapterType(run) !== "grok_local" ||
    !hasHistoricalCancellationMarker ||
    !run.controllerBootId ||
    run.controllerBootId === legacyControllerBootId ||
    !run.controllerLeaseExpiresAt ||
    run.controllerLeaseExpiresAt > now
  ) {
    return false;
  }

  // Any runtime, native, process, or session identity is affirmative evidence
  // that this no-dispatch compatibility path cannot explain the run.
  if (
    run.nativeIssueId ||
    run.nativeSessionId ||
    run.sessionIdAfter ||
    run.processPid ||
    run.processGroupId ||
    run.processStartedAt ||
    run.externalRunId ||
    run.completionContractId ||
    run.completionContractSha256 ||
    run.runnerInstanceId ||
    run.driverKind ||
    run.driverVersion ||
    run.exitCode != null ||
    run.signal ||
    !hasOnlyHostLedgerScope(run.usageJson) ||
    run.costAccountingPending ||
    run.costAccountedAt ||
    run.accountingProjectionVersion ||
    run.accountingLastAttemptAt ||
    run.accountingLastError ||
    run.accountingAttemptCount > 0 ||
    run.resultJson?.workspaceRestoreFailure ||
    run.resultJson?.workspaceRestoreRecovery != null ||
    hasRequiredWorkspaceRecovery(run.resultJson) ||
    (run.resultJson?.executionRecovery !== undefined &&
      run.resultJson?.executionRecovery !== null) ||
    (run.resultJson?.executionRecovery as Record<string, unknown> | undefined)
      ?.providerWorkStarted === true
  ) {
    return false;
  }

  return true;
}

/**
 * This proof intentionally accepts neither a terminal row nor an absent PID.
 * It requires the old Grok ordering contract and rejects every durable trace
 * that could mean a provider, process, session, native executor, or external
 * system observed a dispatch.
 */
export async function isHistoricalCancelledGrokStartup(
  db: Db,
  run: Run,
  now = new Date(),
): Promise<boolean> {
  if (!hasHistoricalCancelledGrokStartupShape(run, now)) return false;

  const [[coordinator], leases, [reservation], [usageReceipt], [costEvent]] = await Promise.all([
    db
    .select({ id: nativeRunFinalizations.runId })
    .from(nativeRunFinalizations)
    .where(
      and(
        eq(nativeRunFinalizations.companyId, run.companyId),
        eq(nativeRunFinalizations.runId, run.id),
      ),
    )
    .limit(1),
    db
      .select({ provider: environmentLeases.provider, releasedAt: environmentLeases.releasedAt, status: environmentLeases.status, cleanupStatus: environmentLeases.cleanupStatus })
      .from(environmentLeases)
      .where(
        and(
          eq(environmentLeases.companyId, run.companyId),
          eq(environmentLeases.heartbeatRunId, run.id),
        ),
      ),
    db.select({ id: budgetReservations.id }).from(budgetReservations).where(and(
      eq(budgetReservations.companyId, run.companyId), eq(budgetReservations.runId, run.id),
    )).limit(1),
    db.select({ id: runUsageReceipts.id }).from(runUsageReceipts).where(and(
      eq(runUsageReceipts.companyId, run.companyId), eq(runUsageReceipts.runId, run.id),
    )).limit(1),
    db.select({ id: costEvents.id }).from(costEvents).where(and(
      eq(costEvents.companyId, run.companyId), eq(costEvents.heartbeatRunId, run.id),
    )).limit(1),
  ]);
  if (coordinator) return false;
  if (reservation || usageReceipt || costEvent) return false;
  if (
    leases.some(
      (lease) =>
        lease.provider !== "local" ||
        !lease.releasedAt ||
        lease.status !== "released" ||
        lease.cleanupStatus === "failed",
    )
  ) {
    return false;
  }

  const [dispatchEvidence] = await db
    .select({ id: heartbeatRunEvents.id })
    .from(heartbeatRunEvents)
    .where(
      and(
        eq(heartbeatRunEvents.companyId, run.companyId),
        eq(heartbeatRunEvents.runId, run.id),
        or(
          isNotNull(heartbeatRunEvents.sourceEventId),
          ne(heartbeatRunEvents.eventType, "lifecycle"),
        ),
      ),
    )
    .limit(1);
  return !dispatchEvidence;
}

/** A dedicated receipt for the historical Grok no-dispatch proof. It must not
 * impersonate a provider cancellation acknowledgement, which has a distinct
 * conversation-recovery meaning. */
export function hasSettledCancelledLegacyStartupReceipt(run: Run): boolean {
  const recovery = run.resultJson?.executionRecovery;
  const recordedAt = recovery && typeof recovery === "object" && !Array.isArray(recovery)
    ? (recovery as Record<string, unknown>).preparationSettledAt : null;
  const settledAt = typeof recordedAt === "string" ? new Date(recordedAt) : null;
  return run.runtimeMode === "legacy" && run.status === "cancelled" &&
    !!run.finishedAt && run.executionStage === "settled" &&
    !run.processPid && !run.processGroupId && !run.processStartedAt &&
    !run.nativeIssueId && !run.nativeSessionId &&
    !run.sessionIdAfter && !run.externalRunId &&
    !run.resultJson?.workspaceRestoreFailure && !run.resultJson?.workspaceRestoreRecovery &&
    !hasRequiredWorkspaceRecovery(run.resultJson) &&
    !!recovery && typeof recovery === "object" && !Array.isArray(recovery) &&
    (recovery as Record<string, unknown>).kind === "bootstrap" &&
    (recovery as Record<string, unknown>).providerWorkStarted === false &&
    !!settledAt && !Number.isNaN(settledAt.getTime()) &&
    settledAt >= run.finishedAt && settledAt <= new Date();
}

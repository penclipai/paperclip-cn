import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { hasHistoricalCancelledGrokStartupShape, hasSettledCancelledLegacyStartupReceipt } from "./cancelled-legacy-startup.js";

type Run = Parameters<typeof hasHistoricalCancelledGrokStartupShape>[0];

const now = new Date("2026-10-16T00:00:00.000Z");

function candidate(): Run {
  return {
    id: randomUUID(),
    companyId: randomUUID(),
    agentId: randomUUID(),
    runtimeMode: "legacy",
    status: "cancelled",
    startedAt: new Date("2026-10-15T23:09:11.527Z"),
    finishedAt: new Date("2026-10-15T23:09:11.737Z"),
    errorCode: "agent_paused",
    runtimeModeResolvedAt: null,
    executionStage: "preparing",
    nativePhase: null,
    runnerProfileJson: { adapterDispatch: { adapterType: "grok_local" } },
    resultJson: { startupCancellation: { requestedAt: "2026-10-15T23:09:11.735Z", beforeNativeSelection: false } },
    usageJson: { ledgerScope: { kind: "company" } },
    costAccountingPending: false,
    costAccountedAt: null,
    accountingProjectionVersion: null,
    accountingLastAttemptAt: null,
    accountingLastError: null,
    accountingAttemptCount: 0,
    controllerBootId: randomUUID(),
    controllerLeaseExpiresAt: new Date("2026-10-15T23:59:00.000Z"),
    nativeIssueId: null,
    nativeSessionId: null,
    sessionIdBefore: null,
    sessionIdAfter: null,
    processPid: null,
    processGroupId: null,
    processStartedAt: null,
    externalRunId: null,
    runnerInstanceId: null,
    driverKind: null,
    driverVersion: null,
    completionContractId: null,
    completionContractSha256: null,
    exitCode: null,
    signal: null,
    logStore: null,
    logRef: null,
    logBytes: null,
    logSha256: null,
    logCompressed: false,
    stdoutExcerpt: null,
    stderrExcerpt: null,
    lastOutputAt: null,
    lastOutputSeq: 0,
    lastOutputStream: null,
    lastOutputBytes: null,
  } as unknown as Run;
}

it("accepts only the old Grok pre-dispatch cancellation shape", () => {
  expect(hasHistoricalCancelledGrokStartupShape(candidate(), now)).toBe(true);
});

it("allows host preparation logs, ledger scope, and a prior session without dispatch evidence", () => {
  expect(hasHistoricalCancelledGrokStartupShape({
    ...candidate(),
    sessionIdBefore: "previous-session",
    logStore: "local_file",
    logRef: "host-preparation.ndjson",
    stdoutExcerpt: "Preparing workspace",
    lastOutputSeq: 1,
    lastOutputAt: new Date("2026-10-15T23:09:11.600Z"),
  }, now)).toBe(true);
});

it.each([
  ["another immutable adapter", { runnerProfileJson: { adapterDispatch: { adapterType: "codex_local" } } }],
  ["missing cancellation marker", { resultJson: {} }],
  ["unverified cancellation marker", { resultJson: { startupCancellation: { requestedAt: "2026-10-15T23:09:11.735Z" } } }],
  ["current before-selection marker", { resultJson: { startupCancellation: { requestedAt: "2026-10-15T23:09:11.735Z", beforeNativeSelection: false, beforeRuntimeSelection: true } } }],
  ["current after-selection marker", { resultJson: { startupCancellation: { requestedAt: "2026-10-15T23:09:11.735Z", beforeNativeSelection: false, beforeRuntimeSelection: false } } }],
  ["malformed cancellation timestamp", { resultJson: { startupCancellation: { requestedAt: "not-a-date", beforeNativeSelection: false } } }],
  ["future cancellation timestamp", { resultJson: { startupCancellation: { requestedAt: "2026-10-16T00:00:01.000Z", beforeNativeSelection: false } } }],
  ["current controller owner", { controllerLeaseExpiresAt: new Date("2026-10-16T00:01:00.000Z") }],
  ["runtime selection", { runtimeModeResolvedAt: now }],
  ["non-preparing execution", { executionStage: "dispatching" }],
  ["provider-started receipt", { resultJson: { startupCancellation: { requestedAt: "2026-10-15T23:09:11.735Z", beforeNativeSelection: false }, executionRecovery: { providerWorkStarted: true } } }],
  ["native phase", { nativePhase: "running" }],
  ["native issue identity", { nativeIssueId: randomUUID() }],
  ["native session identity", { nativeSessionId: randomUUID() }],
  ["process identity", { processPid: 123 }],
  ["process group identity", { processGroupId: 123 }],
  ["process start identity", { processStartedAt: now }],
  ["provider session", { sessionIdAfter: "provider-session" }],
  ["external run", { externalRunId: "provider-run" }],
  ["runner instance", { runnerInstanceId: randomUUID() }],
  ["provider exit", { exitCode: 1 }],
  ["persisted usage", { usageJson: { inputTokens: 1 } }],
  ["workspace recovery", { resultJson: { startupCancellation: { requestedAt: "2026-10-15T23:09:11.735Z", beforeNativeSelection: false }, workspaceRestoreFailure: "restore_unsafe_archive" } }],
  ["non-operator cancellation", { errorCode: "cancelled" }],
] as const)("rejects %s", (_name, patch) => {
  expect(hasHistoricalCancelledGrokStartupShape({ ...candidate(), ...patch } as Run, now)).toBe(false);
});

it("recognizes a dedicated settled startup receipt without provider acknowledgement", () => {
  const run = candidate();
  run.executionStage = "settled";
  run.resultJson = {
    ...run.resultJson,
    executionRecovery: {
      kind: "bootstrap",
      providerWorkStarted: false,
      preparationSettledAt: "2026-10-15T23:09:11.737Z",
    },
  };
  expect(hasSettledCancelledLegacyStartupReceipt(run)).toBe(true);
  expect(run.resultJson.executionCancellation).toBeUndefined();
});

it.each([
  ["missing time", undefined],
  ["invalid time", "invalid"],
  ["before terminalization", "2026-10-15T23:09:11.526Z"],
  ["future time", "2999-01-01T00:00:00.000Z"],
])("rejects a settled startup receipt with %s", (_name, preparationSettledAt) => {
  const run = candidate();
  run.executionStage = "settled";
  run.resultJson = { executionRecovery: { kind: "bootstrap", providerWorkStarted: false, preparationSettledAt } };
  expect(hasSettledCancelledLegacyStartupReceipt(run)).toBe(false);
});

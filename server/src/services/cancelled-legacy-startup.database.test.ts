import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  agents,
  budgetReservations,
  companies,
  costEvents,
  createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  environmentLeases,
  heartbeatRunEvents,
  heartbeatRuns,
  issues,
  issueRecoveryActions,
  nativeRunFinalizations,
  runUsageReceipts,
  type Db,
} from "@penclipai/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../__tests__/helpers/embedded-postgres.js";
import { settleHistoricalCancelledGrokStartup } from "./legacy-execution-recovery.js";

const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("historical cancelled Grok startup database proof", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-cancelled-legacy-startup");
    db = createDb(database.connectionString);
    await db.execute(sql`set client_min_messages = warning`);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => {
    await db?.$client.end();
    await database?.cleanup();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate table companies restart identity cascade`);
  });

  async function fixture() {
    const startedAt = new Date("2026-10-15T23:09:11.527Z");
    const requestedAt = new Date("2026-10-15T23:09:11.735Z");
    const finishedAt = new Date("2026-10-15T23:09:11.737Z");
    const [company] = await db.insert(companies).values({
      name: "Cancelled Grok proof", issuePrefix: `CG${randomUUID().slice(0, 4)}`,
    }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company.id, name: "Grok", role: "engineer", status: "paused",
      adapterType: "grok_local", adapterConfig: {}, runtimeConfig: {}, permissions: {},
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId: company.id, title: "Preserve blocked status", status: "blocked", assigneeAgentId: agent.id,
    }).returning();
    const [run] = await db.insert(heartbeatRuns).values({
      companyId: company.id, agentId: agent.id, issueId: issue.id, scopeKind: "issue",
      status: "cancelled", runtimeMode: "legacy", errorCode: "agent_paused",
      startedAt, finishedAt, executionStage: "preparing",
      controllerBootId: randomUUID(), controllerLeaseExpiresAt: new Date("2026-10-15T23:10:11.537Z"),
      contextSnapshot: { issueId: issue.id },
      runnerProfileJson: { adapterDispatch: { adapterType: "grok_local" } },
      usageJson: { ledgerScope: { kind: "company" } },
      resultJson: { startupCancellation: { requestedAt: requestedAt.toISOString(), beforeNativeSelection: false } },
    }).returning();
    await db.insert(issueRecoveryActions).values({
      companyId: company.id, sourceIssueId: issue.id, kind: "active_run_watchdog",
      status: "active", ownerType: "board", returnOwnerAgentId: agent.id,
      cause: "legacy_execution_requires_reconciliation", fingerprint: `legacy-execution:${run.id}`,
      evidence: { runId: run.id }, nextAction: "Inspect the stopped provider.", maxAttempts: 3,
    });
    // Lifecycle-only host evidence is allowed. All non-lifecycle evidence is denied.
    await db.insert(heartbeatRunEvents).values({
      companyId: company.id, agentId: agent.id, runId: run.id, seq: 1,
      eventType: "lifecycle", stream: "system", level: "info", message: "run started", payload: {},
    });
    return { company, agent, issue, run };
  }

  async function expectBlocked(f: Awaited<ReturnType<typeof fixture>>) {
    expect(await settleHistoricalCancelledGrokStartup(db, f.run)).toBeNull();
    expect(await db.select({ executionStage: heartbeatRuns.executionStage, resultJson: heartbeatRuns.resultJson })
      .from(heartbeatRuns).where(eq(heartbeatRuns.id, f.run.id))).toEqual([
      expect.objectContaining({ executionStage: "preparing" }),
    ]);
    expect(await db.select({ status: issueRecoveryActions.status, outcome: issueRecoveryActions.outcome })
      .from(issueRecoveryActions).where(and(eq(issueRecoveryActions.companyId, f.company.id), eq(issueRecoveryActions.sourceIssueId, f.issue.id))))
      .toEqual([{ status: "active", outcome: null }]);
  }

  it.each([
    ["released remote lease", { provider: "daytona", status: "released", releasedAt: new Date(), cleanupStatus: "success" }],
    ["released unknown-provider lease", { provider: null, status: "released", releasedAt: new Date(), cleanupStatus: "success" }],
    ["active local lease", { provider: "local", status: "active", releasedAt: null, cleanupStatus: null }],
    ["active local lease with released timestamp", { provider: "local", status: "active", releasedAt: new Date(), cleanupStatus: "success" }],
    ["retained local lease with released timestamp", { provider: "local", status: "retained", releasedAt: new Date(), cleanupStatus: "success" }],
    ["unknown local lease with released timestamp", { provider: "local", status: "unknown", releasedAt: new Date(), cleanupStatus: "success" }],
  ])("rejects %s", async (_name, lease) => {
    const f = await fixture();
    await db.insert(environmentLeases).values({ companyId: f.company.id, heartbeatRunId: f.run.id, leasePolicy: "ephemeral", ...lease });
    await expectBlocked(f);
  });

  it.each(["budget", "usage", "cost"] as const)("rejects persisted %s evidence", async kind => {
    const f = await fixture();
    if (kind === "budget") await db.insert(budgetReservations).values({ companyId: f.company.id, runId: f.run.id, amountCents: "0", state: "released" });
    if (kind === "usage") await db.insert(runUsageReceipts).values({ id: randomUUID(), companyId: f.company.id, runId: f.run.id, sourceId: randomUUID(), sequence: 1, receiptHash: "receipt", receiptJson: {}, complete: true, receivedAt: new Date() });
    if (kind === "cost") await db.insert(costEvents).values({ companyId: f.company.id, agentId: f.agent.id, heartbeatRunId: f.run.id, provider: "grok", model: "test", costCents: 0, occurredAt: new Date() });
    await expectBlocked(f);
  });

  it.each(["source-event", "unknown-event", "native-coordinator"] as const)("rejects %s evidence", async kind => {
    const f = await fixture();
    if (kind === "source-event") await db.insert(heartbeatRunEvents).values({ companyId: f.company.id, agentId: f.agent.id, runId: f.run.id, seq: 2, eventType: "lifecycle", stream: "system", level: "info", message: "external", payload: {}, sourceEventId: "external-event" });
    if (kind === "unknown-event") await db.insert(heartbeatRunEvents).values({ companyId: f.company.id, agentId: f.agent.id, runId: f.run.id, seq: 2, eventType: "adapter.invoke", stream: "system", level: "info", message: "invoke", payload: {} });
    if (kind === "native-coordinator") {
      // The coordinator foreign key itself requires a native issue binding;
      // this paired write models the contradictory native ownership evidence.
      await db.update(heartbeatRuns).set({ nativeIssueId: f.issue.id }).where(eq(heartbeatRuns.id, f.run.id));
      await db.insert(nativeRunFinalizations).values({ companyId: f.company.id, issueId: f.issue.id, runId: f.run.id, phase: "observed", controllerGeneration: 0 });
    }
    await expectBlocked(f);
  });

  it("does not let an unrelated company evidence block the positive receipt", async () => {
    const f = await fixture();
    const [other] = await db.insert(companies).values({ name: "Other", issuePrefix: `OT${randomUUID().slice(0, 4)}` }).returning();
    const [otherAgent] = await db.insert(agents).values({ companyId: other.id, name: "Other agent", role: "engineer", status: "idle", adapterType: "grok_local", adapterConfig: {}, runtimeConfig: {}, permissions: {} }).returning();
    await db.insert(costEvents).values({ companyId: other.id, agentId: otherAgent.id, heartbeatRunId: f.run.id, provider: "grok", model: "test", costCents: 0, occurredAt: new Date() });
    const settled = await settleHistoricalCancelledGrokStartup(db, f.run);
    expect(settled).toMatchObject({ status: "cancelled", executionStage: "settled", resultJson: { executionRecovery: { kind: "bootstrap", providerWorkStarted: false } } });
    expect(await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.agentId, f.agent.id))).toHaveLength(1);
    expect(await db.select({ status: issueRecoveryActions.status, outcome: issueRecoveryActions.outcome })
      .from(issueRecoveryActions).where(eq(issueRecoveryActions.sourceIssueId, f.issue.id))).toEqual([{ status: "resolved", outcome: "false_positive" }]);
    expect((await db.select().from(issues).where(eq(issues.id, f.issue.id)))[0]?.status).toBe("blocked");
  });

  it("accepts an explicitly released local lease", async () => {
    const f = await fixture();
    await db.insert(environmentLeases).values({ companyId: f.company.id, heartbeatRunId: f.run.id, provider: "local", status: "released", releasedAt: new Date(), cleanupStatus: "success" });
    expect(await settleHistoricalCancelledGrokStartup(db, f.run)).toMatchObject({ status: "cancelled", executionStage: "settled" });
  });
});

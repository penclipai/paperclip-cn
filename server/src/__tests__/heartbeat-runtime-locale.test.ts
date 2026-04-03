import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  agentRuntimeState,
  agentWakeupRequests,
  companies,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  instanceSettings,
} from "@penclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
const EMBEDDED_POSTGRES_TIMEOUT = process.platform === "win32" ? 60_000 : 20_000;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres heartbeat runtime locale tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat runtime locale materialization", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-runtime-locale-");
    db = createDb(tempDb.connectionString);
  }, EMBEDDED_POSTGRES_TIMEOUT);

  afterEach(async () => {
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agentRuntimeState);
    await db.delete(instanceSettings);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedAgentFixture(input?: { agentStatus?: "idle" | "running" }) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issuePrefix = `L${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Locale Agent",
      role: "engineer",
      status: input?.agentStatus ?? "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    return { companyId, agentId };
  }

  async function setRuntimeDefaultLocale(locale: "zh-CN" | "en") {
    await db.insert(instanceSettings).values({
      singletonKey: "default",
      general: { runtimeDefaultLocale: locale },
      experimental: {},
    });
  }

  async function seedRun(input: {
    companyId: string;
    agentId: string;
    status: "queued" | "running";
    contextSnapshot: Record<string, unknown>;
  }) {
    return db
      .insert(heartbeatRuns)
      .values({
        companyId: input.companyId,
        agentId: input.agentId,
        invocationSource: "on_demand",
        triggerDetail: "manual",
        status: input.status,
        contextSnapshot: input.contextSnapshot,
      })
      .returning()
      .then((rows) => rows[0]!);
  }

  it("materializes the instance default locale for system-triggered wakes without an explicit request locale", async () => {
    const { companyId, agentId } = await seedAgentFixture({ agentStatus: "running" });
    await setRuntimeDefaultLocale("en");
    await seedRun({
      companyId,
      agentId,
      status: "running",
      contextSnapshot: { taskKey: "busy-task", runtimeUiLocale: "zh-CN" },
    });

    const heartbeat = heartbeatService(db);
    const run = await heartbeat.wakeup(agentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "plugin.invoke",
      contextSnapshot: {
        taskKey: "fresh-task",
      },
      requestedByActorType: "system",
      requestedByActorId: "plugin-worker",
    });

    expect(run).not.toBeNull();
    const stored = await heartbeat.getRun(run!.id);
    expect((stored?.contextSnapshot as Record<string, unknown> | null)?.runtimeUiLocale).toBe("en");
    expect((stored?.contextSnapshot as Record<string, unknown> | null)?.requestedUiLocale).toBeUndefined();
  });

  it("recomputes queued run locale from the latest wake when no explicit locale was requested", async () => {
    const { companyId, agentId } = await seedAgentFixture();
    await setRuntimeDefaultLocale("en");
    const queuedRun = await seedRun({
      companyId,
      agentId,
      status: "queued",
      contextSnapshot: {
        taskKey: "same-task",
        runtimeUiLocale: "zh-CN",
      },
    });

    const heartbeat = heartbeatService(db);
    const run = await heartbeat.wakeup(agentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "plugin.invoke",
      contextSnapshot: {
        taskKey: "same-task",
      },
      requestedByActorType: "system",
      requestedByActorId: "plugin-worker",
    });

    expect(run?.id).toBe(queuedRun.id);
    const stored = await heartbeat.getRun(queuedRun.id);
    expect((stored?.contextSnapshot as Record<string, unknown> | null)?.runtimeUiLocale).toBe("en");
    expect((stored?.contextSnapshot as Record<string, unknown> | null)?.requestedUiLocale).toBeUndefined();
  });

  it("does not coalesce a running run when the new wake resolves to a different runtime locale", async () => {
    const { companyId, agentId } = await seedAgentFixture({ agentStatus: "running" });
    await setRuntimeDefaultLocale("zh-CN");
    const runningRun = await seedRun({
      companyId,
      agentId,
      status: "running",
      contextSnapshot: {
        taskKey: "same-task",
        runtimeUiLocale: "zh-CN",
      },
    });

    const heartbeat = heartbeatService(db);
    const run = await heartbeat.wakeup(agentId, {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "manual",
      contextSnapshot: {
        taskKey: "same-task",
        requestedUiLocale: "en",
      },
      requestedByActorType: "user",
      requestedByActorId: "board-user",
    });

    expect(run).not.toBeNull();
    expect(run?.id).not.toBe(runningRun.id);
    const runs = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.agentId, agentId));
    expect(runs).toHaveLength(2);
    const queuedRun = runs.find((candidate) => candidate.id !== runningRun.id);
    expect(queuedRun?.status).toBe("queued");
    expect((queuedRun?.contextSnapshot as Record<string, unknown> | null)?.runtimeUiLocale).toBe("en");
  });

  it("still coalesces a running run when the resolved runtime locale matches", async () => {
    const { companyId, agentId } = await seedAgentFixture({ agentStatus: "running" });
    await setRuntimeDefaultLocale("zh-CN");
    const runningRun = await seedRun({
      companyId,
      agentId,
      status: "running",
      contextSnapshot: {
        taskKey: "same-task",
        runtimeUiLocale: "zh-CN",
      },
    });

    const heartbeat = heartbeatService(db);
    const run = await heartbeat.wakeup(agentId, {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "manual",
      contextSnapshot: {
        taskKey: "same-task",
        requestedUiLocale: "zh-CN",
      },
      requestedByActorType: "user",
      requestedByActorId: "board-user",
    });

    expect(run?.id).toBe(runningRun.id);
    const runs = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.agentId, agentId));
    expect(runs).toHaveLength(1);
  });
});

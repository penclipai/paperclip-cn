import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agentWakeupRequests,
  agents,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  heartbeatRuns,
} from "@penclipai/db";
import { heartbeatService } from "../services/heartbeat.ts";
import { instanceSettingsService } from "../services/instance-settings.ts";
import { injectPaperclipRuntimePromptLayersIntoContext } from "../adapters/prompt-context.ts";
import { registerServerAdapter, unregisterServerAdapter } from "../adapters/index.ts";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { truncateTablesWithDeadlockRetry } from "./helpers/truncate-with-deadlock-retry.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
const TEST_ADAPTER_TYPE = "runtime_locale_capture";

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres heartbeat runtime locale tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

async function waitForRunToFinish(
  heartbeat: ReturnType<typeof heartbeatService>,
  runId: string,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await heartbeat.getRun(runId);
    if (run && !["queued", "running"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return await heartbeat.getRun(runId);
}

describeEmbeddedPostgres("heartbeat runtime locale service integration", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let oldPaperclipHome: string | undefined;
  let paperclipHome: string | null = null;
  const rawAdapterContexts: Record<string, unknown>[] = [];
  const finalAdapterContexts: Record<string, unknown>[] = [];
  const runIdsToDrain = new Set<string>();

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("heartbeat-runtime-locale-");
    db = createDb(tempDb.connectionString);
    oldPaperclipHome = process.env.PAPERCLIP_HOME;
    paperclipHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-runtime-locale-home-"));
    process.env.PAPERCLIP_HOME = paperclipHome;
    registerServerAdapter({
      type: TEST_ADAPTER_TYPE,
      execute: async (ctx) => {
        rawAdapterContexts.push(ctx.context);
        finalAdapterContexts.push(injectPaperclipRuntimePromptLayersIntoContext(ctx.context));
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          label: "Captured runtime locale",
        };
      },
      testEnvironment: async () => ({
        adapterType: TEST_ADAPTER_TYPE,
        status: "pass",
        checks: [],
        testedAt: new Date().toISOString(),
      }),
    });
  }, 20_000);

  afterEach(async () => {
    await Promise.all([...runIdsToDrain].map(runId => heartbeatService(db).waitForRunExecutionDrain(runId)));
    runIdsToDrain.clear();
    rawAdapterContexts.length = 0;
    finalAdapterContexts.length = 0;
    await truncateTablesWithDeadlockRetry(db, `
      TRUNCATE TABLE
        "activity_log",
        "heartbeat_run_events",
        "heartbeat_runs",
        "agent_wakeup_requests",
        "agent_runtime_state",
        "agents",
        "companies",
        "user",
        "instance_settings"
      RESTART IDENTITY CASCADE
    `);
  });

  afterAll(async () => {
    unregisterServerAdapter(TEST_ADAPTER_TYPE);
    if (oldPaperclipHome === undefined) delete process.env.PAPERCLIP_HOME;
    else process.env.PAPERCLIP_HOME = oldPaperclipHome;
    if (paperclipHome) {
      await fs.rm(paperclipHome, { recursive: true, force: true });
    }
    await tempDb?.cleanup();
  });

  async function seedAgent() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const responsibleUserId = `responsible-${randomUUID()}`;
    const now = new Date();
    await db.insert(authUsers).values({
      id: responsibleUserId,
      name: "Runtime Locale Owner",
      email: `${responsibleUserId}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: responsibleUserId,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: responsibleUserId,
      membershipRole: "owner",
      status: "active",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Runtime Locale",
      role: "engineer",
      status: "idle",
      adapterType: TEST_ADAPTER_TYPE,
      adapterConfig: {},
      runtimeConfig: { maxConcurrentRuns: 1 },
      permissions: {},
    });
    return { companyId, agentId, responsibleUserId };
  }

  it("uses the instance runtime default locale when the wakeup has no explicit locale", async () => {
    await instanceSettingsService(db).updateGeneral({ runtimeDefaultLocale: "en" });
    const { agentId } = await seedAgent();
    const heartbeat = heartbeatService(db);

    const run = await heartbeat.wakeup(agentId, {
      source: "on_demand",
      triggerDetail: "manual",
      contextSnapshot: {},
    });

    expect(run).not.toBeNull();
    runIdsToDrain.add(run!.id);
    const finished = await waitForRunToFinish(heartbeat, run!.id);
    expect(finished?.status).toBe("succeeded");
    expect(finished?.contextSnapshot).toMatchObject({ runtimeUiLocale: "en" });
    expect(finished?.contextSnapshot).not.toHaveProperty("requestedUiLocale");

    expect(rawAdapterContexts[0]?.paperclipLocalizationPromptMarkdown).toContain("Respond to users in English");
    expect(finalAdapterContexts[0]?.paperclipSessionHandoffMarkdown).toContain("## Paperclip Runtime Rules");
    expect(finalAdapterContexts[0]?.paperclipSessionHandoffMarkdown).toContain("Respond to users in English");
    expect(finalAdapterContexts[0]).not.toHaveProperty("paperclipLocalizationPromptMarkdown");
  });

  it("lets an explicit request locale override the instance default and strips request-scoped state", async () => {
    await instanceSettingsService(db).updateGeneral({ runtimeDefaultLocale: "zh-CN" });
    const { agentId } = await seedAgent();
    const heartbeat = heartbeatService(db);

    const run = await heartbeat.wakeup(agentId, {
      source: "on_demand",
      triggerDetail: "manual",
      contextSnapshot: { requestedUiLocale: "en-US" },
    });

    expect(run).not.toBeNull();
    runIdsToDrain.add(run!.id);
    const finished = await waitForRunToFinish(heartbeat, run!.id);
    expect(finished?.status).toBe("succeeded");
    expect(finished?.contextSnapshot).toMatchObject({ runtimeUiLocale: "en" });
    expect(finished?.contextSnapshot).not.toHaveProperty("requestedUiLocale");
    expect(finalAdapterContexts[0]?.paperclipSessionHandoffMarkdown).toContain("Respond to users in English");
  });

  it("does not coalesce an incoming wakeup into a running run with a different runtime locale", async () => {
    const { companyId, agentId, responsibleUserId } = await seedAgent();
    const heartbeat = heartbeatService(db);
    const wakeupRequestId = randomUUID();
    const runningRunId = randomUUID();
    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      companyId,
      agentId,
      source: "on_demand",
      triggerDetail: "manual",
      status: "claimed",
      runId: runningRunId,
      claimedAt: new Date(),
    });
    await db.insert(heartbeatRuns).values({
      id: runningRunId,
      companyId,
      agentId,
      invocationSource: "on_demand",
      triggerDetail: "manual",
      status: "running",
      wakeupRequestId,
      responsibleUserId,
      startedAt: new Date(),
      contextSnapshot: {
        taskKey: "same-task",
        runtimeUiLocale: "zh-CN",
      },
    });

    const nextRun = await heartbeat.wakeup(agentId, {
      source: "on_demand",
      triggerDetail: "manual",
      contextSnapshot: {
        taskKey: "same-task",
        requestedUiLocale: "en",
      },
    });

    expect(nextRun).not.toBeNull();
    expect(nextRun!.id).not.toBe(runningRunId);
    expect(nextRun!.status).toBe("queued");
    expect(nextRun!.contextSnapshot).toMatchObject({
      taskKey: "same-task",
      runtimeUiLocale: "en",
    });
    expect(nextRun!.contextSnapshot).not.toHaveProperty("requestedUiLocale");

    const [existingRun] = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runningRunId));
    expect(existingRun?.contextSnapshot).toMatchObject({
      taskKey: "same-task",
      runtimeUiLocale: "zh-CN",
    });
  });
});

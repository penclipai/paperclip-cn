import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/index.js";

const agentId = "11111111-1111-4111-8111-111111111111";

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  resolveByReference: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  invoke: vi.fn(),
  wakeup: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../services/index.js", () => ({
  agentService: () => mockAgentService,
  agentInstructionsService: () => ({}),
  accessService: () => ({
    canUser: vi.fn(),
    hasPermission: vi.fn(),
    getMembership: vi.fn(),
    listPrincipalGrants: vi.fn(),
    ensureMembership: vi.fn(),
    setPrincipalPermission: vi.fn(),
  }),
  approvalService: () => ({}),
  companySkillService: () => ({
    listRuntimeSkillEntries: vi.fn(async () => []),
    resolveRequestedSkillKeys: vi.fn(async (_companyId: string, requested: string[]) => requested),
  }),
  budgetService: () => ({}),
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => ({}),
  issueService: () => ({}),
  logActivity: mockLogActivity,
  secretService: () => ({
    normalizeAdapterConfigForPersistence: vi.fn(async (_companyId: string, config: Record<string, unknown>) => config),
    resolveAdapterConfigForRuntime: vi.fn(async (_companyId: string, config: Record<string, unknown>) => ({ config })),
  }),
  syncInstructionsBundleConfigFromFilePath: vi.fn((_agent, config) => config),
  workspaceOperationService: () => ({}),
}));

vi.mock("../adapters/index.js", () => ({
  findServerAdapter: vi.fn(),
  listAdapterModels: vi.fn(),
  detectAdapterModel: vi.fn(),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", agentRoutes({} as any));
  app.use(errorHandler);
  return app;
}

function makeAgent() {
  return {
    id: agentId,
    companyId: "company-1",
    name: "Agent",
    role: "engineer",
    title: "Engineer",
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    permissions: null,
    updatedAt: new Date(),
  };
}

describe("agent heartbeat locale routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentService.getById.mockResolvedValue(makeAgent());
    mockHeartbeatService.invoke.mockResolvedValue({ id: "run-1" });
    mockHeartbeatService.wakeup.mockResolvedValue({ id: "run-2" });
  });

  it("threads explicit request locale into manual heartbeat invoke runs", async () => {
    const res = await request(createApp())
      .post(`/api/agents/${agentId}/heartbeat/invoke`)
      .set("Accept-Language", "zh-CN,zh;q=0.9")
      .send({});

    expect(res.status).toBe(202);
    expect(mockHeartbeatService.invoke).toHaveBeenCalledWith(
      agentId,
      "on_demand",
      expect.objectContaining({
        triggeredBy: "board",
        actorId: "local-board",
        requestedUiLocale: "zh-CN",
      }),
      "manual",
      {
        actorType: "user",
        actorId: "local-board",
      },
    );
  });

  it("keeps manual wakeups neutral when no supported locale was requested", async () => {
    const res = await request(createApp())
      .post(`/api/agents/${agentId}/wakeup`)
      .send({ forceFreshSession: true });

    expect(res.status).toBe(202);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      agentId,
      expect.objectContaining({
        contextSnapshot: expect.objectContaining({
          triggeredBy: "board",
          actorId: "local-board",
          forceFreshSession: true,
        }),
      }),
    );
    const wakeupArgs = mockHeartbeatService.wakeup.mock.calls[0]?.[1];
    expect(wakeupArgs?.contextSnapshot).not.toHaveProperty("requestedUiLocale");
  });
});

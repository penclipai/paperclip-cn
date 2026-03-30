import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";

const issueId = "11111111-1111-4111-8111-111111111111";
const assigneeAgentId = "22222222-2222-4222-8222-222222222222";

const mockIssueService = vi.hoisted(() => ({
  create: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(async () => undefined),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    canUser: vi.fn(),
    hasPermission: vi.fn(),
  }),
  agentService: () => ({
    getById: vi.fn(),
  }),
  documentService: () => ({}),
  executionWorkspaceService: () => ({}),
  goalService: () => ({}),
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  logActivity: mockLogActivity,
  projectService: () => ({}),
  routineService: () => ({
    syncRunStatusForIssue: vi.fn(async () => undefined),
  }),
  workProductService: () => ({}),
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
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

function makeIssue(status: "todo" | "backlog" = "todo") {
  return {
    id: issueId,
    companyId: "company-1",
    identifier: "PAP-1",
    title: "Localize wakeups",
    description: null,
    status,
    priority: "medium",
    assigneeAgentId,
    assigneeUserId: null,
    createdByAgentId: null,
    createdByUserId: "local-board",
    updatedAt: new Date(),
  };
}

describe("issue wakeup request locale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueService.create.mockResolvedValue(makeIssue("todo"));
  });

  it("stores the explicit request locale on issue-assignment wakeups", async () => {
    const res = await request(createApp())
      .post("/api/companies/company-1/issues")
      .set("Accept-Language", "en-US,en;q=0.9")
      .send({
        title: "Localize heartbeat run",
        status: "todo",
        assigneeAgentId,
      });

    expect(res.status).toBe(201);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      assigneeAgentId,
      expect.objectContaining({
        contextSnapshot: expect.objectContaining({
          issueId,
          source: "issue.create",
          requestedUiLocale: "en",
        }),
      }),
    );
  });

  it("leaves issue-assignment wakeups neutral when the request has no locale header", async () => {
    const res = await request(createApp())
      .post("/api/companies/company-1/issues")
      .send({
        title: "Neutral heartbeat run",
        status: "todo",
        assigneeAgentId,
      });

    expect(res.status).toBe(201);
    const wakeupArgs = mockHeartbeatService.wakeup.mock.calls[0]?.[1];
    expect(wakeupArgs?.contextSnapshot).not.toHaveProperty("requestedUiLocale");
  });
});

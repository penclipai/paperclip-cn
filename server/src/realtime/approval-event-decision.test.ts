import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { decideApprovalEvent } from "./approval-event-decision.js";

vi.mock("../services/authorization.js", () => ({
  approvalReadSqlCondition: async () => sql`true`,
}));

function event(entityId: string) {
  return {
    id: 1,
    companyId: randomUUID(),
    type: "activity.logged" as const,
    createdAt: new Date().toISOString(),
    payload: { action: "approval.created", entityType: "approval", entityId },
  };
}

function database(rows: Array<{ id: string; status: string }>) {
  const query = {
    from: () => query,
    where: () => query,
    limit: async () => rows,
  };
  return { select: () => query };
}

describe("decideApprovalEvent", () => {
  it("fails closed when the approval row is missing or outside the event company", async () => {
    const decision = await decideApprovalEvent(database([]) as never, event(randomUUID()), {
      type: "board", userId: "local-board", source: "local_implicit",
    });

    expect(decision).toEqual({ visible: false, toastEligible: false });
  });

  it("does not make an authorized agent eligible for a pending approval notification", async () => {
    const decision = await decideApprovalEvent(database([{ id: randomUUID(), status: "pending" }]) as never, event(randomUUID()), {
      type: "agent", agentId: randomUUID(), companyId: randomUUID(), source: "agent_key",
    });

    expect(decision).toEqual({ visible: true, toastEligible: false });
  });
});

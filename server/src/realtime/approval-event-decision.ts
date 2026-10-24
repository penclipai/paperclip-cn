import { and, eq } from "drizzle-orm";
import { approvals, type Db } from "@penclipai/db";
import type { LiveEvent } from "@penclipai/shared";
import { approvalReadSqlCondition, type AuthorizationActor } from "../services/authorization.js";

export function isApprovalCreatedEvent(event: LiveEvent): boolean {
  return event.type === "activity.logged"
    && event.payload.action === "approval.created"
    && event.payload.entityType === "approval"
    && typeof event.payload.entityId === "string";
}

/**
 * Approval activity can reference task-derived data. Recheck its row and
 * privacy predicate at delivery time rather than trusting the event payload.
 */
export async function decideApprovalEvent(
  db: Db,
  event: LiveEvent,
  actor: AuthorizationActor,
): Promise<{ visible: boolean; toastEligible: boolean }> {
  if (!isApprovalCreatedEvent(event)) return { visible: true, toastEligible: false };
  const approvalId = event.payload.entityId;
  if (typeof approvalId !== "string") return { visible: false, toastEligible: false };

  const [approval] = await db
    .select({ id: approvals.id, status: approvals.status })
    .from(approvals)
    .where(and(
      eq(approvals.id, approvalId),
      eq(approvals.companyId, event.companyId),
      await approvalReadSqlCondition(db, actor),
    ))
    .limit(1);

  if (!approval) return { visible: false, toastEligible: false };
  return {
    visible: true,
    // Agents can receive an authorized cache invalidation, but only a board
    // viewer may be prompted to decide an approval.
    toastEligible: actor.type === "board" && approval.status === "pending",
  };
}

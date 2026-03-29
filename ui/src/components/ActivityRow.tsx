import { useTranslation } from "react-i18next";
import { Link } from "@/lib/router";
import { Identity } from "./Identity";
import { timeAgo } from "../lib/timeAgo";
import { cn } from "../lib/utils";
import { deriveProjectUrlKey, type ActivityEvent, type Agent } from "@penclipai/shared";
import { translateEntityTypeLabel, translatePriorityLabel, translateStatusLabel } from "../lib/i18n-labels";
import { displaySeededName } from "../lib/seeded-display";

const ACTION_VERBS: Record<string, string> = {
  "issue.created": "created",
  "issue.updated": "updated",
  "issue.checked_out": "checked out",
  "issue.released": "released",
  "issue.comment_added": "commented on",
  "issue.attachment_added": "attached file to",
  "issue.attachment_removed": "removed attachment from",
  "issue.document_created": "created document for",
  "issue.document_updated": "updated document on",
  "issue.document_deleted": "deleted document from",
  "issue.read_marked": "marked as read",
  "issue.commented": "commented on",
  "issue.deleted": "deleted",
  "agent.created": "created",
  "agent.updated": "updated",
  "agent.paused": "paused",
  "agent.resumed": "resumed",
  "agent.terminated": "terminated",
  "agent.key_created": "created API key for",
  "agent.budget_updated": "updated budget for",
  "agent.runtime_session_reset": "reset session for",
  "heartbeat.invoked": "invoked heartbeat for",
  "heartbeat.cancelled": "cancelled heartbeat for",
  "approval.created": "requested approval",
  "approval.approved": "approved",
  "approval.rejected": "rejected",
  "approval.revision_requested": "requested revisions on",
  "approval.resubmitted": "resubmitted",
  "approval.comment_added": "commented on",
  "approval.requester_wakeup_queued": "queued requester wake-up for",
  "approval.requester_wakeup_failed": "failed requester wake-up for",
  "project.created": "created",
  "project.updated": "updated",
  "project.deleted": "deleted",
  "invite.created": "created invite",
  "invite.openclaw_prompt_created": "created OpenClaw invite prompt",
  "goal.created": "created",
  "goal.updated": "updated",
  "goal.deleted": "deleted",
  "routine.created": "created",
  "routine.updated": "updated",
  "routine.run_triggered": "triggered run for",
  "routine.trigger_created": "created trigger for",
  "routine.trigger_updated": "updated trigger for",
  "routine.trigger_deleted": "deleted trigger for",
  "routine.trigger_secret_rotated": "rotated trigger secret for",
  "cost.reported": "reported cost for",
  "cost.recorded": "recorded cost for",
  "company.created": "created company",
  "company.updated": "updated company",
  "company.archived": "archived",
  "company.budget_updated": "updated budget for",
  "agent.hire_created": "created hire request for",
  "issue.approval_linked": "linked approval to",
};

function humanizeValue(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "none");
  return value.replace(/_/g, " ");
}

function formatVerb(action: string, details?: Record<string, unknown> | null): string {
  if (action === "issue.updated" && details) {
    const previous = (details._previous ?? {}) as Record<string, unknown>;
    if (details.status !== undefined) {
      const from = previous.status;
      return from
        ? `changed status from ${humanizeValue(from)} to ${humanizeValue(details.status)} on`
        : `changed status to ${humanizeValue(details.status)} on`;
    }
    if (details.priority !== undefined) {
      const from = previous.priority;
      return from
        ? `changed priority from ${humanizeValue(from)} to ${humanizeValue(details.priority)} on`
        : `changed priority to ${humanizeValue(details.priority)} on`;
    }
  }
  return ACTION_VERBS[action] ?? action.replace(/[._]/g, " ");
}

function entityLink(entityType: string, entityId: string, name?: string | null): string | null {
  switch (entityType) {
    case "issue": return `/issues/${name ?? entityId}`;
    case "agent": return `/agents/${entityId}`;
    case "project": return `/projects/${deriveProjectUrlKey(name, entityId)}`;
    case "goal": return `/goals/${entityId}`;
    case "approval": return `/approvals/${entityId}`;
    default: return null;
  }
}

interface ActivityRowProps {
  event: ActivityEvent;
  agentMap: Map<string, Agent>;
  entityNameMap: Map<string, string>;
  entityTitleMap?: Map<string, string>;
  className?: string;
}

export function ActivityRow({ event, agentMap, entityNameMap, entityTitleMap, className }: ActivityRowProps) {
  const { t } = useTranslation();
  let verb = formatVerb(event.action, event.details);
  if (event.action === "issue.updated" && event.details) {
    const previous = (event.details._previous ?? {}) as Record<string, unknown>;
    if (event.details.status !== undefined) {
      const nextStatus = translateStatusLabel(t, String(event.details.status));
      const previousStatus = previous.status ? translateStatusLabel(t, String(previous.status)) : null;
      verb = previousStatus
        ? t("activity.changedStatusFromTo", {
            from: previousStatus,
            to: nextStatus,
            defaultValue: `Changed status from ${previousStatus} to ${nextStatus} on`,
          })
        : t("activity.changedStatusTo", {
            status: nextStatus,
            defaultValue: `Changed status to ${nextStatus} on`,
          });
    } else if (event.details.priority !== undefined) {
      const nextPriority = translatePriorityLabel(t, String(event.details.priority));
      const previousPriority = previous.priority ? translatePriorityLabel(t, String(previous.priority)) : null;
      verb = previousPriority
        ? t("activity.changedPriorityFromTo", {
            from: previousPriority,
            to: nextPriority,
            defaultValue: `Changed priority from ${previousPriority} to ${nextPriority} on`,
          })
        : t("activity.changedPriorityTo", {
            priority: nextPriority,
            defaultValue: `Changed priority to ${nextPriority} on`,
          });
    }
  } else {
    verb = t(verb, { defaultValue: verb });
  }

  const isHeartbeatEvent = event.entityType === "heartbeat_run";
  const heartbeatAgentId = isHeartbeatEvent
    ? (event.details as Record<string, unknown> | null)?.agentId as string | undefined
    : undefined;

  const name = isHeartbeatEvent
    ? (heartbeatAgentId ? entityNameMap.get(`agent:${heartbeatAgentId}`) : null)
    : entityNameMap.get(`${event.entityType}:${event.entityId}`);

  const entityTitle = entityTitleMap?.get(`${event.entityType}:${event.entityId}`);

  const link = isHeartbeatEvent && heartbeatAgentId
    ? `/agents/${heartbeatAgentId}/runs/${event.entityId}`
    : entityLink(event.entityType, event.entityId, name);

  const actor = event.actorType === "agent" ? agentMap.get(event.actorId) : null;
  const actorName = actor?.name
    ?? (event.actorType === "system"
      ? t("System", { defaultValue: "System" })
      : event.actorType === "user"
        ? t("Board", { defaultValue: "Board" })
        : event.actorId || t("Unknown", { defaultValue: "Unknown" }));
  const displayActorName = displaySeededName(actorName);
  const displayEntityName = displaySeededName(name);

  const inner = (
    <div className="flex gap-3">
      <p className="flex-1 min-w-0 truncate">
        <Identity
          name={displayActorName}
          size="xs"
          className="align-baseline"
        />
        <span className="text-muted-foreground ml-1">{verb} </span>
        <span className="font-medium">{displayEntityName || translateEntityTypeLabel(t, event.entityType)}</span>
        {entityTitle && <span className="text-muted-foreground ml-1">- {entityTitle}</span>}
      </p>
      <span className="text-xs text-muted-foreground shrink-0 pt-0.5">{timeAgo(event.createdAt)}</span>
    </div>
  );

  const classes = cn(
    "px-4 py-2 text-sm",
    link && "cursor-pointer hover:bg-accent/50 transition-colors",
    className,
  );

  if (link) {
    return (
      <Link to={link} className={cn(classes, "no-underline text-inherit block")}>
        {inner}
      </Link>
    );
  }

  return (
    <div className={classes}>
      {inner}
    </div>
  );
}

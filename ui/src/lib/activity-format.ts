import type { Agent } from "@penclipai/shared";
import { translateInstant } from "../i18n";
import type { CompanyUserProfile } from "./company-members";

type ActivityDetails = Record<string, unknown> | null | undefined;

type ActivityParticipant = {
  type: "agent" | "user";
  agentId?: string | null;
  userId?: string | null;
};

type ActivityIssueReference = {
  id?: string | null;
  identifier?: string | null;
  title?: string | null;
};

interface ActivityFormatOptions {
  agentMap?: Map<string, Agent>;
  userProfileMap?: Map<string, CompanyUserProfile>;
  currentUserId?: string | null;
}

const ACTIVITY_ROW_VERBS: Record<string, string> = {
  "issue.created": "created",
  "issue.updated": "updated",
  "issue.checked_out": "checked out",
  "issue.released": "released",
  "issue.comment_added": "commented on",
  "issue.comment_cancelled": "cancelled a queued comment on",
  "issue.comment_deleted": "deleted a comment on",
  "issue.attachment_added": "attached file to",
  "issue.attachment_removed": "removed attachment from",
  "issue.document_created": "created document for",
  "issue.document_updated": "updated document on",
  "issue.document_locked": "locked document on",
  "issue.document_unlocked": "unlocked document on",
  "issue.document_deleted": "deleted document from",
  "issue.monitor_scheduled": "scheduled monitor on",
  "issue.monitor_triggered": "triggered monitor for",
  "issue.monitor_cleared": "cleared monitor on",
  "issue.monitor_skipped": "skipped monitor for",
  "issue.monitor_exhausted": "exhausted monitor on",
  "issue.monitor_recovery_wake_queued": "queued monitor recovery for",
  "issue.monitor_recovery_issue_created": "created monitor recovery for",
  "issue.monitor_escalated_to_board": "escalated monitor for",
  "issue.commented": "commented on",
  "issue.deleted": "deleted",
  "issue.successful_run_handoff_required": "flagged missing next step on",
  "issue.successful_run_handoff_resolved": "recorded next step chosen on",
  "issue.successful_run_handoff_escalated": "escalated missing next step on",
  "issue.accepted_plan_decomposition_updated": "updated accepted-plan decomposition on",
  "issue.recovery_action_opened": "opened a recovery action on",
  "issue.recovery_action_resolved": "resolved the recovery action on",
  "issue.recovery_action_escalated": "escalated the recovery action on",
  "agent.created": "created",
  "agent.updated": "updated",
  "agent.paused": "paused",
  "agent.resumed": "resumed",
  "agent.error_cleared": "cleared error on",
  "agent.terminated": "terminated",
  "agent.key_created": "created API key for",
  "agent.budget_updated": "updated budget for",
  "agent.instructions_file_updated": "updated agent instructions file",
  "agent.runtime_session_reset": "reset session for",
  "auth.agent_jwt_run_header_mismatch": "recorded agent JWT run header mismatch",
  "built_in_agent.provisioned": "provisioned built-in agent",
  "built_in_agent.reset": "reset built-in agent",
  "heartbeat.invoked": "invoked heartbeat for",
  "heartbeat.cancelled": "cancelled heartbeat for",
  "heartbeat.output_stale_source_resolved": "system-folded stale run on",
  "heartbeat.output_stale_recovery_recursion_refused": "refused recovery-on-recovery for",
  "environment.lease_acquired": "acquired environment lease",
  "environment.lease_released": "released environment lease",
  "built_in_agent.routine_reconciled": "built-in agent routine reconciled",
  "built_in_agent.routine_reset": "reset built-in agent routine",
  "approval.created": "requested approval",
  "approval.approved": "approved",
  "approval.rejected": "rejected",
  "project.created": "created",
  "project.updated": "updated",
  "project.deleted": "deleted",
  "goal.created": "created",
  "goal.updated": "updated",
  "goal.deleted": "deleted",
  "cost.reported": "reported cost for",
  "cost.recorded": "recorded cost for",
  "company.created": "created company",
  "company.updated": "updated company",
  "company.archived": "archived",
  "company.reactivated": "reactivated",
  "company.budget_updated": "updated budget for",
  "company.skills_scanned": "scanned company skills",
  "instance.settings.experimental_updated": "updated experimental instance settings",
  "instance.settings.general_updated": "updated general instance settings",
  "issue.file_resource_content_read": "read issue file content on",
  "issue.file_resource_list": "listed issue files for",
  "issue.file_resource_resolve": "resolved issue file reference on",
  "issue.read_marked": "marked the issue as read",
  "issue.thread_interaction_accepted": "accepted a thread interaction on",
  "issue.thread_interaction_created": "created a thread interaction on",
  "plugin.installed": "installed plugin",
  "plugin.uninstalled": "uninstalled plugin",
  "resource_membership.starred": "starred",
  "resource_membership.unstarred": "unstarred",
  "audit.exported": "exported the agent audit log for",
};

const ISSUE_ACTIVITY_LABELS: Record<string, string> = {
  "issue.created": "created the issue",
  "issue.updated": "updated the issue",
  "issue.checked_out": "checked out the issue",
  "issue.released": "released the issue",
  "issue.comment_added": "added a comment",
  "issue.comment_cancelled": "cancelled a queued comment",
  "issue.comment_deleted": "deleted a comment",
  "issue.feedback_vote_saved": "saved feedback on an AI output",
  "issue.attachment_added": "added an attachment",
  "issue.attachment_removed": "removed an attachment",
  "issue.document_created": "created a document",
  "issue.document_updated": "updated a document",
  "issue.document_locked": "locked a document",
  "issue.document_unlocked": "unlocked a document",
  "issue.document_deleted": "deleted a document",
  "issue.file_resource_content_read": "read issue file content",
  "issue.file_resource_list": "listed issue files",
  "issue.file_resource_resolve": "resolved an issue file reference",
  "issue.monitor_scheduled": "scheduled a monitor",
  "issue.monitor_triggered": "triggered a monitor",
  "issue.monitor_cleared": "cleared a monitor",
  "issue.monitor_skipped": "skipped a monitor",
  "issue.monitor_exhausted": "exhausted a monitor",
  "issue.monitor_recovery_wake_queued": "queued a monitor recovery wake",
  "issue.monitor_recovery_issue_created": "created a monitor recovery issue",
  "issue.monitor_escalated_to_board": "escalated a monitor to the board",
  "issue.deleted": "deleted the issue",
  "issue.read_marked": "marked the issue as read",
  "issue.thread_interaction_accepted": "accepted a thread interaction",
  "issue.thread_interaction_created": "created a thread interaction",
  "issue.successful_run_handoff_required": "Run finished without a clear next step",
  "issue.successful_run_handoff_resolved": "Next step chosen",
  "issue.successful_run_handoff_escalated": "Run finished without a next step - recovery escalated",
  "issue.cross_issue_influence_cap_rejected": "hit the per-run cross-task write cap",
  "issue.cross_issue_influence_observed": "made a cross-task write",
  "issue.attribution_spoof_rejected": "tried to choose its own responsible user",
  "issue.recovery_action_opened": "Opened a source-scoped recovery action",
  "issue.recovery_action_resolved": "Resolved the recovery action",
  "issue.recovery_action_escalated": "Escalated the recovery action",
  "issue.accepted_plan_decomposition_updated": "updated the accepted-plan decomposition",
  "agent.created": "created an agent",
  "agent.updated": "updated the agent",
  "agent.paused": "paused the agent",
  "agent.resumed": "resumed the agent",
  "agent.error_cleared": "cleared the agent error",
  "agent.terminated": "terminated the agent",
  "heartbeat.invoked": "invoked a heartbeat",
  "heartbeat.cancelled": "cancelled a heartbeat",
  "heartbeat.output_stale_source_resolved": "System folded a stale run",
  "heartbeat.output_stale_recovery_recursion_refused": "Refused recovery-on-recovery escalation",
  "approval.created": "requested approval",
  "approval.approved": "approved",
  "approval.rejected": "rejected",
};

const STATUS_TRANSLATION_KEYS: Record<string, string> = {
  active: "status.active",
  backlog: "status.backlog",
  blocked: "status.blocked",
  cancelled: "status.cancelled",
  done: "status.done",
  in_progress: "status.inProgress",
  in_review: "status.inReview",
  planned: "status.planned",
  todo: "status.todo",
};

const PRIORITY_TRANSLATION_KEYS: Record<string, string> = {
  critical: "priority.critical",
  high: "priority.high",
  medium: "priority.medium",
  low: "priority.low",
};

function localize(key: string, options?: Record<string, string | number | boolean | null | undefined>): string {
  return translateInstant(key, { defaultValue: key, ...options });
}

function localizeActivityRow(action: string, fallback?: string): string {
  const defaultValue = fallback ?? ACTIVITY_ROW_VERBS[action] ?? action.replace(/[._]/g, " ");
  return localize(`activityFormat.row.${action}`, { defaultValue });
}

function localizeActivityAction(action: string, fallback?: string): string {
  const defaultValue = fallback ?? ISSUE_ACTIVITY_LABELS[action] ?? action.replace(/[._]/g, " ");
  return localize(`activityFormat.action.${action}`, { defaultValue });
}

function localizeActivityValue(value: unknown, kind: "status" | "priority"): string {
  const normalized = typeof value === "string" ? value : "";
  const key = (kind === "status" ? STATUS_TRANSLATION_KEYS : PRIORITY_TRANSLATION_KEYS)[normalized];
  return key ? localize(key) : localize(humanizeValue(value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function humanizeValue(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "none");
  return value.replace(/_/g, " ");
}

function isActivityParticipant(value: unknown): value is ActivityParticipant {
  const record = asRecord(value);
  if (!record) return false;
  return record.type === "agent" || record.type === "user";
}

function isActivityIssueReference(value: unknown): value is ActivityIssueReference {
  return asRecord(value) !== null;
}

function readParticipants(details: ActivityDetails, key: string): ActivityParticipant[] {
  const value = details?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter(isActivityParticipant);
}

function readIssueReferences(details: ActivityDetails, key: string): ActivityIssueReference[] {
  const value = details?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter(isActivityIssueReference);
}

function formatUserLabel(userId: string | null | undefined, options: ActivityFormatOptions = {}): string {
  if (!userId || userId === "local-board") return localize("activityFormat.board");
  if (options.currentUserId && userId === options.currentUserId) return localize("activityFormat.you");
  const profile = options.userProfileMap?.get(userId);
  if (profile) return profile.label;
  return localize("activityFormat.userLabel", { id: userId.slice(0, 5) });
}

function formatParticipantLabel(participant: ActivityParticipant, options: ActivityFormatOptions): string {
  if (participant.type === "agent") {
    const agentId = participant.agentId ?? "";
    return options.agentMap?.get(agentId)?.name ?? localize("activityFormat.agent");
  }
  return formatUserLabel(participant.userId, options);
}

function formatIssueReferenceLabel(reference: ActivityIssueReference): string {
  if (reference.identifier) return reference.identifier;
  if (reference.title) return reference.title;
  if (reference.id) return reference.id.slice(0, 8);
  return localize("activityFormat.task");
}

function formatChangedEntityLabel(
  singular: string,
  plural: string,
  labels: string[],
): string {
  if (labels.length <= 0) return localize(plural);
  if (labels.length === 1) {
    return localize("activityFormat.namedEntity", {
      entity: localize(singular),
      label: labels[0]!,
    });
  }
  return localize("activityFormat.countedEntity", {
    count: labels.length,
    entity: localize(plural),
  });
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function readStringArrayLength(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.filter((entry) => typeof entry === "string" && entry.length > 0).length;
}

function formatAcceptedPlanDecompositionDetail(details: ActivityDetails): string | null {
  if (!details) return null;
  const status = typeof details.status === "string" ? details.status : null;
  const requested = readNumber(details.requestedChildCount);
  const totalChildren = readStringArrayLength(details.childIssueIds);
  const newlyCreated = readStringArrayLength(details.newlyCreatedChildIssueIds);
  const reused = Math.max(0, totalChildren - newlyCreated);
  const parts: string[] = [];
  if (newlyCreated > 0) {
    parts.push(localize("activityFormat.decomposition.created", {
      count: newlyCreated,
    }));
  }
  if (reused > 0) {
    parts.push(localize("activityFormat.decomposition.reused", { count: reused }));
  }
  if (parts.length === 0 && requested !== null) {
    parts.push(localize("activityFormat.decomposition.requested", { count: requested }));
  }
  const summary = parts.length > 0 ? parts.join(", ") : null;
  if (status === "completed" && summary) {
    return localize("activityFormat.decomposition.completedWithSummary", { summary });
  }
  if (status === "completed") return localize("activityFormat.decomposition.completed");
  if (status === "in_flight" && summary) {
    return localize("activityFormat.decomposition.inFlightWithSummary", { summary });
  }
  return summary;
}

function formatIssueUpdatedVerb(details: ActivityDetails): string | null {
  if (!details) return null;
  const previous = asRecord(details._previous) ?? {};
  if (details.status !== undefined) {
    const from = previous.status;
    return from
      ? localize("activityFormat.changedStatusFromOn", {
        from: localizeActivityValue(from, "status"),
        to: localizeActivityValue(details.status, "status"),
      })
      : localize("activityFormat.changedStatusToOn", {
        status: localizeActivityValue(details.status, "status"),
      });
  }
  if (details.priority !== undefined) {
    const from = previous.priority;
    return from
      ? localize("activityFormat.changedPriorityFromOn", {
        from: localizeActivityValue(from, "priority"),
        to: localizeActivityValue(details.priority, "priority"),
      })
      : localize("activityFormat.changedPriorityToOn", {
        priority: localizeActivityValue(details.priority, "priority"),
      });
  }
  return null;
}

function formatAssigneeName(details: ActivityDetails, options: ActivityFormatOptions): string | null {
  if (!details) return null;
  const agentId = details.assigneeAgentId;
  const userId = details.assigneeUserId;
  if (typeof agentId === "string" && agentId) {
    return options.agentMap?.get(agentId)?.name ?? localize("activityFormat.agent");
  }
  if (typeof userId === "string" && userId) {
    return formatUserLabel(userId, options);
  }
  return null;
}

function formatIssueUpdatedAction(details: ActivityDetails, options: ActivityFormatOptions = {}): string | null {
  if (!details) return null;
  const previous = asRecord(details._previous) ?? {};
  const parts: string[] = [];

  if (details.status !== undefined) {
    const from = previous.status;
    parts.push(
      from
        ? localize("activityFormat.changedStatusFrom", {
          from: localizeActivityValue(from, "status"),
          to: localizeActivityValue(details.status, "status"),
        })
        : localize("activityFormat.changedStatusTo", {
          status: localizeActivityValue(details.status, "status"),
        }),
    );
  }
  if (details.priority !== undefined) {
    const from = previous.priority;
    parts.push(
      from
        ? localize("activityFormat.changedPriorityFrom", {
          from: localizeActivityValue(from, "priority"),
          to: localizeActivityValue(details.priority, "priority"),
        })
        : localize("activityFormat.changedPriorityTo", {
          priority: localizeActivityValue(details.priority, "priority"),
        }),
    );
  }
  if (details.assigneeAgentId !== undefined || details.assigneeUserId !== undefined) {
    const assigneeName = formatAssigneeName(details, options);
    parts.push(assigneeName
      ? localize("activityFormat.assigneeSet", { assignee: assigneeName })
      : localize("activityFormat.assigneeCleared"));
  }
  if (details.title !== undefined) parts.push(localize("activityFormat.titleUpdated"));
  if (details.description !== undefined) parts.push(localize("activityFormat.descriptionUpdated"));

  return parts.length > 0 ? parts.join(", ") : null;
}

function formatStructuredIssueChange(input: {
  action: string;
  details: ActivityDetails;
  options: ActivityFormatOptions;
  forIssueDetail: boolean;
}): string | null {
  const details = input.details;
  if (!details) return null;

  if (input.action === "issue.blockers_updated") {
    const added = readIssueReferences(details, "addedBlockedByIssues").map(formatIssueReferenceLabel);
    const removed = readIssueReferences(details, "removedBlockedByIssues").map(formatIssueReferenceLabel);
    if (added.length > 0 && removed.length === 0) {
      const changed = formatChangedEntityLabel("blocker", "blockers", added);
      return localize(input.forIssueDetail ? "activityFormat.added" : "activityFormat.addedTo", { changed });
    }
    if (removed.length > 0 && added.length === 0) {
      const changed = formatChangedEntityLabel("blocker", "blockers", removed);
      return localize(input.forIssueDetail ? "activityFormat.removed" : "activityFormat.removedFrom", { changed });
    }
    return localize(input.forIssueDetail ? "activityFormat.updatedLabel" : "activityFormat.updatedOn", {
      label: localize("activityFormat.blockers"),
    });
  }

  if (input.action === "issue.reviewers_updated" || input.action === "issue.approvers_updated") {
    const added = readParticipants(details, "addedParticipants").map((participant) => formatParticipantLabel(participant, input.options));
    const removed = readParticipants(details, "removedParticipants").map((participant) => formatParticipantLabel(participant, input.options));
    const singular = input.action === "issue.reviewers_updated" ? "activityFormat.reviewer" : "activityFormat.approver";
    const plural = input.action === "issue.reviewers_updated" ? "activityFormat.reviewers" : "activityFormat.approvers";
    if (added.length > 0 && removed.length === 0) {
      const changed = formatChangedEntityLabel(singular, plural, added);
      return localize(input.forIssueDetail ? "activityFormat.added" : "activityFormat.addedTo", { changed });
    }
    if (removed.length > 0 && added.length === 0) {
      const changed = formatChangedEntityLabel(singular, plural, removed);
      return localize(input.forIssueDetail ? "activityFormat.removed" : "activityFormat.removedFrom", { changed });
    }
    return localize(input.forIssueDetail ? "activityFormat.updatedLabel" : "activityFormat.updatedOn", {
      label: localize(plural),
    });
  }

  return null;
}

export function formatActivityVerb(
  action: string,
  details?: Record<string, unknown> | null,
  options: ActivityFormatOptions = {},
): string {
  if (action === "issue.updated") {
    const issueUpdatedVerb = formatIssueUpdatedVerb(details);
    if (issueUpdatedVerb) return issueUpdatedVerb;
  }

  const structuredChange = formatStructuredIssueChange({
    action,
    details,
    options,
    forIssueDetail: false,
  });
  if (structuredChange) return structuredChange;

  return localizeActivityRow(action);
}

export function formatIssueActivityAction(
  action: string,
  details?: Record<string, unknown> | null,
  options: ActivityFormatOptions = {},
): string {
  if (action === "issue.updated") {
    const issueUpdatedAction = formatIssueUpdatedAction(details, options);
    if (issueUpdatedAction) return issueUpdatedAction;
  }

  const structuredChange = formatStructuredIssueChange({
    action,
    details,
    options,
    forIssueDetail: true,
  });
  if (structuredChange) return structuredChange;

  if (action === "issue.accepted_plan_decomposition_updated") {
    const detail = formatAcceptedPlanDecompositionDetail(details);
    if (detail) return detail;
  }

  if (action.startsWith("issue.monitor_") && details) {
    const serviceName = typeof details.serviceName === "string" && details.serviceName.trim()
      ? details.serviceName.trim()
      : null;
    const base = localizeActivityAction(action);
    return serviceName ? localize("activityFormat.monitorForService", { base, serviceName }) : base;
  }

  if (
    (
      action === "issue.document_created" ||
      action === "issue.document_updated" ||
      action === "issue.document_locked" ||
      action === "issue.document_unlocked" ||
      action === "issue.document_deleted"
    ) &&
    details
  ) {
    const key = typeof details.key === "string" ? details.key : localize("activityFormat.document");
    const title = typeof details.title === "string" && details.title ? ` (${details.title})` : "";
    return localize("activityFormat.documentAction", {
      action: localizeActivityAction(action),
      key: `${key}${title}`,
    });
  }

  return localizeActivityAction(action);
}

import type { Agent } from "@penclipai/shared";
import { getCurrentLocale, translateInstant } from "@/i18n";
import type { CompanyUserProfile } from "./company-members";
import { formatReviewPolicyValue } from "./review-policy";

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
  "case.created": "created",
  "case.updated": "updated",
  "case.fields_changed": "updated details on",
  "case.status_changed": "changed status on",
  "case.issue_linked": "linked a task to",
  "case.issue_unlinked": "unlinked a task from",
  "case.child_linked": "linked a child to",
  "case.attachment_added": "attached a file to",
  "case.label_added": "added a label to",
  "case.label_removed": "removed a label from",
  "case.document_revised": "updated a document on",
  "case.handoff_requested": "requested a handoff for",
  "case.handoff_applied": "handed off",
  "case.handoff_delivered": "delivered a handoff for",
  "case.handoff_retry_requested": "retried a handoff for",
  "case.handoff_cancelled": "cancelled a handoff for",
  "case.handoff_completed": "completed",
  "issue.created": "created",
  "issue.updated": "updated",
  "issue.read_marked": "activity.issueRead",
  "issue.read_unmarked": "activityFormat.row.issue.read_unmarked",
  "issue.checked_out": "checked out",
  "issue.released": "released",
  "issue.comment_added": "commented on",
  "issue.comment_cancelled": "activityFormat.row.issue.comment_cancelled",
  "issue.queued_comment_edited": "activityFormat.row.issue.queued_comment_edited",
  "issue.queued_comments_reordered": "activityFormat.row.issue.queued_comments_reordered",
  "issue.queued_comment_discarded": "activityFormat.row.issue.queued_comment_discarded",
  "issue.comment_deleted": "activityFormat.row.issue.comment_deleted",
  "issue.attachment_added": "attached file to",
  "issue.attachment_removed": "removed attachment from",
  "issue.document_created": "created document for",
  "issue.document_updated": "updated document on",
  "issue.document_locked": "activityFormat.row.issue.document_locked",
  "issue.document_unlocked": "activityFormat.row.issue.document_unlocked",
  "issue.document_deleted": "deleted document from",
  "issue.work_product_created": "activity.issueWorkProductCreated",
  "issue.monitor_scheduled": "activityFormat.row.issue.monitor_scheduled",
  "issue.monitor_triggered": "activityFormat.row.issue.monitor_triggered",
  "issue.monitor_cleared": "activityFormat.row.issue.monitor_cleared",
  "issue.monitor_skipped": "activityFormat.row.issue.monitor_skipped",
  "issue.monitor_exhausted": "activityFormat.row.issue.monitor_exhausted",
  "issue.monitor_recovery_wake_queued": "activityFormat.row.issue.monitor_recovery_wake_queued",
  "issue.monitor_recovery_issue_created": "activityFormat.row.issue.monitor_recovery_issue_created",
  "issue.monitor_escalated_to_board": "activityFormat.row.issue.monitor_escalated_to_board",
  "issue.commented": "commented on",
  "issue.deleted": "deleted",
  "issue.successful_run_handoff_required": "activityFormat.row.issue.successful_run_handoff_required",
  "issue.successful_run_handoff_resolved": "activityFormat.row.issue.successful_run_handoff_resolved",
  "issue.successful_run_handoff_escalated": "activityFormat.row.issue.successful_run_handoff_escalated",
  "issue.accepted_plan_decomposition_updated": "updated accepted-plan decomposition on",
  "issue.recovery_action_opened": "opened a recovery action on",
  "issue.workspace_recovered": "recovered saved work for",
  "issue.workspace_recovery_requested": "requested workspace recovery for",
  "issue.recovery_action_resolved": "resolved the recovery action on",
  "issue.recovery_action_escalated": "escalated the recovery action on",
  "agent.created": "created",
  "agent.updated": "updated",
  "agent.paused": "paused",
  "agent.resumed": "resumed",
  "agent.error_cleared": "activityFormat.row.agent.error_cleared",
  "agent.terminated": "terminated",
  "agent.key_created": "created API key for",
  "agent.budget_updated": "updated budget for",
  "agent.runtime_session_reset": "reset session for",
  "heartbeat.invoked": "invoked heartbeat for",
  "heartbeat.cancelled": "cancelled heartbeat for",
  "heartbeat.output_stale_source_resolved": "activityFormat.row.heartbeat.output_stale_source_resolved",
  "heartbeat.output_stale_recovery_recursion_refused": "activityFormat.row.heartbeat.output_stale_recovery_recursion_refused",
  "approval.created": "requested approval",
  "approval.approved": "approved",
  "approval.rejected": "rejected",
  // Interaction outcomes (PAP-16506). An agent may now resolve one — including a
  // review of its own work — so these must read as outcomes in the feed instead
  // of falling through to the raw "issue thread interaction accepted" action id.
  // `details.interactionKind` sharpens the wording; see INTERACTION_OUTCOME_LABELS.
  "issue.thread_interaction_created": "asked for a decision on",
  "issue.thread_interaction_accepted": "accepted the request on",
  "issue.thread_interaction_rejected": "rejected the request on",
  "issue.thread_interaction_answered": "answered the request on",
  "issue.thread_interaction_withdrawn": "withdrew the request on",
  "issue.thread_interaction_cancelled": "cancelled the request on",
  "issue.thread_interaction_skipped": "skipped the request on",
  "issue.thread_interaction_dismissed": "deferred the request on",
  "issue.thread_interaction_expired": "expired the request on",
  "issue.thread_interaction_item_verdicts_submitted": "submitted verdicts on",
  "issue.stalled_review_decided": "recorded a review verdict on",
  "project.created": "created",
  "project.updated": "updated",
  "project.deleted": "deleted",
  "goal.created": "created",
  "goal.updated": "updated",
  "goal.deleted": "deleted",
  "routine.created": "activity.routineCreated",
  "routine.revision_created": "activity.routineRevisionCreated",
  "cost.reported": "reported cost for",
  "cost.recorded": "recorded cost for",
  "plugin.config.updated": "activityFormat.row.plugin.configUpdated",
  "plugin.disabled": "activityFormat.row.plugin.disabled",
  "plugin.enabled": "activityFormat.row.plugin.enabled",
  "plugin.installed": "activityFormat.row.plugin.installed",
  "plugin.local_folder.configured": "activityFormat.row.plugin.localFolderConfigured",
  "plugin.managed_agent.created": "activityFormat.row.plugin.managedAgentCreated",
  "plugin.managed_agent.pause_reason_backfilled": "activityFormat.row.plugin.managedAgentPauseReasonBackfilled",
  "plugin.managed_agent.relinked": "activityFormat.row.plugin.managedAgentRelinked",
  "plugin.managed_agent.reset": "activityFormat.row.plugin.managedAgentReset",
  "plugin.managed_routine.created": "activityFormat.row.plugin.managedRoutineCreated",
  "plugin.managed_routine.reset": "activityFormat.row.plugin.managedRoutineReset",
  "plugin.managed_routine.run_triggered": "activityFormat.row.plugin.managedRoutineRunTriggered",
  "plugin.managed_routine.updated": "activityFormat.row.plugin.managedRoutineUpdated",
  "plugin.managed_skill.reconciled": "activityFormat.row.plugin.managedSkillReconciled",
  "plugin.managed_skill.reset": "activityFormat.row.plugin.managedSkillReset",
  "plugin.uninstalled": "activityFormat.row.plugin.uninstalled",
  "plugin.upgraded": "activityFormat.row.plugin.upgraded",
  "provider_trace.capture_requested": "activity.providerTraceCaptureRequested",
  "provider_trace.metadata_listed": "activity.providerTraceMetadataListed",
  "provider_trace.redacted_viewed": "activity.providerTraceRedactedViewed",
  "provider_trace.workspace_diffs_reprojected": "activity.providerTraceWorkspaceDiffsReprojected",
  "provider_trace.frame_revealed": "activity.providerTraceFrameRevealed",
  "provider_trace.downloaded": "activity.providerTraceDownloaded",
  "provider_trace.deleted": "activity.providerTraceDeleted",
  "company.created": "created organization",
  "company.updated": "activityFormat.row.company.updatedOrganization",
  "company.archived": "archived",
  "company.reactivated": "activityFormat.row.company.reactivated",
  "company.budget_updated": "updated budget for",
  "audit.exported": "activityFormat.row.audit.exported",
  "tool_app.connected": "activityFormat.row.tool_app.connected",
  "tool_app.oauth_connected": "activityFormat.row.tool_app.oauth_connected",
  "tool_app.oauth_failed": "activityFormat.row.tool_app.oauth_failed",
  "tool_app.oauth_access_finalized": "activityFormat.row.tool_app.oauth_access_finalized",
  "tool_app.finished": "activityFormat.row.tool_app.finished",
  "tool_app.reconnected": "activityFormat.row.tool_app.reconnected",
  "tool_connection.created": "created",
  "tool_connection.updated": "updated",
  "tool_connection.archived": "activityFormat.row.tool_connection.archived",
  "tool_connection.catalog_refresh": "activityFormat.row.tool_connection.catalog_refresh",
  "tool_connection.installs_synced": "activityFormat.row.tool_connection.installs_synced",
  "tool_connection.install_access_extended": "activityFormat.row.tool_connection.install_access_extended",
  "tool_connection.grant_audience_replaced": "activityFormat.row.tool_connection.grant_audience_replaced",
  "tool_connection.grant_added": "activityFormat.row.tool_connection.grant_added",
  "tool_connection.grant_revoked": "activityFormat.row.tool_connection.grant_revoked",
  "tool_connection.grant_delegated": "activityFormat.row.tool_connection.grant_delegated",
  "tool_connection.grant_delegation_revoked": "activityFormat.row.tool_connection.grant_delegation_revoked",
};

const ISSUE_ACTIVITY_LABELS: Record<string, string> = {
  "issue.created": "created the issue",
  "issue.updated": "updated the issue",
  "issue.checked_out": "checked out the issue",
  "issue.released": "released the issue",
  "issue.comment_added": "added a comment",
  "issue.comment_cancelled": "cancelled a queued comment",
  "issue.queued_comment_edited": "edited a queued comment",
  "issue.queued_comments_reordered": "reordered queued comments",
  "issue.queued_comment_discarded": "discarded a queued comment",
  "issue.comment_deleted": "deleted a comment",
  "issue.feedback_vote_saved": "saved feedback on an AI output",
  "issue.attachment_added": "added an attachment",
  "issue.attachment_removed": "removed an attachment",
  "issue.document_created": "created a document",
  "issue.document_updated": "updated a document",
  "issue.document_locked": "locked a document",
  "issue.document_unlocked": "unlocked a document",
  "issue.document_deleted": "deleted a document",
  "issue.monitor_scheduled": "scheduled a monitor",
  "issue.monitor_triggered": "triggered a monitor",
  "issue.monitor_cleared": "cleared a monitor",
  "issue.monitor_skipped": "skipped a monitor",
  "issue.monitor_exhausted": "exhausted a monitor",
  "issue.monitor_recovery_wake_queued": "queued a monitor recovery wake",
  "issue.monitor_recovery_issue_created": "created a monitor recovery issue",
  "issue.monitor_escalated_to_board": "escalated a monitor to the board",
  "issue.deleted": "deleted the issue",
  "issue.successful_run_handoff_required": "Run finished without a clear next step",
  "issue.successful_run_handoff_resolved": "Next step chosen",
  "issue.successful_run_handoff_escalated": "Run finished without a next step - recovery escalated",
  "issue.cross_issue_influence_cap_rejected": "hit the per-run cross-task write cap",
  "issue.cross_issue_influence_observed": "made a cross-task write",
  "issue.attribution_spoof_rejected": "tried to choose its own responsible user",
  "issue.recovery_action_opened": "Opened a source-scoped recovery action",
  "issue.workspace_recovered": "Saved work recovered.",
  "issue.workspace_recovery_requested": "Requested workspace recovery",
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
  "issue.thread_interaction_created": "asked for a decision",
  "issue.thread_interaction_accepted": "accepted the request",
  "issue.thread_interaction_rejected": "rejected the request",
  "issue.thread_interaction_answered": "answered the request",
  "issue.thread_interaction_withdrawn": "withdrew the request",
  "issue.thread_interaction_cancelled": "cancelled the request",
  "issue.thread_interaction_skipped": "skipped the request",
  "issue.thread_interaction_dismissed": "deferred the request",
  "issue.thread_interaction_expired": "expired the request",
  "issue.thread_interaction_item_verdicts_submitted": "submitted verdicts on the request",
  "issue.stalled_review_decided": "recorded a review verdict",
};

const ISSUE_ACTIVITY_TRANSLATION_KEYS: Record<string, string> = {
  "issue.created": "activityFormat.action.issue.created",
  "issue.updated": "activityFormat.action.issue.updated",
  "issue.checked_out": "activityFormat.action.issue.checked_out",
  "issue.released": "activityFormat.action.issue.released",
  "issue.comment_added": "activityFormat.action.issue.comment_added",
  "issue.comment_cancelled": "activityFormat.action.issue.comment_cancelled",
  "issue.queued_comment_edited": "activityFormat.action.issue.queued_comment_edited",
  "issue.queued_comments_reordered": "activityFormat.action.issue.queued_comments_reordered",
  "issue.queued_comment_discarded": "activityFormat.action.issue.queued_comment_discarded",
  "issue.comment_deleted": "activityFormat.action.issue.comment_deleted",
  "issue.feedback_vote_saved": "activityFormat.action.issue.feedback_vote_saved",
  "issue.attachment_added": "activityFormat.action.issue.attachment_added",
  "issue.attachment_removed": "activityFormat.action.issue.attachment_removed",
  "issue.document_created": "activityFormat.action.issue.document_created",
  "issue.document_updated": "activityFormat.action.issue.document_updated",
  "issue.document_locked": "activityFormat.action.issue.document_locked",
  "issue.document_unlocked": "activityFormat.action.issue.document_unlocked",
  "issue.document_deleted": "activityFormat.action.issue.document_deleted",
  "issue.monitor_scheduled": "activityFormat.action.issue.monitor_scheduled",
  "issue.monitor_triggered": "activityFormat.action.issue.monitor_triggered",
  "issue.monitor_cleared": "activityFormat.action.issue.monitor_cleared",
  "issue.monitor_skipped": "activityFormat.action.issue.monitor_skipped",
  "issue.monitor_exhausted": "activityFormat.action.issue.monitor_exhausted",
  "issue.monitor_recovery_wake_queued": "activityFormat.action.issue.monitor_recovery_wake_queued",
  "issue.monitor_recovery_issue_created": "activityFormat.action.issue.monitor_recovery_issue_created",
  "issue.monitor_escalated_to_board": "activityFormat.action.issue.monitor_escalated_to_board",
  "issue.deleted": "activityFormat.action.issue.deleted",
  "issue.successful_run_handoff_required": "activityFormat.action.issue.successful_run_handoff_required",
  "issue.successful_run_handoff_resolved": "activityFormat.action.issue.successful_run_handoff_resolved",
  "issue.successful_run_handoff_escalated": "activityFormat.action.issue.successful_run_handoff_escalated",
  "issue.cross_issue_influence_cap_rejected": "activityFormat.action.issue.cross_issue_influence_cap_rejected",
  "issue.cross_issue_influence_observed": "activityFormat.action.issue.cross_issue_influence_observed",
  "issue.attribution_spoof_rejected": "activityFormat.action.issue.attribution_spoof_rejected",
  "issue.recovery_action_opened": "activityFormat.action.issue.recovery_action_opened",
  "issue.recovery_action_resolved": "activityFormat.action.issue.recovery_action_resolved",
  "issue.recovery_action_escalated": "activityFormat.action.issue.recovery_action_escalated",
  "issue.accepted_plan_decomposition_updated": "activityFormat.action.issue.accepted_plan_decomposition_updated",
  "agent.created": "activityFormat.action.agent.created",
  "agent.updated": "activityFormat.action.agent.updated",
  "agent.paused": "activityFormat.action.agent.paused",
  "agent.resumed": "activityFormat.action.agent.resumed",
  "agent.error_cleared": "activityFormat.action.agent.error_cleared",
  "agent.terminated": "activityFormat.action.agent.terminated",
  "heartbeat.invoked": "activityFormat.action.heartbeat.invoked",
  "heartbeat.cancelled": "activityFormat.action.heartbeat.cancelled",
  "heartbeat.output_stale_source_resolved": "activityFormat.action.heartbeat.output_stale_source_resolved",
  "heartbeat.output_stale_recovery_recursion_refused": "activityFormat.action.heartbeat.output_stale_recovery_recursion_refused",
  "approval.created": "activityFormat.action.approval.created",
  "approval.approved": "activityFormat.action.approval.approved",
  "approval.rejected": "activityFormat.action.approval.rejected",
  "issue.thread_interaction_created": "activityFormat.interaction.askedForDecision",
  "issue.thread_interaction_accepted": "activityFormat.interaction.acceptedRequest",
  "issue.thread_interaction_rejected": "activityFormat.interaction.rejectedRequest",
  "issue.thread_interaction_answered": "activityFormat.interaction.answeredRequest",
  "issue.thread_interaction_withdrawn": "activityFormat.interaction.withdrewRequest",
  "issue.thread_interaction_cancelled": "activityFormat.interaction.cancelledRequest",
  "issue.thread_interaction_skipped": "activityFormat.interaction.skippedRequest",
  "issue.thread_interaction_expired": "activityFormat.interaction.expiredRequest",
  "issue.thread_interaction_item_verdicts_submitted": "activityFormat.interaction.submittedVerdicts",
  "issue.stalled_review_decided": "activityFormat.stalledReview.recordedVerdict",
};

/**
 * `issue.stalled_review_decided` carries the verb the actor chose, so the line
 * names the verdict ("approved the review") rather than the generic action.
 * Mirrors `StalledReviewDecisionAction` in shared.
 */
type LocalizedActivityLabel = {
  key: string;
  defaultValue: string;
};

const STALLED_REVIEW_DECISION_LABELS: Record<string, LocalizedActivityLabel> = {
  approve: { key: "activityFormat.stalledReview.approved", defaultValue: "approved the review" },
  request_changes: { key: "activityFormat.stalledReview.requestedChanges", defaultValue: "requested changes on the review" },
  send_back: { key: "activityFormat.stalledReview.sentBack", defaultValue: "sent the review back to work" },
};

/**
 * `issue.thread_interaction_accepted` / `_rejected` fire for *every* interaction
 * kind, not only for a review. A task suggestion or a question is accepted, not
 * approved, so the kind on the event picks the verb. Kinds absent from a map
 * keep the neutral "accepted the request" wording from the tables above, which
 * is also the fallback for an event that carries no kind.
 */
const INTERACTION_ACCEPTED_LABELS: Record<string, LocalizedActivityLabel> = {
  request_confirmation: { key: "activityFormat.interaction.approvedRequest", defaultValue: "approved the request" },
  request_checkbox_confirmation: { key: "activityFormat.interaction.approvedRequest", defaultValue: "approved the request" },
  suggest_tasks: { key: "activityFormat.interaction.acceptedTaskSuggestions", defaultValue: "accepted the task suggestions" },
  ask_user_questions: { key: "activityFormat.interaction.acceptedAnswers", defaultValue: "accepted the answers" },
};

const INTERACTION_REJECTED_LABELS: Record<string, LocalizedActivityLabel> = {
  request_confirmation: { key: "activityFormat.interaction.rejectedRequest", defaultValue: "rejected the request" },
  request_checkbox_confirmation: { key: "activityFormat.interaction.rejectedRequest", defaultValue: "rejected the request" },
  suggest_tasks: { key: "activityFormat.interaction.declinedTaskSuggestions", defaultValue: "declined the task suggestions" },
  ask_user_questions: { key: "activityFormat.interaction.declinedQuestions", defaultValue: "declined the questions" },
};

const STATUS_TRANSLATION_KEYS: Record<string, string> = {
  backlog: "status.backlog",
  todo: "status.todo",
  in_progress: "status.inProgress",
  in_review: "status.inReview",
  blocked: "status.blocked",
  done: "status.done",
  cancelled: "status.cancelled",
  idle: "status.idle",
};

const PRIORITY_TRANSLATION_KEYS: Record<string, string> = {
  low: "priority.low",
  medium: "priority.medium",
  high: "priority.high",
  critical: "priority.critical",
};

/**
 * Kind-aware wording for an interaction outcome, or `null` when the tables
 * above already say it well enough.
 */
function formatLocalizedActivityLabel(label: LocalizedActivityLabel): string {
  return translateInstant(label.key, { defaultValue: label.defaultValue });
}

function formatInteractionOutcomeLabel(action: string, details: ActivityDetails): string | null {
  const table = action === "issue.thread_interaction_accepted"
    ? INTERACTION_ACCEPTED_LABELS
    : action === "issue.thread_interaction_rejected"
      ? INTERACTION_REJECTED_LABELS
      : null;
  if (!table) return null;
  const kind = typeof details?.interactionKind === "string" ? details.interactionKind : null;
  const label = kind ? table[kind] : null;
  return label ? formatLocalizedActivityLabel(label) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function humanizeValue(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "none");
  return value.replace(/_/g, " ");
}

function formatEnumValue(value: unknown, translationKeys: Record<string, string>): string {
  const fallback = humanizeValue(value);
  if (typeof value !== "string") return fallback;
  const key = translationKeys[value];
  if (!key || getCurrentLocale() === "en") return fallback;
  return translateInstant(key, { defaultValue: fallback });
}

function formatStatusValue(value: unknown): string {
  return formatEnumValue(value, STATUS_TRANSLATION_KEYS);
}

function formatPriorityValue(value: unknown): string {
  return formatEnumValue(value, PRIORITY_TRANSLATION_KEYS);
}

function formatActionOn(label: string): string {
  return translateInstant("activityFormat.actionOn", { action: label, defaultValue: `${label} on` });
}

function formatIssueActivityLabel(action: string): string | null {
  const defaultValue = ISSUE_ACTIVITY_LABELS[action];
  if (!defaultValue) return null;
  const key = ISSUE_ACTIVITY_TRANSLATION_KEYS[action];
  return key ? translateInstant(key, { defaultValue }) : defaultValue;
}

function formatReviewPolicyLabel(value: unknown): string {
  const fallback = formatReviewPolicyValue(value);
  const key = typeof value === "string"
    ? `activityFormat.reviewPolicy.${value}`
    : "activityFormat.reviewPolicy.anyone";
  return translateInstant(key, { defaultValue: fallback });
}

function formatActivityPartList(parts: string[]): string {
  return parts.join(getCurrentLocale() === "zh-CN" ? "、" : ", ");
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
  if (!userId || userId === "local-board") return translateInstant("activityFormat.board", { defaultValue: "Board" });
  if (options.currentUserId && userId === options.currentUserId) return translateInstant("activityFormat.you", { defaultValue: "You" });
  const profile = options.userProfileMap?.get(userId);
  if (profile) return profile.label;
  return translateInstant("activityFormat.userLabel", { id: userId.slice(0, 5), defaultValue: `user ${userId.slice(0, 5)}` });
}

function formatParticipantLabel(participant: ActivityParticipant, options: ActivityFormatOptions): string {
  if (participant.type === "agent") {
    const agentId = participant.agentId ?? "";
    return options.agentMap?.get(agentId)?.name ?? translateInstant("activityFormat.agent", { defaultValue: "Agent" });
  }
  return formatUserLabel(participant.userId, options);
}

function formatIssueReferenceLabel(reference: ActivityIssueReference): string {
  if (reference.identifier) return reference.identifier;
  if (reference.title) return reference.title;
  if (reference.id) return reference.id.slice(0, 8);
  return translateInstant("activityFormat.task", { defaultValue: "task" });
}

function formatChangedEntityLabel(
  singularKey: string,
  pluralKey: string,
  labels: string[],
): string {
  const singular = translateInstant(singularKey, { defaultValue: singularKey.replace("activityFormat.", "") });
  const plural = translateInstant(pluralKey, { defaultValue: pluralKey.replace("activityFormat.", "") });
  if (labels.length <= 0) return plural;
  if (labels.length === 1) return translateInstant("activityFormat.namedEntity", { entity: singular, label: labels[0], defaultValue: `${singular} ${labels[0]}` });
  return translateInstant("activityFormat.countedEntity", { count: labels.length, entity: plural, defaultValue: `${labels.length} ${plural}` });
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
  if (newlyCreated > 0) parts.push(translateInstant("activityFormat.decomposition.created", { count: newlyCreated, defaultValue: `created ${newlyCreated} new` }));
  if (reused > 0) parts.push(translateInstant("activityFormat.decomposition.reused", { count: reused, defaultValue: `reused ${reused} existing` }));
  if (parts.length === 0 && requested !== null) parts.push(translateInstant("activityFormat.decomposition.requested", { count: requested, defaultValue: `${requested} requested` }));
  const summary = parts.length > 0 ? formatActivityPartList(parts) : null;
  if (status === "completed" && summary) return translateInstant("activityFormat.decomposition.completedWithSummary", { summary, defaultValue: `decomposition completed (${summary})` });
  if (status === "completed") return translateInstant("activityFormat.decomposition.completed", { defaultValue: "decomposition completed" });
  if (status === "in_flight" && summary) return translateInstant("activityFormat.decomposition.inFlightWithSummary", { summary, defaultValue: `decomposition in flight (${summary})` });
  return summary;
}

function formatIssueUpdatedVerb(details: ActivityDetails): string | null {
  if (!details) return null;
  const previous = asRecord(details._previous) ?? {};
  if (details.status !== undefined) {
    const from = previous.status;
    const to = formatStatusValue(details.status === "in_review" && details.externalConversationState === "waiting" ? "idle" : details.status);
    return from
      ? translateInstant("activityFormat.changedStatusFromOn", { from: formatStatusValue(from), to })
      : translateInstant("activityFormat.changedStatusToOn", { status: to });
  }
  if (details.priority !== undefined) {
    const from = previous.priority;
    return from
      ? translateInstant("activityFormat.changedPriorityFromOn", { from: formatPriorityValue(from), to: formatPriorityValue(details.priority) })
      : translateInstant("activityFormat.changedPriorityToOn", { priority: formatPriorityValue(details.priority) });
  }
  return null;
}

function formatAssigneeName(details: ActivityDetails, options: ActivityFormatOptions): string | null {
  if (!details) return null;
  const agentId = details.assigneeAgentId;
  const userId = details.assigneeUserId;
  if (typeof agentId === "string" && agentId) {
    return options.agentMap?.get(agentId)?.name ?? translateInstant("activityFormat.agent", { defaultValue: "Agent" });
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
    const to = formatStatusValue(details.status === "in_review" && details.externalConversationState === "waiting" ? "idle" : details.status);
    parts.push(
      from
        ? translateInstant("activityFormat.changedStatusFrom", { from: formatStatusValue(from), to })
        : translateInstant("activityFormat.changedStatusTo", { status: to }),
    );
  }
  if (details.priority !== undefined) {
    const from = previous.priority;
    parts.push(
      from
        ? translateInstant("activityFormat.changedPriorityFrom", { from: formatPriorityValue(from), to: formatPriorityValue(details.priority) })
        : translateInstant("activityFormat.changedPriorityTo", { priority: formatPriorityValue(details.priority) }),
    );
  }
  if (details.assigneeAgentId !== undefined || details.assigneeUserId !== undefined) {
    const assigneeName = formatAssigneeName(details, options);
    parts.push(assigneeName
      ? translateInstant("activityFormat.assigneeSet", { assignee: assigneeName, defaultValue: `made ${assigneeName} responsible for the task` })
      : translateInstant("activityFormat.assigneeCleared", { defaultValue: "cleared the responsible" }));
  }
  if (details.reviewPolicy !== undefined) {
    // `null` is the default ("anyone can approve"), so it must not read as
    // "changed the review policy to none" (PAP-16506).
    const policy = formatReviewPolicyLabel(details.reviewPolicy);
    parts.push(translateInstant("activityFormat.reviewPolicyChanged", { policy, defaultValue: `changed who can approve to ${formatReviewPolicyValue(details.reviewPolicy)}` }));
  }
  if (details.title !== undefined) parts.push(translateInstant("activityFormat.titleUpdated", { defaultValue: "updated the title" }));
  if (details.description !== undefined) parts.push(translateInstant("activityFormat.descriptionUpdated", { defaultValue: "updated the description" }));

  return parts.length > 0 ? formatActivityPartList(parts) : null;
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
      const changed = formatChangedEntityLabel("activityFormat.blocker", "activityFormat.blockers", added);
      return input.forIssueDetail
        ? translateInstant("activityFormat.added", { changed, defaultValue: `added ${changed}` })
        : translateInstant("activityFormat.addedTo", { changed, defaultValue: `added ${changed} to` });
    }
    if (removed.length > 0 && added.length === 0) {
      const changed = formatChangedEntityLabel("activityFormat.blocker", "activityFormat.blockers", removed);
      return input.forIssueDetail
        ? translateInstant("activityFormat.removed", { changed, defaultValue: `removed ${changed}` })
        : translateInstant("activityFormat.removedFrom", { changed, defaultValue: `removed ${changed} from` });
    }
    const label = translateInstant("activityFormat.blockers", { defaultValue: "blockers" });
    return input.forIssueDetail
      ? translateInstant("activityFormat.updatedLabel", { label, defaultValue: `updated ${label}` })
      : translateInstant("activityFormat.updatedOn", { label, defaultValue: `updated ${label} on` });
  }

  if (input.action === "issue.reviewers_updated" || input.action === "issue.approvers_updated") {
    const added = readParticipants(details, "addedParticipants").map((participant) => formatParticipantLabel(participant, input.options));
    const removed = readParticipants(details, "removedParticipants").map((participant) => formatParticipantLabel(participant, input.options));
    const singular = input.action === "issue.reviewers_updated" ? "activityFormat.reviewer" : "activityFormat.approver";
    const plural = input.action === "issue.reviewers_updated" ? "activityFormat.reviewers" : "activityFormat.approvers";
    if (added.length > 0 && removed.length === 0) {
      const changed = formatChangedEntityLabel(singular, plural, added);
      return input.forIssueDetail
        ? translateInstant("activityFormat.added", { changed, defaultValue: `added ${changed}` })
        : translateInstant("activityFormat.addedTo", { changed, defaultValue: `added ${changed} to` });
    }
    if (removed.length > 0 && added.length === 0) {
      const changed = formatChangedEntityLabel(singular, plural, removed);
      return input.forIssueDetail
        ? translateInstant("activityFormat.removed", { changed, defaultValue: `removed ${changed}` })
        : translateInstant("activityFormat.removedFrom", { changed, defaultValue: `removed ${changed} from` });
    }
    const label = translateInstant(plural, { defaultValue: plural.replace("activityFormat.", "") });
    return input.forIssueDetail
      ? translateInstant("activityFormat.updatedLabel", { label, defaultValue: `updated ${label}` })
      : translateInstant("activityFormat.updatedOn", { label, defaultValue: `updated ${label} on` });
  }

  return null;
}

export function formatActivityVerb(
  action: string,
  details?: Record<string, unknown> | null,
  options: ActivityFormatOptions = {},
): string {
  if (action.startsWith("tool_gateway.")) {
    const tool = typeof details?.tool === "string"
      ? details.tool
      : typeof details?.upstreamToolName === "string"
        ? details.upstreamToolName
        : translateInstant("activityFormat.toolGateway.appAction", { defaultValue: "an app action" });
    const isTest = details?.source === "test";
    if (action === "tool_gateway.call_completed") return translateInstant(
      isTest ? "activityFormat.toolGateway.testedOn" : "activityFormat.toolGateway.usedOn",
      { tool, defaultValue: `${isTest ? "tested" : "used"} ${tool} on` },
    );
    if (action === "tool_gateway.call_allowed") return translateInstant(
      isTest ? "activityFormat.toolGateway.testStartedOn" : "activityFormat.toolGateway.allowedToUseOn",
      { tool, defaultValue: `${isTest ? "started a test of" : "was allowed to use"} ${tool} on` },
    );
    if (action === "tool_gateway.call_denied") return translateInstant("activityFormat.toolGateway.blockedUsingOn", { tool, defaultValue: `was blocked from using ${tool} on` });
    if (action === "tool_gateway.approval_requested") return translateInstant("activityFormat.toolGateway.askedToUseOn", { tool, defaultValue: `asked to use ${tool} on` });
    if (action === "tool_gateway.session_created") return translateInstant("activityFormat.toolGateway.openedSessionFor", { defaultValue: "opened an app session for" });
    if (action === "tool_gateway.session_rejected") return translateInstant("activityFormat.toolGateway.blockedSessionFor", { defaultValue: "was blocked from opening an app session for" });
    if (action === "tool_gateway.discovery") return translateInstant("activityFormat.toolGateway.discoveredActionsFor", { defaultValue: "discovered app actions for" });
  }

  if (action === "issue.updated") {
    const issueUpdatedVerb = formatIssueUpdatedVerb(details);
    if (issueUpdatedVerb) return issueUpdatedVerb;
  }

  if (action === "issue.stalled_review_decided") {
    const decision = typeof details?.action === "string" ? details.action : null;
    const label = decision ? STALLED_REVIEW_DECISION_LABELS[decision] : null;
    if (label) return formatActionOn(formatLocalizedActivityLabel(label));
  }

  const outcomeLabel = formatInteractionOutcomeLabel(action, details);
  if (outcomeLabel) return formatActionOn(outcomeLabel);

  const activityLabel = formatIssueActivityLabel(action);
  if (activityLabel && (action.startsWith("issue.thread_interaction_") || action === "issue.stalled_review_decided")) {
    return formatActionOn(activityLabel);
  }

  const structuredChange = formatStructuredIssueChange({
    action,
    details,
    options,
    forIssueDetail: false,
  });
  if (structuredChange) return structuredChange;

  const knownVerb = ACTIVITY_ROW_VERBS[action];
  if (knownVerb) return knownVerb;

  // Plugin-defined events are intentionally open-ended. Keep their raw event
  // identifier visible in the audit row, but use a host-owned localized verb
  // instead of turning arbitrary package event names into English prose.
  if (action.startsWith("plugin.")) return "activityFormat.row.plugin.action";

  return action.replace(/[._]/g, " ");
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

  if (action === "issue.stalled_review_decided") {
    const decision = typeof details?.action === "string" ? details.action : null;
    const label = decision ? STALLED_REVIEW_DECISION_LABELS[decision] : null;
    if (label) return formatLocalizedActivityLabel(label);
  }

  const outcomeLabel = formatInteractionOutcomeLabel(action, details);
  if (outcomeLabel) return outcomeLabel;

  if (action.startsWith("issue.monitor_") && details) {
    const serviceName = typeof details.serviceName === "string" && details.serviceName.trim()
      ? details.serviceName.trim()
      : null;
    const base = formatIssueActivityLabel(action) ?? action.replace(/[._]/g, " ");
    return serviceName
      ? translateInstant("activityFormat.monitorForService", { base, serviceName, defaultValue: `${base} for ${serviceName}` })
      : base;
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
    const key = typeof details.key === "string" ? details.key : "document";
    const title = typeof details.title === "string" && details.title ? ` (${details.title})` : "";
    const actionLabel = formatIssueActivityLabel(action) ?? action;
    return `${translateInstant("activityFormat.documentAction", { action: actionLabel, key })}${title}`;
  }

  return formatIssueActivityLabel(action) ?? action.replace(/[._]/g, " ");
}

import type { TFunction } from "i18next";

const STATUS_TRANSLATION_KEYS: Record<string, string> = {
  active: "status.active",
  achieved: "status.achieved",
  approved: "status.approved",
  archived: "status.archived",
  backlog: "status.backlog",
  blocked: "status.blocked",
  cancelled: "status.cancelled",
  coming_soon: "status.comingSoon",
  done: "status.done",
  deleted: "status.deleted",
  disabled: "status.disabled",
  error: "status.error",
  failed: "status.failed",
  queued: "status.queued",
  ready: "status.ready",
  idle: "status.idle",
  in_progress: "status.inProgress",
  in_review: "status.inReview",
  invalid_org_chain: "status.invalidOrgChain",
  paused: "status.paused",
  pending: "status.pending",
  pending_approval: "status.pendingApproval",
  planned: "status.planned",
  rejected: "status.rejected",
  revision_requested: "status.revisionRequested",
  running: "status.running",
  skipped: "status.skipped",
  starting: "status.starting",
  succeeded: "status.succeeded",
  suspended: "status.suspended",
  timed_out: "status.timedOut",
  terminated: "status.terminated",
  todo: "status.todo",
  warning: "status.warning",
};

const PRIORITY_TRANSLATION_KEYS: Record<string, string> = {
  critical: "priority.critical",
  high: "priority.high",
  medium: "priority.medium",
  low: "priority.low",
};

const ENTITY_TYPE_TRANSLATION_KEYS: Record<string, string> = {
  agent: "entityType.agent",
  approval: "entityType.approval",
  company: "entityType.company",
  cost: "entityType.cost",
  goal: "entityType.goal",
  heartbeat_run: "entityType.heartbeatRun",
  invite: "entityType.invite",
  issue: "entityType.issue",
  plugin: "entityType.plugin",
  project: "entityType.project",
  routine: "entityType.routine",
  routine_run: "entityType.routineRun",
  routine_trigger: "entityType.routineTrigger",
  user_preference: "entityType.userPreference",
};

export function humanizeEnumValue(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function translateStatusLabel(t: TFunction, status: string): string {
  return t(STATUS_TRANSLATION_KEYS[status] ?? status, {
    defaultValue: humanizeEnumValue(status),
  });
}

export function translatePriorityLabel(t: TFunction, priority: string): string {
  return t(PRIORITY_TRANSLATION_KEYS[priority] ?? priority, {
    defaultValue: humanizeEnumValue(priority),
  });
}

export function translateEntityTypeLabel(t: TFunction, entityType: string): string {
  const translationKey = ENTITY_TYPE_TRANSLATION_KEYS[entityType];
  if (!translationKey) return entityType;
  return t(translationKey, {
    defaultValue: humanizeEnumValue(entityType),
  });
}

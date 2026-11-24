import { translateInstant as t } from "@/i18n";
import type { IssueBlockerAttention } from "@penclipai/shared";

/**
 * Everything a task status surface needs to pick its glyph and label. Every
 * view (sidebar rows, task header, properties, status picker, lists, inbox,
 * pills, search) resolves through {@link resolveTaskStatusPresentation}, so one
 * underlying state always renders the same icon and label (BUG-07).
 */
export interface TaskStatusPresentationInput {
  status: string;
  /** Server-derived presentation; mutations still use the canonical status. */
  displayStatus?: string | null;
  externalConversationState?: "active" | "waiting" | null;
  blockerAttention?: IssueBlockerAttention | null;
}

export interface TaskStatusPresentation {
  /** Key into the unified StatusGlyph icon/colour tables. */
  glyphStatus: string;
  /** Short visible label ("Blocked", "Idle", "Monitoring", …). */
  label: string;
  /** Full accessible/tooltip copy, including the blocked reason. */
  ariaLabel: string;
}

export function taskStatusLabel(status: string): string {
  return t(`status.${status.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())}`, { defaultValue: status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) });
}

function blockedAttentionLabel(
  blockerAttention: IssueBlockerAttention | null | undefined,
) {
  if (!blockerAttention || blockerAttention.state === "none") {
    return t("status.blocked", { defaultValue: "Blocked" });
  }

  if (blockerAttention.reason === "active_child") {
    const count = blockerAttention.coveredBlockerCount;
    if (count === 1 && blockerAttention.sampleBlockerIdentifier) {
      return t("statusIcon.blocked.waitingOnActiveSubIssueNamed", {
        identifier: blockerAttention.sampleBlockerIdentifier,
        defaultValue: "Blocked · waiting on active sub-task {{identifier}}",
      });
    }
    if (count === 1) {
      return t("statusIcon.blocked.waitingOnOneActiveSubIssue", {
        defaultValue: "Blocked · waiting on 1 active sub-task",
      });
    }
    return t("statusIcon.blocked.waitingOnActiveSubIssues", {
      count,
      defaultValue: "Blocked · waiting on {{count}} active sub-tasks",
    });
  }

  if (blockerAttention.reason === "active_dependency") {
    const count = blockerAttention.coveredBlockerCount;
    if (count === 1 && blockerAttention.sampleBlockerIdentifier) {
      return t("statusIcon.blocked.coveredByActiveDependencyNamed", {
        identifier: blockerAttention.sampleBlockerIdentifier,
        defaultValue: "Blocked · covered by active dependency {{identifier}}",
      });
    }
    if (count === 1) {
      return t("statusIcon.blocked.coveredByOneActiveDependency", {
        defaultValue: "Blocked · covered by 1 active dependency",
      });
    }
    return t("statusIcon.blocked.coveredByActiveDependencies", {
      count,
      defaultValue: "Blocked · covered by {{count}} active dependencies",
    });
  }

  if (blockerAttention.reason === "stalled_review") {
    const count = blockerAttention.stalledBlockerCount;
    const leaf = blockerAttention.sampleStalledBlockerIdentifier ?? blockerAttention.sampleBlockerIdentifier;
    if (count === 1 && leaf) {
      return t("statusIcon.blocked.reviewStalledOn", {
        identifier: leaf,
        defaultValue: "Blocked · review stalled on {{identifier}}",
      });
    }
    if (count === 1) {
      return t("statusIcon.blocked.oneReviewStalled", {
        defaultValue: "Blocked · review stalled with no clear next step",
      });
    }
    return t("statusIcon.blocked.reviewsStalled", {
      count,
      defaultValue: "Blocked · {{count}} reviews stalled with no clear next step",
    });
  }

  if (blockerAttention.reason === "attention_required") {
    const count = blockerAttention.attentionBlockerCount || blockerAttention.unresolvedBlockerCount;
    const attentionCopy = count === 1
      ? t("statusIcon.blocked.oneBlockerNeedsAttention", { defaultValue: "1 blocker needs attention" })
      : t("statusIcon.blocked.blockersNeedAttention", {
        count,
        defaultValue: "{{count}} blockers need attention",
      });
    const coveredCount = blockerAttention.coveredBlockerCount;
    if (coveredCount > 0) {
      return t("statusIcon.blocked.attentionAndCovered", {
        attention: attentionCopy,
        coveredCount,
        defaultValue: "Blocked · {{attention}}; {{coveredCount}} covered by active work",
      });
    }
    return t("statusIcon.blocked.attention", {
      attention: attentionCopy,
      defaultValue: "Blocked · {{attention}}",
    });
  }

  return t("status.blocked", { defaultValue: "Blocked" });
}

/**
 * The one state → glyph/label mapping:
 * - in_review whose external conversation is waiting → "Idle"
 * - in_progress presented as monitoring → "Monitoring" (clock)
 * - blocked and covered by active work → the blue "in queue" glyph, with the
 *   blocked reason on the accessible label
 */
export function resolveTaskStatusPresentation(input: TaskStatusPresentationInput): TaskStatusPresentation {
  const { status, displayStatus, externalConversationState, blockerAttention } = input;
  // A saved/optimistic transition must win over the previous read projection.
  const projectedStatus = status === "in_progress" ? (displayStatus ?? status) : status;
  const visibleStatus = projectedStatus === "in_review" && externalConversationState === "waiting"
    ? "idle"
    : projectedStatus;
  const isCoveredBlocked = projectedStatus === "blocked" && blockerAttention?.state === "covered";
  return {
    glyphStatus: isCoveredBlocked ? "in_queue" : visibleStatus,
    label: taskStatusLabel(visibleStatus),
    ariaLabel: projectedStatus === "blocked" ? blockedAttentionLabel(blockerAttention) : taskStatusLabel(visibleStatus),
  };
}

type TaskStatusSource = {
  status: string;
  displayStatus?: string | null;
  externalConversationState?: "active" | "waiting" | null;
  blockerAttention?: IssueBlockerAttention | null;
};

/**
 * Pick every status-presentation field from a task record so a view cannot
 * silently drop one (e.g. `blockerAttention`) and render a different glyph
 * than the task pane. Spread into `<StatusIcon {...taskStatusIconProps(task)} />`.
 */
export function taskStatusIconProps(task: TaskStatusSource): TaskStatusPresentationInput {
  return {
    status: task.status,
    displayStatus: task.displayStatus ?? null,
    externalConversationState: task.externalConversationState ?? null,
    blockerAttention: task.blockerAttention ?? null,
  };
}

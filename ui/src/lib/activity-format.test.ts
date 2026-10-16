import type { Agent } from "@penclipai/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstance } from "i18next";
import en from "../../public/locales/en/common.json";
import zhCN from "../../public/locales/zh-CN/common.json";

const translationState = vi.hoisted(() => ({
  translate: (key: string, _options?: Record<string, unknown>) => key,
}));

vi.mock("@/i18n", () => ({
  translateInstant: (key: string, options?: Record<string, unknown>) => translationState.translate(key, options),
}));

import { formatActivityVerb, formatIssueActivityAction } from "./activity-format";

describe("activity formatting", () => {
  const i18n = createInstance();
  const agentMap = new Map<string, Agent>([
    ["agent-reviewer", { id: "agent-reviewer", name: "Reviewer Bot" } as Agent],
    ["agent-approver", { id: "agent-approver", name: "Approver Bot" } as Agent],
  ]);

  beforeAll(async () => {
    await i18n.init({
      lng: "en",
      fallbackLng: "en",
      keySeparator: false,
      resources: { en: { translation: en }, "zh-CN": { translation: zhCN } },
    });
    translationState.translate = (key, options) => i18n.t(key, options);
  });

  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("labels a Slack settlement as idle while retaining actual review wording", () => {
    const details = { status: "in_review", externalConversationState: "waiting" };
    expect(formatActivityVerb("issue.updated", details)).toBe("changed status to idle on");
    expect(formatIssueActivityAction("issue.updated", details)).toBe("changed the status to idle");
    expect(formatActivityVerb("issue.updated", { status: "in_review" })).toBe("changed status to in review on");
  });

  it("uses translation keys for app-owned task activity verbs", () => {
    expect(formatActivityVerb("issue.read_marked")).toBe("activity.issueRead");
    expect(formatActivityVerb("issue.read_unmarked")).toBe("activityFormat.row.issue.read_unmarked");
    expect(formatActivityVerb("issue.work_product_created")).toBe("activity.issueWorkProductCreated");
  });

  it("uses semantic translation keys for plugin activity verbs", () => {
    expect(formatActivityVerb("plugin.installed")).toBe("activityFormat.row.plugin.installed");
    expect(formatActivityVerb("plugin.uninstalled")).toBe("activityFormat.row.plugin.uninstalled");
    expect(formatActivityVerb("plugin.enabled")).toBe("activityFormat.row.plugin.enabled");
    expect(formatActivityVerb("plugin.disabled")).toBe("activityFormat.row.plugin.disabled");
    expect(formatActivityVerb("plugin.upgraded")).toBe("activityFormat.row.plugin.upgraded");
    expect(formatActivityVerb("plugin.config.updated")).toBe("activityFormat.row.plugin.configUpdated");
    expect(formatActivityVerb("plugin.local_folder.configured")).toBe("activityFormat.row.plugin.localFolderConfigured");
    expect(formatActivityVerb("plugin.managed_routine.created")).toBe("activityFormat.row.plugin.managedRoutineCreated");
    expect(formatActivityVerb("plugin.managed_routine.reset")).toBe("activityFormat.row.plugin.managedRoutineReset");
    expect(formatActivityVerb("plugin.managed_routine.updated")).toBe("activityFormat.row.plugin.managedRoutineUpdated");
    expect(formatActivityVerb("plugin.managed_routine.run_triggered")).toBe("activityFormat.row.plugin.managedRoutineRunTriggered");
    expect(formatActivityVerb("plugin.managed_agent.relinked")).toBe("activityFormat.row.plugin.managedAgentRelinked");
    expect(formatActivityVerb("plugin.managed_agent.created")).toBe("activityFormat.row.plugin.managedAgentCreated");
    expect(formatActivityVerb("plugin.managed_agent.pause_reason_backfilled")).toBe("activityFormat.row.plugin.managedAgentPauseReasonBackfilled");
    expect(formatActivityVerb("plugin.managed_agent.reset")).toBe("activityFormat.row.plugin.managedAgentReset");
    expect(formatActivityVerb("plugin.managed_skill.reconciled")).toBe("activityFormat.row.plugin.managedSkillReconciled");
    expect(formatActivityVerb("plugin.managed_skill.reset")).toBe("activityFormat.row.plugin.managedSkillReset");
    expect(formatActivityVerb("plugin.@penclipai/example.synced")).toBe("activityFormat.row.plugin.action");
    expect(formatActivityVerb("future.domain_event")).toBe("future domain event");
  });

  it("formats blocker activity using linked issue identifiers", () => {
    const details = {
      addedBlockedByIssues: [
        { id: "issue-2", identifier: "PAP-22", title: "Blocked task" },
      ],
      removedBlockedByIssues: [],
    };

    expect(formatActivityVerb("issue.blockers_updated", details)).toBe("added blocker PAP-22 to");
    expect(formatIssueActivityAction("issue.blockers_updated", details)).toBe("added blocker PAP-22");
  });

  it("formats reviewer activity using agent names", () => {
    const details = {
      addedParticipants: [
        { type: "agent", agentId: "agent-reviewer", userId: null },
      ],
      removedParticipants: [],
    };

    expect(formatActivityVerb("issue.reviewers_updated", details, { agentMap })).toBe("added reviewer Reviewer Bot to");
    expect(formatIssueActivityAction("issue.reviewers_updated", details, { agentMap })).toBe("added reviewer Reviewer Bot");
  });

  it("formats approver removals using user-aware labels", () => {
    const details = {
      addedParticipants: [],
      removedParticipants: [
        { type: "user", agentId: null, userId: "local-board" },
      ],
    };

    expect(formatActivityVerb("issue.approvers_updated", details)).toBe("removed approver Board from");
    expect(formatIssueActivityAction("issue.approvers_updated", details)).toBe("removed approver Board");
  });

  it("falls back to updated wording when reviewers are both added and removed", () => {
    const details = {
      addedParticipants: [
        { type: "agent", agentId: "agent-reviewer", userId: null },
      ],
      removedParticipants: [
        { type: "agent", agentId: "agent-approver", userId: null },
      ],
    };

    expect(formatActivityVerb("issue.reviewers_updated", details, { agentMap })).toBe("updated reviewers on");
    expect(formatIssueActivityAction("issue.reviewers_updated", details, { agentMap })).toBe("updated reviewers");
  });

  it("formats monitor activity with direct verbs", () => {
    expect(formatActivityVerb("issue.monitor_scheduled")).toBe("scheduled monitor on");
    expect(formatActivityVerb("issue.monitor_exhausted")).toBe("exhausted monitor on");
    expect(formatIssueActivityAction("issue.monitor_triggered")).toBe("triggered a monitor");
    expect(formatIssueActivityAction("issue.monitor_cleared")).toBe("cleared a monitor");
    expect(formatIssueActivityAction("issue.monitor_recovery_issue_created")).toBe("created a monitor recovery issue");
  });

  it("localizes queued-comment audit rows and task history in both supported locales", async () => {
    const rows = [
      ["issue.read_unmarked", "activityFormat.row.issue.read_unmarked", "marked unread", "标记为未读"],
      ["issue.comment_cancelled", "activityFormat.row.issue.comment_cancelled", "cancelled a queued comment on", "取消了待发送评论："],
      ["issue.queued_comment_edited", "activityFormat.row.issue.queued_comment_edited", "edited a queued comment on", "编辑了待发送评论："],
      ["issue.queued_comments_reordered", "activityFormat.row.issue.queued_comments_reordered", "reordered queued comments on", "调整了待发送评论顺序："],
      ["issue.queued_comment_discarded", "activityFormat.row.issue.queued_comment_discarded", "discarded a queued comment on", "丢弃了待发送评论："],
    ] as const;
    const actions = [
      ["issue.comment_cancelled", "cancelled a queued comment", "取消了待发送评论"],
      ["issue.queued_comment_edited", "edited a queued comment", "编辑了待发送评论"],
      ["issue.queued_comments_reordered", "reordered queued comments", "调整了待发送评论顺序"],
      ["issue.queued_comment_discarded", "discarded a queued comment", "丢弃了待发送评论"],
    ] as const;

    for (const [action, key, english] of rows) {
      expect(formatActivityVerb(action)).toBe(key);
      expect(translationState.translate(key)).toBe(english);
    }
    for (const [action, english] of actions) {
      expect(formatIssueActivityAction(action)).toBe(english);
    }

    await i18n.changeLanguage("zh-CN");
    for (const [action, key, _english, chinese] of rows) {
      expect(formatActivityVerb(action)).toBe(key);
      expect(translationState.translate(key)).toBe(chinese);
    }
    for (const [action, _english, chinese] of actions) {
      expect(formatIssueActivityAction(action)).toBe(chinese);
    }
  });

  it("preserves unmapped event identifiers as the existing raw fallback", () => {
    expect(formatActivityVerb("vendor.raw_event")).toBe("vendor raw event");
    expect(formatIssueActivityAction("vendor.raw_event")).toBe("vendor raw event");
  });

  it("uses semantic keys for queued-comment audit rows", () => {
    expect(formatActivityVerb("issue.queued_comment_edited")).toBe("activityFormat.row.issue.queued_comment_edited");
    expect(formatActivityVerb("issue.queued_comments_reordered")).toBe("activityFormat.row.issue.queued_comments_reordered");
    expect(formatActivityVerb("issue.queued_comment_discarded")).toBe("activityFormat.row.issue.queued_comment_discarded");
    expect(formatIssueActivityAction("issue.queued_comment_edited")).toBe("edited a queued comment");
    expect(formatIssueActivityAction("issue.queued_comments_reordered")).toBe("reordered queued comments");
    expect(formatIssueActivityAction("issue.queued_comment_discarded")).toBe("discarded a queued comment");
  });

  // PAP-16506 P4: agents can now resolve an interaction, including a review of
  // their own work, so an outcome has to read as an outcome in the timeline
  // instead of leaking the raw action id.
  it("reads an interaction outcome as an outcome, whoever gave it", () => {
    expect(formatIssueActivityAction("issue.thread_interaction_accepted")).toBe("accepted the request");
    expect(formatIssueActivityAction("issue.thread_interaction_rejected")).toBe("rejected the request");
    expect(formatIssueActivityAction("issue.thread_interaction_withdrawn")).toBe("withdrew the request");
    expect(formatIssueActivityAction("issue.thread_interaction_expired")).toBe("expired the request");
    expect(formatActivityVerb("issue.thread_interaction_accepted")).toBe("accepted the request on");
    expect(formatActivityVerb("issue.thread_interaction_rejected")).toBe("rejected the request on");
  });

  // The accepted/rejected actions fire for every interaction kind, so only a
  // confirmation may read as an approval.
  it("says 'approved' only for a confirmation, never for a suggestion or a question", () => {
    expect(formatIssueActivityAction("issue.thread_interaction_accepted", { interactionKind: "request_confirmation" }))
      .toBe("approved the request");
    expect(formatIssueActivityAction("issue.thread_interaction_accepted", { interactionKind: "request_checkbox_confirmation" }))
      .toBe("approved the request");
    expect(formatIssueActivityAction("issue.thread_interaction_accepted", { interactionKind: "suggest_tasks" }))
      .toBe("accepted the task suggestions");
    expect(formatIssueActivityAction("issue.thread_interaction_accepted", { interactionKind: "ask_user_questions" }))
      .toBe("accepted the answers");
    expect(formatIssueActivityAction("issue.thread_interaction_rejected", { interactionKind: "request_confirmation" }))
      .toBe("rejected the request");
    expect(formatIssueActivityAction("issue.thread_interaction_rejected", { interactionKind: "suggest_tasks" }))
      .toBe("declined the task suggestions");
    expect(formatActivityVerb("issue.thread_interaction_accepted", { interactionKind: "suggest_tasks" }))
      .toBe("accepted the task suggestions on");
  });

  it("keeps the neutral wording for a kind it does not know", () => {
    expect(formatIssueActivityAction("issue.thread_interaction_accepted", { interactionKind: "request_item_verdicts" }))
      .toBe("accepted the request");
    expect(formatIssueActivityAction("issue.thread_interaction_accepted", { interactionKind: "future_kind" }))
      .toBe("accepted the request");
    expect(formatIssueActivityAction("issue.thread_interaction_accepted", { interactionKind: 7 }))
      .toBe("accepted the request");
  });

  it("names the verb an actor chose on a stalled review", () => {
    expect(formatIssueActivityAction("issue.stalled_review_decided", { action: "approve" }))
      .toBe("approved the review");
    expect(formatIssueActivityAction("issue.stalled_review_decided", { action: "request_changes" }))
      .toBe("requested changes on the review");
    expect(formatIssueActivityAction("issue.stalled_review_decided", { action: "send_back" }))
      .toBe("sent the review back to work");
    expect(formatActivityVerb("issue.stalled_review_decided", { action: "approve" }))
      .toBe("approved the review on");
  });

  it("falls back to a generic verdict line when the decision verb is missing", () => {
    expect(formatIssueActivityAction("issue.stalled_review_decided")).toBe("recorded a review verdict");
    expect(formatIssueActivityAction("issue.stalled_review_decided", { action: "shrug" }))
      .toBe("recorded a review verdict");
  });

  it("describes a review-policy change without calling the default 'none'", () => {
    expect(formatIssueActivityAction("issue.updated", { reviewPolicy: null }))
      .toBe("changed who can approve to anyone");
    expect(formatIssueActivityAction("issue.updated", { reviewPolicy: "human_only" }))
      .toBe("changed who can approve to human only");
    expect(formatIssueActivityAction("issue.updated", { reviewPolicy: "not_creator" }))
      .toBe("changed who can approve to anyone else");
  });

  it("uses plain next-step copy for successful-run handoff activity", () => {
    expect(formatActivityVerb("issue.successful_run_handoff_required")).toBe("flagged missing next step on");
    expect(formatIssueActivityAction("issue.successful_run_handoff_required")).toBe("Run finished without a clear next step");
    expect(formatIssueActivityAction("issue.successful_run_handoff_resolved")).toBe("Next step chosen");
    expect(formatIssueActivityAction("issue.successful_run_handoff_escalated")).toBe(
      "Run finished without a next step - recovery escalated",
    );
  });
});

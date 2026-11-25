import type { Agent } from "@penclipai/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstance } from "i18next";
import en from "../../public/locales/en/common.json";
import zhCN from "../../public/locales/zh-CN/common.json";

const translationState = vi.hoisted(() => ({
  translate: (key: string, _options?: Record<string, unknown>) => key,
  locale: "en" as "en" | "zh-CN",
}));

vi.mock("@/i18n", () => ({
  translateInstant: (key: string, options?: Record<string, unknown>) => translationState.translate(key, options),
  getCurrentLocale: () => translationState.locale,
}));

import {
  formatActivityEntityLabel,
  formatActivityOutcome,
  formatActivityVerb,
  formatIssueActivityAction,
} from "./activity-format";

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
      interpolation: { escapeValue: false },
      resources: { en: { translation: en }, "zh-CN": { translation: zhCN } },
    });
    translationState.translate = (key, options) => i18n.t(key, options);
  });

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    translationState.locale = "en";
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

  it("formats monitor activity through the same translation path as the activity row", async () => {
    const rows = [
      ["issue.monitor_scheduled", "scheduled monitor on", "安排了监控："],
      ["issue.monitor_exhausted", "exhausted monitor on", "监控已达到时限或次数上限："],
    ] as const;
    for (const [action, english] of rows) expect(translationState.translate(formatActivityVerb(action))).toBe(english);
    expect(formatIssueActivityAction("issue.monitor_triggered")).toBe("triggered a monitor");
    expect(formatIssueActivityAction("issue.monitor_cleared")).toBe("cleared a monitor");
    expect(formatIssueActivityAction("issue.monitor_recovery_issue_created")).toBe("created a monitor recovery issue");

    await i18n.changeLanguage("zh-CN");
    for (const [action, _english, chinese] of rows) expect(translationState.translate(formatActivityVerb(action))).toBe(chinese);
    expect(formatIssueActivityAction("issue.monitor_triggered")).toBe("触发了监控");
    expect(formatIssueActivityAction("issue.monitor_cleared")).toBe("清除了监控");
    expect(formatIssueActivityAction("issue.monitor_recovery_issue_created")).toBe("创建了监控恢复任务");
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

  it("localizes status and priority changes while keeping English history wording stable", async () => {
    const cases = [
      [{ status: "in_progress", _previous: { status: "todo" } }, "changed status from todo to in progress on", "changed the status from todo to in progress", "将状态从待办改为进行中：", "将状态从待办改为进行中"],
      [{ status: "in_review", externalConversationState: "waiting" }, "changed status to idle on", "changed the status to idle", "将状态改为空闲：", "将状态改为空闲"],
      [{ priority: "high", _previous: { priority: "low" } }, "changed priority from low to high on", "changed the priority from low to high", "将优先级从低改为高：", "将优先级从低改为高"],
      [{ priority: "medium" }, "changed priority to medium on", "changed the priority to medium", "将优先级改为中：", "将优先级改为中"],
    ] as const;

    for (const [details, englishRow, englishDetail] of cases) {
      expect(formatActivityVerb("issue.updated", details)).toBe(englishRow);
      expect(formatIssueActivityAction("issue.updated", details)).toBe(englishDetail);
    }

    await i18n.changeLanguage("zh-CN");
    translationState.locale = "zh-CN";
    for (const [details, _englishRow, _englishDetail, chineseRow, chineseDetail] of cases) {
      expect(formatActivityVerb("issue.updated", details)).toBe(chineseRow);
      expect(formatIssueActivityAction("issue.updated", details)).toBe(chineseDetail);
    }
  });

  it("localizes interaction outcomes and stalled-review decisions without changing their English meanings", async () => {
    const cases = [
      ["issue.thread_interaction_accepted", { interactionKind: "request_confirmation" }, "approved the request", "批准了请求"],
      ["issue.thread_interaction_accepted", { interactionKind: "suggest_tasks" }, "accepted the task suggestions", "接受了任务建议"],
      ["issue.thread_interaction_accepted", { interactionKind: "ask_user_questions" }, "accepted the answers", "接受了回答"],
      ["issue.thread_interaction_rejected", { interactionKind: "request_confirmation" }, "rejected the request", "拒绝了请求"],
      ["issue.thread_interaction_rejected", { interactionKind: "suggest_tasks" }, "declined the task suggestions", "拒绝了任务建议"],
      ["issue.thread_interaction_rejected", { interactionKind: "ask_user_questions" }, "declined the questions", "拒绝了问题"],
      ["issue.stalled_review_decided", { action: "approve" }, "approved the review", "批准了审核"],
      ["issue.stalled_review_decided", { action: "request_changes" }, "requested changes on the review", "要求修改审核内容"],
      ["issue.stalled_review_decided", { action: "send_back" }, "sent the review back to work", "将审核退回继续处理"],
    ] as const;

    for (const [action, details, english] of cases) {
      expect(formatIssueActivityAction(action, details)).toBe(english);
      expect(formatActivityVerb(action, details)).toBe(`${english} on`);
    }

    await i18n.changeLanguage("zh-CN");
    translationState.locale = "zh-CN";
    for (const [action, details, _english, chinese] of cases) {
      expect(formatIssueActivityAction(action, details)).toBe(chinese);
      expect(formatActivityVerb(action, details)).toBe(`${chinese}：`);
    }
  });

  it("localizes document actions while preserving raw document keys and titles", async () => {
    const details = { key: "docs/合同.md", title: "中文 title_ASCII-01" };
    const actions = [
      ["issue.document_created", "created a document", "创建了文档"],
      ["issue.document_updated", "updated a document", "更新了文档"],
      ["issue.document_locked", "locked a document", "锁定了文档"],
      ["issue.document_unlocked", "unlocked a document", "解锁了文档"],
      ["issue.document_deleted", "deleted a document", "删除了文档"],
    ] as const;

    for (const [action, english] of actions) {
      expect(formatIssueActivityAction(action, details))
        .toBe(`${english} docs/合同.md (中文 title_ASCII-01)`);
    }

    await i18n.changeLanguage("zh-CN");
    translationState.locale = "zh-CN";
    for (const [action, _english, chinese] of actions) {
      expect(formatIssueActivityAction(action, details))
        .toBe(`${chinese} docs/合同.md (中文 title_ASCII-01)`);
    }
  });

  it("localizes every accepted-plan decomposition summary while preserving numeric values", async () => {
    const cases = [
      [{ status: "completed", childIssueIds: ["a", "b", "c"], newlyCreatedChildIssueIds: ["a", "b"] }, "decomposition completed (created 2 new, reused 1 existing)", "计划拆解已完成（新建 2 项、复用 1 项现有任务）"],
      [{ status: "in_flight", requestedChildCount: 3 }, "decomposition in flight (3 requested)", "计划拆解进行中（已请求 3 项）"],
      [{ status: "completed" }, "decomposition completed", "计划拆解已完成"],
    ] as const;

    for (const [details, english] of cases) {
      expect(formatIssueActivityAction("issue.accepted_plan_decomposition_updated", details)).toBe(english);
    }
    await i18n.changeLanguage("zh-CN");
    translationState.locale = "zh-CN";
    for (const [details, _english, chinese] of cases) {
      expect(formatIssueActivityAction("issue.accepted_plan_decomposition_updated", details)).toBe(chinese);
    }
  });

  it("localizes issue updates and preserves raw participant labels and identifiers", async () => {
    const update = {
      assigneeAgentId: "missing-agent",
      reviewPolicy: "human_only",
      title: "raw title",
      description: "raw description",
    };
    const participant = { addedParticipants: [{ type: "user", userId: "usr-abcdef", agentId: null }], removedParticipants: [] };
    const blockers = { addedBlockedByIssues: [{ identifier: "PAP-42", title: "raw title" }], removedBlockedByIssues: [] };

    expect(formatIssueActivityAction("issue.updated", update)).toBe("made Agent responsible for the task, changed who can approve to human only, updated the title, updated the description");
    expect(formatIssueActivityAction("issue.reviewers_updated", participant)).toBe("added reviewer user usr-a");
    expect(formatActivityVerb("issue.blockers_updated", blockers)).toBe("added blocker PAP-42 to");

    await i18n.changeLanguage("zh-CN");
    translationState.locale = "zh-CN";
    expect(formatIssueActivityAction("issue.updated", update)).toBe("将任务负责人设为 智能体、将可审批者改为 仅限人工、已更新标题、已更新描述");
    expect(formatIssueActivityAction("issue.reviewers_updated", participant)).toBe("添加了复查人 用户 usr-a");
    expect(formatActivityVerb("issue.blockers_updated", blockers)).toBe("向其添加了阻塞项 PAP-42");
  });

  it("covers all status values and retains unknown enum fallbacks", async () => {
    const cases = [
      ["backlog", "changed status to backlog on", "将状态改为待规划："],
      ["cancelled", "changed status to cancelled on", "将状态改为已取消："],
      ["future_status", "changed status to future status on", "将状态改为future status："],
    ] as const;
    for (const [status, english] of cases) expect(formatActivityVerb("issue.updated", { status })).toBe(english);
    await i18n.changeLanguage("zh-CN");
    translationState.locale = "zh-CN";
    for (const [status, _english, chinese] of cases) expect(formatActivityVerb("issue.updated", { status })).toBe(chinese);
  });

  it("localizes monitor and tool-gateway grammar while preserving raw service and tool values", async () => {
    const serviceName = "svc-prod_v2";
    const rawTool = "pkg.tool-name_v2";
    const formattedTool = "pkg tool name v2";
    expect(formatIssueActivityAction("issue.monitor_triggered", { serviceName })).toBe("triggered a monitor for svc-prod_v2");
    const toolCases = [
      ["tool_gateway.call_completed", { tool: rawTool }, `used ${formattedTool} on`, `使用了 ${formattedTool}：`],
      ["tool_gateway.call_completed", { upstreamToolName: rawTool, source: "test" }, `tested ${formattedTool} on`, `测试了 ${formattedTool}：`],
      ["tool_gateway.call_allowed", { tool: rawTool }, `was allowed to use ${formattedTool} on`, `获准使用 ${formattedTool}：`],
      ["tool_gateway.call_allowed", { tool: rawTool, source: "test" }, `started a test of ${formattedTool} on`, `开始测试 ${formattedTool}：`],
      ["tool_gateway.call_denied", { tool: rawTool }, `was blocked from using ${formattedTool} on`, `被阻止使用 ${formattedTool}：`],
      ["tool_gateway.approval_requested", { tool: rawTool }, `asked to use ${formattedTool} on`, `请求使用 ${formattedTool}：`],
      ["tool_gateway.session_created", {}, "opened an app session for", "打开了应用会话："],
      ["tool_gateway.session_rejected", {}, "was blocked from opening an app session for", "被阻止打开应用会话："],
      ["tool_gateway.discovery", {}, "discovered app actions for", "发现了应用操作："],
    ] as const;
    for (const [action, details, english] of toolCases) expect(formatActivityVerb(action, details)).toBe(english);

    await i18n.changeLanguage("zh-CN");
    translationState.locale = "zh-CN";
    expect(formatIssueActivityAction("issue.monitor_triggered", { serviceName })).toBe("触发了监控（svc-prod_v2）");
    for (const [action, details, _english, chinese] of toolCases) expect(formatActivityVerb(action, details)).toBe(chinese);
  });

  it("uses semantic rows for company and tool connection actions", async () => {
    const rows = [
      ["company.updated", "updated organization", "更新了组织"],
      ["tool_app.oauth_failed", "failed to connect credentials for", "未能连接凭据："],
      ["tool_connection.grant_delegation_revoked", "revoked credential delegation for", "撤销了凭据委派："],
    ] as const;
    for (const [action, english] of rows) expect(translationState.translate(formatActivityVerb(action))).toBe(english);
    await i18n.changeLanguage("zh-CN");
    for (const [action, _english, chinese] of rows) expect(translationState.translate(formatActivityVerb(action))).toBe(chinese);
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

  it("uses localized next-step copy for successful-run handoff activity", async () => {
    expect(translationState.translate(formatActivityVerb("issue.successful_run_handoff_required"))).toBe("flagged missing next step on");
    expect(formatIssueActivityAction("issue.successful_run_handoff_required")).toBe("Run finished without a clear next step");
    expect(formatIssueActivityAction("issue.successful_run_handoff_resolved")).toBe("Next step chosen");
    expect(formatIssueActivityAction("issue.successful_run_handoff_escalated")).toBe(
      "Run finished without a next step - recovery escalated",
    );

    await i18n.changeLanguage("zh-CN");
    expect(translationState.translate(formatActivityVerb("issue.successful_run_handoff_required"))).toBe("标记了缺失的下一步：");
    expect(formatIssueActivityAction("issue.successful_run_handoff_required")).toBe("运行结束，但没有明确下一步");
    expect(formatIssueActivityAction("issue.successful_run_handoff_resolved")).toBe("已选择下一步");
    expect(formatIssueActivityAction("issue.successful_run_handoff_escalated")).toBe("运行结束，但没有下一步，已升级恢复处理");
  });
  describe("connected app activity", () => {
    const connectionId = "7f3c2a10-5b4e-4d2a-9c1f-0e8d6b5a4c3d";
    const gatewayName = "mcp.google-workspace-7f3c2a10:gmail-get-message";
    const internalName = /__|[a-z]_[a-z]|[0-9a-f]{8}-[0-9a-f]{4}|7f3c2a10/i;

    it("names Google Workspace actions with the same label as the Permissions page", () => {
      const details = { tool: gatewayName, upstreamToolName: "gmail__get_message", connectionId };
      expect(formatActivityVerb("tool_gateway.call_completed", details)).toBe("used Gmail: Get message on");
      expect(formatActivityVerb("tool_gateway.call_completed", { ...details, source: "test" })).toBe("tested Gmail: Get message on");
      expect(formatActivityVerb("tool_gateway.call_denied", details)).toBe("was blocked from using Gmail: Get message on");
      expect(formatActivityVerb("tool_gateway.approval_requested", details)).toBe("asked to use Gmail: Get message on");
      expect(formatActivityVerb("tool_gateway.call_completed", { ...details, toolTitle: "Read a message" }))
        .toBe("used Gmail: Read a message on");
      for (const action of [
        "tool_gateway.call_completed", "tool_gateway.call_allowed", "tool_gateway.call_denied",
        "tool_gateway.approval_requested", "tool_gateway.call_failed", "tool_gateway.call_deferred",
      ]) {
        expect(formatActivityVerb(action, details)).not.toMatch(internalName);
      }
    });

    it("keeps a readable name for other tools", () => {
      expect(formatActivityVerb("tool_gateway.call_completed", { tool: "get_repository" })).toBe("used get repository on");
      expect(formatActivityVerb("tool_gateway.call_completed", { tool: "create_issue", toolTitle: "Create issue" }))
        .toBe("used Create issue on");
      expect(formatActivityVerb("tool_gateway.call_denied", {})).toBe("was blocked from using an app action on");
    });

    it("describes failed and delayed calls in words", () => {
      const details = { upstreamToolName: "calendar__list_events" };
      expect(formatActivityVerb("tool_gateway.call_failed", details)).toBe("could not use Calendar: List events on");
      expect(formatActivityVerb("tool_gateway.call_deferred", details)).toBe("could not finish using Calendar: List events on");
      expect(formatActivityVerb("tool_gateway.call_deferred", { ...details, source: "test" })).toBe("could not finish testing Calendar: List events on");
    });

    it("drops the connection namespace when a row has only the gateway tool name", () => {
      const verb = formatActivityVerb("tool_gateway.call_failed", { tool: gatewayName, connectionId });
      expect(verb).toBe("could not use gmail get message on");
      expect(verb).not.toMatch(internalName);
    });

    it("drops the length-bound hash from a long gateway tool name", () => {
      const verb = formatActivityVerb("tool_gateway.call_failed", {
        tool: "mcp.app-gallery-github-connection:create-repository-0123456789abcdef",
        connectionId,
      });
      expect(verb).toBe("could not use create repository on");
    });

    it("names a Google connection when its removal reports Google access", () => {
      const providerAccess = { provider: "google", result: "ended", outcomes: [] };
      expect(translationState.translate(formatActivityVerb("tool_connection.archived", { transport: "remote_http", providerAccess }))).toBe("removed");
      expect(formatActivityEntityLabel("tool_connection", { providerAccess })).toBe("the Google Workspace connection");
      expect(formatActivityEntityLabel("tool_connection", { transport: "remote_http" })).toBe("the connection");
      expect(formatActivityOutcome("tool_connection.archived", { providerAccess })).toBeNull();
    });

    it("reads app removal as a sentence with the app's name", () => {
      const details = { type: "mcp", name: "Google Workspace", reason: "last_connection_removed" };
      expect(translationState.translate(formatActivityVerb("tool_application.archived", details))).toBe("removed");
      expect(formatActivityEntityLabel("tool_application", details)).toBe("Google Workspace");
      expect(formatActivityOutcome("tool_application.archived", details)).toBe("Its last connection was removed.");
      expect(formatActivityEntityLabel("tool_application", {})).toBe("the app");
      expect(formatActivityEntityLabel("heartbeat_run", {})).toBe("a run");
      expect(formatActivityEntityLabel("company", {})).toBe("the organization");
    });

    it("describes stored content deletion in words", () => {
      expect(translationState.translate(formatActivityVerb("tool_connection.content_deletion_requested"))).toBe("asked to delete stored content from");
      expect(translationState.translate(formatActivityVerb("tool_connection.content_deleted"))).toBe("deleted stored content from");
      expect(translationState.translate(formatActivityVerb("issue.connection_content_deleted"))).toBe("deleted connected app content from");
      expect(translationState.translate(formatActivityVerb("issue.connection_content_deletion_incomplete"))).toBe("partly deleted connected app content from");
      expect(formatIssueActivityAction("issue.connection_content_deleted")).toBe("deleted connected app content");
      expect(formatIssueActivityAction("issue.connection_content_deletion_incomplete"))
        .toBe("partly deleted connected app content; some is still in use");
    });

    it("reads connect and reconnect rows without internal names", () => {
      expect(translationState.translate(formatActivityVerb("tool_app.connected", { galleryKey: "google_workspace", applicationId: connectionId }))).toBe("connected");
      expect(translationState.translate(formatActivityVerb("tool_app.reconnected", { healthStatus: "healthy" }))).toBe("reconnected");
    });
  });
});

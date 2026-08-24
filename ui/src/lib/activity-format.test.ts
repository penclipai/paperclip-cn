import type { Agent } from "@penclipai/shared";
import { describe, expect, it } from "vitest";
import { formatActivityVerb, formatIssueActivityAction } from "./activity-format";

describe("activity formatting", () => {
  const agentMap = new Map<string, Agent>([
    ["agent-reviewer", { id: "agent-reviewer", name: "Reviewer Bot" } as Agent],
    ["agent-approver", { id: "agent-approver", name: "Approver Bot" } as Agent],
  ]);

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

  it("uses locale keys for environment and built-in routine activity", () => {
    expect(formatActivityVerb("environment.lease_acquired")).toBe("acquired environment lease");
    expect(formatActivityVerb("environment.lease_released")).toBe("released environment lease");
    expect(formatActivityVerb("built_in_agent.routine_reconciled")).toBe("built-in agent routine reconciled");
  });

  it("maps generated activity actions to locale-backed phrases", () => {
    const expectedPhrases = {
      "agent.instructions_file_updated": "updated agent instructions file",
      "auth.agent_jwt_run_header_mismatch": "recorded agent JWT run header mismatch",
      "built_in_agent.provisioned": "provisioned built-in agent",
      "built_in_agent.reset": "reset built-in agent",
      "built_in_agent.routine_reset": "reset built-in agent routine",
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
    };

    expect(Object.fromEntries(Object.keys(expectedPhrases).map((action) => [action, formatActivityVerb(action)])))
      .toEqual(expectedPhrases);
    expect(formatIssueActivityAction("issue.file_resource_resolve")).toBe("resolved an issue file reference");
    expect(formatIssueActivityAction("issue.thread_interaction_accepted")).toBe("accepted a thread interaction");
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

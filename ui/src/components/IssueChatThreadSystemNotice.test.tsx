// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import i18n from "i18next";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueChatThread } from "./IssueChatThread";
import type { IssueChatComment } from "../lib/issue-chat-messages";
import type { Agent, SuccessfulRunHandoffState } from "@penclipai/shared";

const { i18nLanguageRef, i18nTranslations } = vi.hoisted(() => ({
  i18nLanguageRef: { current: "en" },
  i18nTranslations: {
    "zh-CN": {
      "systemNotice.alert": "系统警报",
      "systemNotice.notice": "系统通知",
      "systemNotice.warning": "系统警告",
      "systemNotice.metadata.statusBefore": "之前状态",
      "systemNotice.metadata.cause": "原因",
      "systemNotice.metadata.completedRun": "已完成运行",
      "systemNotice.metadata.runContext": "运行上下文",
      "systemNotice.metadata.reason": "原因",
      "systemNotice.metadata.causeCode": "原因代码",
      "systemGenerated.outputSilence.criticalThresholdCrossed": "已超过关键输出静默阈值。",
      "systemGenerated.outputSilence.detectedOnActiveRun": "Paperclip 检测到此任务的活动运行已达到关键输出静默。",
      "systemGenerated.outputSilence.blocksSourceIssue": "这会通过明确的复查任务阻塞来源任务，但不会取消仍在活动的进程。",
      "systemGenerated.label.run": "运行",
      "systemGenerated.label.silentFor": "静默时长",
      "systemGenerated.label.lastOutputAt": "最后输出时间",
      "systemGenerated.label.evaluationIssue": "评估任务",
      "systemGenerated.duration.hours": "{{count}} 小时",
      "systemGenerated.value.noneRecorded": "未记录",
      "systemNotice.successfulRunHandoff.missingDispositionTitle": "缺少任务处置状态",
      "systemNotice.successfulRunHandoff.missingDispositionBody": "需要先为这个任务记录处置状态，才能继续推进。",
      "systemNotice.successfulRunHandoff.recoveryBlockedTitle": "缺少处置状态的恢复已阻塞",
      "systemNotice.successfulRunHandoff.recoveryBlockedBody": "系统无法自动补齐这个任务缺失的处置状态。该任务已阻塞，等待恢复负责人处理。",
      "systemNotice.successfulRunHandoff.requiredAction": "需要处理",
      "systemNotice.successfulRunHandoff.runEvidence": "运行依据",
      "systemNotice.successfulRunHandoff.recoveryOwner": "恢复负责人",
      "systemNotice.successfulRunHandoff.sourceIssue": "来源任务",
      "systemNotice.successfulRunHandoff.assignee": "负责人",
      "systemNotice.successfulRunHandoff.missingDisposition": "缺失处置状态",
      "systemNotice.successfulRunHandoff.validDispositions": "有效处置状态",
      "systemNotice.successfulRunHandoff.successfulRun": "成功运行",
      "systemNotice.successfulRunHandoff.runStatus": "运行状态",
      "systemNotice.successfulRunHandoff.normalizedCause": "归一化原因",
      "systemNotice.successfulRunHandoff.detectedProgress": "检测到的进展",
      "systemNotice.successfulRunHandoff.automaticRetry": "自动重试",
      "systemNotice.successfulRunHandoff.recoveryIssue": "恢复任务",
      "systemNotice.successfulRunHandoff.sourceAssignee": "来源负责人",
      "systemNotice.successfulRunHandoff.suggestedAction": "建议操作",
      "systemNotice.successfulRunHandoff.sourceRun": "来源运行",
      "systemNotice.successfulRunHandoff.correctiveHandoffRun": "修正交接运行",
      "systemNotice.successfulRunHandoff.latestIssueStatus": "最新任务状态",
      "systemNotice.successfulRunHandoff.latestHandoffRunStatus": "最新交接运行状态",
      "systemNotice.successfulRunHandoff.value.clearNextStep": "补充下一步处置",
      "systemNotice.successfulRunHandoff.value.validDispositions": "已完成、已取消、带负责人的审核中、带阻塞项的已阻塞、委派后续任务，或明确继续执行",
      "systemNotice.successfulRunHandoff.value.successfulRunMissingState": "成功运行缺少任务处置状态",
      "systemNotice.successfulRunHandoff.value.usefulOutputNoActionEvidence": "运行产出了有用内容，但没有记录具体行动依据",
      "systemNotice.successfulRunHandoff.value.correctiveHandoffQueued": "已排队一次修正性交接唤醒",
      "systemNotice.successfulRunHandoff.value.chooseValidDisposition": "选择并记录有效的任务处置状态，不要复制运行记录内容",
      "Status": "状态",
      "unknown": "未知",
      "status.done": "已完成",
      "status.failed": "失败",
      "status.inProgress": "进行中",
      "status.succeeded": "成功",
    },
  } as Record<string, Record<string, string>>,
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  const { translateForTest } = await import("../test-utils/i18n");
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => {
        return translateForTest(
          key,
          options,
          i18nLanguageRef.current,
          i18nTranslations[i18nLanguageRef.current],
        );
      },
      i18n: {
        language: i18nLanguageRef.current,
        resolvedLanguage: i18nLanguageRef.current,
        changeLanguage: vi.fn(async (language: string) => {
          i18nLanguageRef.current = language;
        }),
      },
    }),
  };
});

vi.mock("@assistant-ui/react", () => ({
  AssistantRuntimeProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useAui: () => ({ thread: () => ({ append: async () => undefined }) }),
}));

vi.mock("./transcript/useLiveRunTranscripts", () => ({
  useLiveRunTranscripts: () => ({
    transcriptByRun: new Map(),
    hasOutputForRun: () => false,
  }),
}));

vi.mock("./MarkdownBody", () => ({
  MarkdownBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: () => <textarea aria-label="Issue chat editor" />,
}));

vi.mock("./InlineEntitySelector", () => ({ InlineEntitySelector: () => null }));
vi.mock("./Identity", () => ({ Identity: ({ name }: { name: string }) => <span>{name}</span> }));
vi.mock("./OutputFeedbackButtons", () => ({ OutputFeedbackButtons: () => null }));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./AgentIconPicker", () => ({ AgentIcon: () => null }));
vi.mock("./StatusBadge", () => ({ StatusBadge: ({ status }: { status: string }) => <span>{status}</span> }));
vi.mock("./IssueLinkQuicklook", () => ({
  IssueLinkQuicklook: ({
    children,
    to,
  }: {
    children: ReactNode;
    to: string;
  }) => <a href={to}>{children}</a>,
}));
vi.mock("../hooks/usePaperclipIssueRuntime", () => ({
  usePaperclipIssueRuntime: () => ({}),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  i18nLanguageRef.current = "en";
  container = document.createElement("div");
  document.body.appendChild(container);
  window.scrollTo = vi.fn();
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

function renderThread(
  comments: IssueChatComment[],
  options: {
    agentMap?: Map<string, Agent>;
    issueStatus?: string;
    successfulRunHandoff?: SuccessfulRunHandoffState | null;
  } = {},
) {
  void i18n.changeLanguage(i18nLanguageRef.current);
  act(() => {
    root.render(
      <MemoryRouter>
        <IssueChatThread
          comments={comments}
          linkedRuns={[]}
          timelineEvents={[]}
          liveRuns={[]}
          onAdd={async () => {}}
          showComposer={false}
          enableLiveTranscriptPolling={false}
          agentMap={options.agentMap}
          issueStatus={options.issueStatus}
          successfulRunHandoff={options.successfulRunHandoff}
        />
      </MemoryRouter>,
    );
  });
}

const baseTimestamps = {
  createdAt: new Date("2026-05-04T16:32:00.000Z"),
  updatedAt: new Date("2026-05-04T16:32:00.000Z"),
};

describe("IssueChatThread system notice routing", () => {
  it("renders authorType=system comments as a SystemNotice rather than a user bubble", () => {
    const comment: IssueChatComment = {
      id: "comment-system",
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "system",
      authorAgentId: null,
      authorUserId: null,
      body: "Paperclip needs a disposition before this issue can continue.",
      presentation: {
        kind: "system_notice",
        tone: "warning",
        title: "Missing issue disposition",
        detailsDefaultOpen: false,
      },
      metadata: {
        version: 1,
        sections: [
          {
            title: "Required action",
            rows: [
              { type: "issue_link", label: "Source issue", issueId: "i1", identifier: "PAP-3440", title: "Recovery" },
              { type: "key_value", label: "Status before", value: "in_progress" },
            ],
          },
        ],
      },
      ...baseTimestamps,
    };

    renderThread([comment]);

    const row = container.querySelector('[data-message-role="system"]');
    expect(row).not.toBeNull();
    const status = row?.querySelector('[role="status"]');
    expect(status?.getAttribute("aria-label")).toBe("Missing issue disposition");
    expect(container.textContent).toContain("Paperclip needs a disposition");
    // collapsed by default — metadata identifier should not be visible
    expect(container.textContent).not.toContain("PAP-3440");
    const toggle = row?.querySelector("button[aria-expanded]") as HTMLButtonElement | null;
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll('[data-message-role="user"]').length).toBe(0);
  });

  it("localizes known successful-run handoff system notices in Chinese", () => {
    i18nLanguageRef.current = "zh-CN";
    const comment: IssueChatComment = {
      id: "comment-system-zh",
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "system",
      authorAgentId: null,
      authorUserId: null,
      body: "Paperclip needs a disposition before this issue can continue.",
      presentation: {
        kind: "system_notice",
        tone: "warning",
        title: "Missing issue disposition",
        detailsDefaultOpen: true,
      },
      metadata: {
        version: 1,
        sections: [
          {
            title: "Required action",
            rows: [
              { type: "issue_link", label: "Source issue", issueId: "i1", identifier: "PAP-3440", title: "Recovery" },
              { type: "key_value", label: "Missing disposition", value: "clear_next_step" },
              {
                type: "key_value",
                label: "Valid dispositions",
                value: "done, cancelled, in_review with an owner, blocked with blockers, delegated follow-up, or explicit continuation",
              },
            ],
          },
          {
            title: "Run evidence",
            rows: [
              { type: "run_link", label: "Successful run", runId: "run-1", title: "succeeded" },
              { type: "key_value", label: "Run status", value: "succeeded" },
              { type: "key_value", label: "Normalized cause", value: "successful_run_missing_state" },
              {
                type: "key_value",
                label: "Detected progress",
                value: "Run produced useful output but no concrete action evidence",
              },
              { type: "key_value", label: "Automatic retry", value: "one corrective handoff wake queued" },
            ],
          },
        ],
      },
      ...baseTimestamps,
    };

    renderThread([comment]);

    const status = container.querySelector('[role="status"]');
    expect(status?.getAttribute("aria-label")).toBe("缺少任务处置状态");
    expect(container.textContent).toContain("需要先为这个任务记录处置状态");
    expect(container.textContent).toContain("需要处理");
    expect(container.textContent).toContain("来源任务");
    expect(container.textContent).toContain("运行依据");
    expect(container.textContent).toContain("成功运行");
    expect(container.textContent).toContain("缺失处置状态");
    expect(container.textContent).toContain("补充下一步处置");
    expect(container.textContent).toContain("有效处置状态");
    expect(container.textContent).toContain("已完成、已取消、带负责人的审核中");
    expect(container.textContent).toContain("运行状态");
    expect(container.textContent).toContain("归一化原因");
    expect(container.textContent).toContain("成功运行缺少任务处置状态");
    expect(container.textContent).toContain("检测到的进展");
    expect(container.textContent).toContain("运行产出了有用内容，但没有记录具体行动依据");
    expect(container.textContent).toContain("自动重试");
    expect(container.textContent).toContain("已排队一次修正性交接唤醒");
    expect(container.textContent).not.toContain("Missing issue disposition");
    expect(container.textContent).not.toContain("Paperclip needs a disposition");
    expect(container.textContent).not.toContain("clear_next_step");
    expect(container.textContent).not.toContain("successful_run_missing_state");
    expect(container.textContent).not.toContain("one corrective handoff wake queued");
    expect(container.textContent).not.toContain("in_review with an owner");
  });

  it("localizes output-silence system notice bodies in Chinese", () => {
    i18nLanguageRef.current = "zh-CN";
    const comment: IssueChatComment = {
      id: "comment-output-silence-zh",
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "system",
      authorAgentId: null,
      authorUserId: null,
      body: [
        "Critical output silence threshold crossed.",
        "",
        "- Run: `da7d59e5-7eec-4c3b-8019-b15157d3fcf1`",
        "- Silent for: 4h",
        "- Last output at: none recorded",
        "- Evaluation issue: BIG-52",
        "",
        "Paperclip detected critical output silence on this issue's active run.",
        "This blocks the source issue on the explicit review task without cancelling the active process.",
      ].join("\n"),
      presentation: {
        kind: "system_notice",
        tone: "info",
        title: null,
        detailsDefaultOpen: false,
      },
      metadata: null,
      ...baseTimestamps,
    };

    renderThread([comment]);

    expect(container.textContent).toContain("已超过关键输出静默阈值。");
    expect(container.textContent).toContain("运行：`da7d59e5-7eec-4c3b-8019-b15157d3fcf1`");
    expect(container.textContent).toContain("静默时长：4 小时");
    expect(container.textContent).toContain("最后输出时间：未记录");
    expect(container.textContent).toContain("评估任务：BIG-52");
    expect(container.textContent).toContain("Paperclip 检测到此任务的活动运行已达到关键输出静默。");
    expect(container.textContent).toContain("这会通过明确的复查任务阻塞来源任务");
    expect(container.textContent).not.toContain("Critical output silence threshold crossed");
    expect(container.textContent).not.toContain("Silent for");
    expect(container.textContent).not.toContain("Last output at");
  });

  it("localizes recovery-blocked system notice metadata values in Chinese", () => {
    i18nLanguageRef.current = "zh-CN";
    const comment: IssueChatComment = {
      id: "comment-recovery-blocked-zh",
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "system",
      authorAgentId: null,
      authorUserId: null,
      body: "Paperclip could not resolve this issue's missing disposition automatically. The issue is blocked on a recovery owner.",
      presentation: {
        kind: "system_notice",
        tone: "danger",
        title: "Missing disposition recovery blocked",
        detailsDefaultOpen: true,
      },
      metadata: {
        version: 1,
        sections: [
          {
            title: "Recovery owner",
            rows: [
              {
                type: "issue_link",
                label: "Source issue",
                issueId: "issue-3",
                identifier: "BIG-3",
                title: "Review productivity for BIG-2",
              },
              {
                type: "issue_link",
                label: "Recovery issue",
                issueId: "issue-5",
                identifier: "BIG-5",
                title: "Recover missing next step",
              },
              { type: "agent_link", label: "Recovery owner", agentId: "agent-ceo", name: "CEO" },
              { type: "agent_link", label: "Source assignee", agentId: "agent-ceo", name: "CEO" },
              {
                type: "key_value",
                label: "Suggested action",
                value: "choose and record a valid issue disposition without copying transcript content",
              },
            ],
          },
          {
            title: "Run evidence",
            rows: [
              { type: "run_link", label: "Source run", runId: "run-source", title: "succeeded" },
              { type: "run_link", label: "Corrective handoff run", runId: "run-corrective", title: "in_progress" },
              { type: "key_value", label: "Latest issue status", value: "in_progress" },
              { type: "key_value", label: "Latest handoff run status", value: "succeeded" },
              { type: "key_value", label: "Normalized cause", value: "successful_run_missing_state" },
              { type: "key_value", label: "Missing disposition", value: "clear_next_step" },
            ],
          },
        ],
      },
      ...baseTimestamps,
    };

    renderThread([comment]);

    expect(container.textContent).toContain("缺少处置状态的恢复已阻塞");
    expect(container.textContent).toContain("恢复负责人");
    expect(container.textContent).toContain("恢复任务");
    expect(container.textContent).toContain("建议操作");
    expect(container.textContent).toContain("选择并记录有效的任务处置状态，不要复制运行记录内容");
    expect(container.textContent).toContain("来源运行");
    expect(container.textContent).toContain("修正交接运行");
    expect(container.textContent).toContain("最新任务状态");
    expect(container.textContent).toContain("最新交接运行状态");
    expect(container.textContent).toContain("进行中");
    expect(container.textContent).toContain("成功");
    expect(container.textContent).toContain("成功运行缺少任务处置状态");
    expect(container.textContent).toContain("补充下一步处置");
    expect(container.textContent).toContain("Review productivity for BIG-2");
    expect(container.textContent).toContain("CEO");
    expect(container.textContent).not.toContain("choose and record a valid issue disposition");
    expect(container.textContent).not.toContain("successful_run_missing_state");
    expect(container.textContent).not.toContain("clear_next_step");
    expect(container.textContent).not.toContain("in_progress");
    expect(container.textContent).not.toContain("succeeded");
  });

  it("localizes generic system notice metadata labels and enum values in Chinese", () => {
    i18nLanguageRef.current = "zh-CN";
    const comment: IssueChatComment = {
      id: "comment-generic-metadata-zh",
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "system",
      authorAgentId: null,
      authorUserId: null,
      body: "System recovery completed.",
      presentation: {
        kind: "system_notice",
        tone: "info",
        title: null,
        detailsDefaultOpen: true,
      },
      metadata: {
        version: 1,
        sections: [
          {
            title: "Run context",
            rows: [
              { type: "key_value", label: "Status before", value: "in_progress" },
              { type: "key_value", label: "Status", value: "done" },
              { type: "key_value", label: "Cause", value: "successful_run_missing_state" },
              { type: "key_value", label: "Reason", value: "unknown" },
              { type: "run_link", label: "Completed run", runId: "run-generic", title: "failed" },
              { type: "code", label: "Cause code", code: "missing_disposition" },
            ],
          },
        ],
      },
      ...baseTimestamps,
    };

    renderThread([comment]);

    expect(container.textContent).toContain("运行上下文");
    expect(container.textContent).toContain("之前状态");
    expect(container.textContent).toContain("进行中");
    expect(container.textContent).toContain("状态");
    expect(container.textContent).toContain("已完成");
    expect(container.textContent).toContain("原因");
    expect(container.textContent).toContain("成功运行缺少任务处置状态");
    expect(container.textContent).toContain("未知");
    expect(container.textContent).toContain("已完成运行");
    expect(container.textContent).toContain("失败");
    expect(container.textContent).toContain("原因代码");
    expect(container.textContent).toContain("missing_disposition");
    expect(container.textContent).not.toContain("Status before");
    expect(container.textContent).not.toContain("in_progress");
    expect(container.textContent).not.toContain("successful_run_missing_state");
    expect(container.textContent).not.toContain("unknown");
  });

  it("expands metadata when detailsDefaultOpen is true", () => {
    const comment: IssueChatComment = {
      id: "comment-system-open",
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "system",
      authorAgentId: null,
      authorUserId: null,
      body: "Recovery escalated.",
      presentation: {
        kind: "system_notice",
        tone: "danger",
        title: null,
        detailsDefaultOpen: true,
      },
      metadata: {
        version: 1,
        sections: [
          {
            rows: [
              { type: "agent_link", label: "Owner", agentId: "agent-cto", name: "CTO" },
            ],
          },
        ],
      },
      ...baseTimestamps,
    };

    renderThread([comment]);

    const status = container.querySelector('[role="status"]');
    expect(status?.getAttribute("aria-label")).toBe("System alert");
    expect(container.textContent).toContain("CTO");
    const toggle = container.querySelector("button[aria-expanded]");
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  });

  it("falls back to legacy user bubble + handoff callout for old text-only comments", () => {
    const comment: IssueChatComment = {
      id: "comment-legacy",
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "user",
      authorAgentId: null,
      authorUserId: "user-1",
      body: "## Successful run missing issue disposition\n\nFix this.",
      presentation: null,
      metadata: null,
      ...baseTimestamps,
    };

    renderThread([comment]);

    expect(container.querySelector('[role="status"]')).toBeNull();
    const userRow = container.querySelector('[data-message-role="user"]');
    expect(userRow).not.toBeNull();
    expect(container.textContent).toContain("Successful run missing issue disposition");
  });

  it("keeps regular user comments rendering as user bubbles", () => {
    const comment: IssueChatComment = {
      id: "comment-user",
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "user",
      authorAgentId: null,
      authorUserId: "user-1",
      body: "Standard user message.",
      presentation: null,
      metadata: null,
      ...baseTimestamps,
    };

    renderThread([comment]);

    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[data-message-role="user"]')).not.toBeNull();
    expect(container.textContent).toContain("Standard user message.");
  });

  it("keeps agent-authored comments rendering as assistant bubbles even with system_notice presentation absent", () => {
    const comment: IssueChatComment = {
      id: "comment-agent",
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "agent",
      authorAgentId: "agent-1",
      authorUserId: null,
      body: "Agent reply",
      presentation: null,
      metadata: null,
      ...baseTimestamps,
    };

    renderThread([comment]);

    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[data-message-role="assistant"]')).not.toBeNull();
  });

  it("labels system notice source as the originating run agent name when runAgentId is available", () => {
    const codexAgent = {
      id: "agent-codex",
      name: "CodexCoder",
    } as unknown as Agent;
    const agentMap = new Map<string, Agent>([[codexAgent.id, codexAgent]]);
    const comment: IssueChatComment = {
      id: "comment-system-runagent",
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "system",
      authorAgentId: null,
      authorUserId: null,
      runId: "run-issue-chat-01",
      runAgentId: "agent-codex",
      body: "Paperclip needs a disposition before this issue can continue.",
      presentation: {
        kind: "system_notice",
        tone: "warning",
        title: "Missing issue disposition",
        detailsDefaultOpen: false,
      },
      metadata: null,
      ...baseTimestamps,
    };

    renderThread([comment], { agentMap });

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    const sourceLink = status?.querySelector('a[href^="/agents/"]') as HTMLAnchorElement | null;
    expect(sourceLink?.getAttribute("href")).toBe("/agents/agent-codex/runs/run-issue-chat-01");
    expect(sourceLink?.textContent).toBe("CodexCoder");
    expect(sourceLink?.textContent).not.toBe("You");
  });

  it("shows copy-link feedback on the link button only", async () => {
    const writeText = vi.fn(async () => undefined);
    const originalSecureContext = Object.getOwnPropertyDescriptor(window, "isSecureContext");
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const comment: IssueChatComment = {
      id: "comment-copy-link",
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "system",
      authorAgentId: null,
      authorUserId: null,
      body: "System recovery completed.",
      presentation: {
        kind: "system_notice",
        tone: "success",
        title: null,
        detailsDefaultOpen: false,
      },
      metadata: null,
      ...baseTimestamps,
    };

    renderThread([comment]);

    const copyLink = container.querySelector('button[aria-label="Copy link to system notice"]') as HTMLButtonElement;
    const copyText = container.querySelector('button[aria-label="Copy system notice"]') as HTMLButtonElement;
    await act(async () => {
      copyLink.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("#comment-comment-copy-link"));
    expect(copyLink.querySelector(".lucide-check")).not.toBeNull();
    expect(copyText.querySelector(".lucide-check")).toBeNull();
    if (originalSecureContext) {
      Object.defineProperty(window, "isSecureContext", originalSecureContext);
    } else {
      // @ts-expect-error test cleanup for optional browser API
      delete window.isSecureContext;
    }
  });

  it("labels system notice source as Paperclip when no run agent can be resolved", () => {
    const comment: IssueChatComment = {
      id: "comment-system-no-author",
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "system",
      authorAgentId: null,
      authorUserId: null,
      runId: null,
      runAgentId: null,
      body: "System recovery completed.",
      presentation: {
        kind: "system_notice",
        tone: "info",
        title: null,
        detailsDefaultOpen: false,
      },
      metadata: null,
      ...baseTimestamps,
    };

    renderThread([comment]);

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain("Paperclip");
    expect(status?.textContent).not.toContain("You");
  });

  it("falls back to the CN brand in the system notice header when run agent is unknown to agentMap", () => {
    const comment: IssueChatComment = {
      id: "comment-system-unknown-agent",
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "system",
      authorAgentId: null,
      authorUserId: null,
      runId: "run-xyz",
      runAgentId: "agent-unknown",
      body: "Disposition required.",
      presentation: {
        kind: "system_notice",
        tone: "warning",
        title: null,
        detailsDefaultOpen: false,
      },
      metadata: null,
      ...baseTimestamps,
    };

    renderThread([comment]);

    const status = container.querySelector('[role="status"]');
    const sourceLink = status?.querySelector('a[href^="/agents/"]') as HTMLAnchorElement | null;
    expect(sourceLink?.getAttribute("href")).toBe("/agents/agent-unknown/runs/run-xyz");
    expect(sourceLink?.textContent).toBe("Paperclip CN");
  });

  it("routes agent-authored comments to the notice renderer when presentation requests system_notice", () => {
    const owner = { id: "agent-1", name: "ClaudeCoder" } as unknown as Agent;
    const agentMap = new Map<string, Agent>([[owner.id, owner]]);
    const comment: IssueChatComment = {
      id: "comment-agent-system",
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "agent",
      authorAgentId: "agent-1",
      authorUserId: null,
      runId: "run-owner",
      runAgentId: "agent-1",
      body: "Reassigned to ClaudeFixer.",
      presentation: {
        kind: "system_notice",
        tone: "neutral",
        title: "Recovery reassignment",
        detailsDefaultOpen: false,
      },
      metadata: null,
      ...baseTimestamps,
    };

    renderThread([comment], { agentMap });

    // No longer an assistant bubble — it collapses like a system notice.
    expect(container.querySelector('[data-message-role="assistant"]')).toBeNull();
    const row = container.querySelector('[data-message-role="system"]');
    expect(row).not.toBeNull();
    const status = row?.querySelector('[role="status"]');
    expect(status?.getAttribute("aria-label")).toBe("Recovery reassignment");
    // The real author's name + run link stay visible on the notice.
    const sourceLink = status?.querySelector('a[href^="/agents/"]') as HTMLAnchorElement | null;
    expect(sourceLink?.getAttribute("href")).toBe("/agents/agent-1/runs/run-owner");
    expect(sourceLink?.textContent).toBe("ClaudeCoder");
  });

  it("collapses compact system notices to a single quiet row and expands to the full card", () => {
    const comment: IssueChatComment = {
      id: "comment-compact",
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "system",
      authorAgentId: null,
      authorUserId: null,
      runId: "run-recovery",
      runAgentId: "agent-codex",
      body: "Recovery escalated to the CTO after repeated stalls.",
      presentation: {
        kind: "system_notice",
        tone: "warning",
        title: "Recovery escalated",
        detailsDefaultOpen: false,
        density: "compact",
      },
      metadata: {
        version: 1,
        sections: [
          {
            title: "Escalation",
            rows: [{ type: "agent_link", label: "Owner", agentId: "agent-cto", name: "CTO" }],
          },
        ],
      },
      ...baseTimestamps,
    };

    renderThread([comment]);

    const row = container.querySelector('[data-testid="compact-system-notice"]');
    expect(row).not.toBeNull();
    // Collapsed: title + timestamp + chevron visible, but body/card hidden.
    expect(row?.textContent).toContain("Recovery escalated");
    expect(row?.querySelector('[data-testid="compact-system-notice-time"]')).not.toBeNull();
    expect(row?.querySelector(".lucide-chevron-down")).not.toBeNull();
    const toggle = row?.querySelector("button[aria-expanded]") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const detailsId = toggle.getAttribute("aria-controls");
    const details = detailsId ? container.ownerDocument.getElementById(detailsId) : null;
    expect(details).not.toBeNull();
    expect(details).toHaveProperty("hidden", true);
    // The full SystemNotice card lives inside the collapsed region.
    expect(details?.querySelector('[role="status"]')).not.toBeNull();

    act(() => {
      toggle.click();
    });

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(details).toHaveProperty("hidden", false);
    expect(details?.textContent).toContain("Recovery escalated to the CTO");
  });

  it("renders a compact notice already expanded when detailsDefaultOpen is true", () => {
    const comment: IssueChatComment = {
      id: "comment-compact-open",
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "system",
      authorAgentId: null,
      authorUserId: null,
      body: "Recovery escalated to the CTO.",
      presentation: {
        kind: "system_notice",
        tone: "danger",
        title: "Recovery escalated",
        detailsDefaultOpen: true,
        density: "compact",
      },
      metadata: null,
      ...baseTimestamps,
    };

    renderThread([comment]);

    const row = container.querySelector('[data-testid="compact-system-notice"]');
    expect(row).not.toBeNull();
    const toggle = row?.querySelector("button[aria-expanded]") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const detailsId = toggle.getAttribute("aria-controls");
    const details = detailsId ? container.ownerDocument.getElementById(detailsId) : null;
    expect(details).toHaveProperty("hidden", false);
    expect(details?.querySelector('[role="status"]')).not.toBeNull();
    expect(details?.textContent).toContain("Recovery escalated to the CTO.");
  });

  it("keeps the author visible on a compact agent-authored notice row", () => {
    const owner = { id: "agent-1", name: "ClaudeCoder" } as unknown as Agent;
    const agentMap = new Map<string, Agent>([[owner.id, owner]]);
    const comment: IssueChatComment = {
      id: "comment-compact-agent",
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "agent",
      authorAgentId: "agent-1",
      authorUserId: null,
      body: "Picked this back up after the wake.",
      presentation: {
        kind: "system_notice",
        tone: "neutral",
        title: "Recovery owner update",
        detailsDefaultOpen: false,
        density: "compact",
      },
      metadata: null,
      ...baseTimestamps,
    };

    renderThread([comment], { agentMap });

    const row = container.querySelector('[data-testid="compact-system-notice"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("Recovery owner update");
    // Author name shows on the collapsed row itself.
    expect(row?.querySelector("button[aria-expanded]")?.textContent).toContain("ClaudeCoder");
  });

  it("keeps notices without density rendering as the full card (graceful fallback)", () => {
    const comment: IssueChatComment = {
      id: "comment-no-density",
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "system",
      authorAgentId: null,
      authorUserId: null,
      body: "Recovery completed.",
      presentation: {
        kind: "system_notice",
        tone: "success",
        title: "Recovery completed",
        detailsDefaultOpen: false,
      },
      metadata: null,
      ...baseTimestamps,
    };

    renderThread([comment]);

    expect(container.querySelector('[data-testid="compact-system-notice"]')).toBeNull();
    const status = container.querySelector('[role="status"]');
    expect(status?.getAttribute("aria-label")).toBe("Recovery completed");
    // Body is visible immediately on the full card.
    expect(status?.textContent).toContain("Recovery completed.");
  });

  it("folds stale successful-run disposition warnings into the activity log disclosure style", () => {
    const comment: IssueChatComment = {
      id: "comment-stale-disposition-warning",
      companyId: "company-1",
      issueId: "issue-1",
      authorType: "system",
      authorAgentId: null,
      authorUserId: null,
      runId: "run-stale",
      runAgentId: "agent-codex",
      body: "Paperclip needs a disposition before this issue can continue.",
      presentation: {
        kind: "system_notice",
        tone: "warning",
        title: "Missing issue disposition",
        detailsDefaultOpen: false,
      },
      metadata: {
        version: 1,
        sourceRunId: "run-stale",
        sections: [
          {
            title: "Run evidence",
            rows: [
              { type: "run_link", label: "Completed run", runId: "run-stale", title: "succeeded" },
              { type: "key_value", label: "Normalized cause", value: "successful_run_missing_state" },
            ],
          },
        ],
      },
      ...baseTimestamps,
    };

    renderThread([comment], {
      issueStatus: "done",
      successfulRunHandoff: {
        state: "resolved",
        required: false,
        hasLiveContinuation: false,
        sourceRunId: "run-stale",
        correctiveRunId: "run-corrective",
        assigneeAgentId: "agent-codex",
        detectedProgressSummary: null,
        createdAt: new Date("2026-05-04T17:00:00.000Z"),
      },
    });

    const row = container.querySelector('[data-testid="stale-disposition-warning"]');
    expect(row).not.toBeNull();
    expect(row?.querySelector('span[aria-hidden="true"]')?.className).toContain("size-6");
    const toggle = row?.querySelector("button[aria-expanded]") as HTMLButtonElement;
    expect(toggle.className).toContain("w-full");
    expect(toggle.className).toContain("py-0.5");
    expect(row?.querySelector('[role="status"]')).toBeNull();
    expect(row?.querySelector(".lucide-triangle-alert")).toBeNull();
    expect(row?.querySelector(".lucide-chevron-down")).not.toBeNull();
    expect(row?.querySelector('[data-testid="stale-disposition-warning-time"]')?.parentElement?.className).toContain("ml-auto");
    expect(row?.textContent).toContain("Stale disposition warning");
    expect(row?.textContent).not.toContain("This disposition warning is stale because the issue now has a newer disposition.");
    expect(row?.textContent).not.toContain("Paperclip needs a disposition before this issue can continue.");

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const detailsId = toggle.getAttribute("aria-controls");
    expect(detailsId).toBeTruthy();
    const details = detailsId ? container.ownerDocument.getElementById(detailsId) : null;
    expect(details).not.toBeNull();
    expect(details?.textContent).toContain("run-stale");
    expect(details).toHaveProperty("hidden", true);
    act(() => {
      toggle.click();
    });

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(details).toHaveProperty("hidden", false);
    expect(container.textContent).toContain("run-stale");
  });
});

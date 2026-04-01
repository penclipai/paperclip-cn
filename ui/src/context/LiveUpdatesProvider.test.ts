// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { __liveUpdatesTestUtils } from "./LiveUpdatesProvider";
import { queryKeys } from "../lib/queryKeys";

function buildFakeT(translations: Record<string, string>) {
  return ((key: string, options?: Record<string, unknown>) => {
    const template = translations[key] ?? (typeof options?.defaultValue === "string" ? options.defaultValue : key);
    return template.replace(/{{(\w+)}}/g, (_, name: string) => String(options?.[name] ?? ""));
  }) as never;
}

describe("LiveUpdatesProvider issue invalidation", () => {
  it("refreshes touched inbox queries for issue activity", () => {
    const invalidations: unknown[] = [];
    const queryClient = {
      invalidateQueries: (input: unknown) => {
        invalidations.push(input);
      },
      getQueryData: () => undefined,
    };

    __liveUpdatesTestUtils.invalidateActivityQueries(
      queryClient as never,
      "company-1",
      {
        entityType: "issue",
        entityId: "issue-1",
        details: null,
      },
    );

    expect(invalidations).toContainEqual({
      queryKey: queryKeys.issues.listMineByMe("company-1"),
    });
    expect(invalidations).toContainEqual({
      queryKey: queryKeys.issues.listTouchedByMe("company-1"),
    });
    expect(invalidations).toContainEqual({
      queryKey: queryKeys.issues.listUnreadTouchedByMe("company-1"),
    });
  });
});

describe("LiveUpdatesProvider visible issue toast suppression", () => {
  it("suppresses activity toasts for the issue page currently in view", () => {
    const queryClient = {
      getQueryData: (key: unknown) => {
        if (JSON.stringify(key) === JSON.stringify(queryKeys.issues.detail("PAP-759"))) {
          return {
            id: "issue-1",
            identifier: "PAP-759",
            assigneeAgentId: "agent-1",
          };
        }
        return undefined;
      },
    };

    expect(
      __liveUpdatesTestUtils.shouldSuppressActivityToastForVisibleIssue(
        queryClient as never,
        "/PAP/issues/PAP-759",
        {
          entityType: "issue",
          entityId: "issue-1",
          details: { identifier: "PAP-759" },
        },
        { isForegrounded: true },
      ),
    ).toBe(true);

    expect(
      __liveUpdatesTestUtils.shouldSuppressActivityToastForVisibleIssue(
        queryClient as never,
        "/PAP/issues/PAP-759",
        {
          entityType: "issue",
          entityId: "issue-2",
          details: { identifier: "PAP-760" },
        },
        { isForegrounded: true },
      ),
    ).toBe(false);
  });

  it("suppresses run and agent status toasts for the assignee of the visible issue", () => {
    const queryClient = {
      getQueryData: (key: unknown) => {
        if (JSON.stringify(key) === JSON.stringify(queryKeys.issues.detail("PAP-759"))) {
          return {
            id: "issue-1",
            identifier: "PAP-759",
            assigneeAgentId: "agent-1",
          };
        }
        return undefined;
      },
    };

    expect(
      __liveUpdatesTestUtils.shouldSuppressRunStatusToastForVisibleIssue(
        queryClient as never,
        "/PAP/issues/PAP-759",
        {
          runId: "run-1",
          agentId: "agent-1",
        },
        { isForegrounded: true },
      ),
    ).toBe(true);

    expect(
      __liveUpdatesTestUtils.shouldSuppressAgentStatusToastForVisibleIssue(
        queryClient as never,
        "/PAP/issues/PAP-759",
        {
          agentId: "agent-1",
          status: "running",
        },
        { isForegrounded: true },
      ),
    ).toBe(true);
  });
});

describe("LiveUpdatesProvider run lifecycle toasts", () => {
  it("routes issue activity copy through translation helpers", () => {
    const queryClient = {
      getQueryData: (key: unknown) => {
        if (JSON.stringify(key) === JSON.stringify(queryKeys.issues.detail("issue-1"))) {
          return {
            id: "issue-1",
            identifier: "PAP-759",
            title: "Fix localization regression",
          };
        }
        if (JSON.stringify(key) === JSON.stringify(queryKeys.issues.list("company-1"))) {
          return [
            {
              id: "issue-1",
              identifier: "PAP-759",
              title: "Fix localization regression",
            },
          ];
        }
        return undefined;
      },
    };
    const t = buildFakeT({
      "liveUpdates.actor.board": "董事会",
      "liveUpdates.activity.issueUpdatedTitle": "{{actor}} 更新了 {{issueRef}}",
      "liveUpdates.action.viewIssue": "查看 {{issueRef}}",
      "liveUpdates.issueUpdate.statusChanged": "状态 -> {{status}}",
      "liveUpdates.issueUpdate.priorityChanged": "优先级 -> {{priority}}",
      "status.inProgress": "进行中",
      "priority.high": "高",
    });

    const toast = __liveUpdatesTestUtils.buildActivityToastWithT(
      t,
      queryClient as never,
      "company-1",
      {
        entityType: "issue",
        entityId: "issue-1",
        action: "issue.updated",
        actorType: "user",
        actorId: "user-1",
        details: {
          identifier: "PAP-759",
          status: "in_progress",
          priority: "high",
        },
      },
      { userId: null, agentId: null },
    );

    expect(toast).toMatchObject({
      title: "董事会 更新了 PAP-759",
      tone: "info",
      action: {
        label: "查看 PAP-759",
        href: "/issues/PAP-759",
      },
    });
    expect(toast?.body).toContain("状态 -> 进行中");
    expect(toast?.body).toContain("优先级 -> 高");
  });

  it("does not build start or success toasts for agent runs", () => {
    const queryClient = {
      getQueryData: () => [],
    };

    expect(
      __liveUpdatesTestUtils.buildAgentStatusToast(
        {
          agentId: "agent-1",
          status: "running",
        },
        () => "CodexCoder",
        queryClient as never,
        "company-1",
      ),
    ).toBeNull();

    expect(
      __liveUpdatesTestUtils.buildRunStatusToast(
        {
          runId: "run-1",
          agentId: "agent-1",
          status: "succeeded",
        },
        () => "CodexCoder",
      ),
    ).toBeNull();
  });

  it("still builds failure toasts for agent errors and failed runs", () => {
    const queryClient = {
      getQueryData: () => [
        {
          id: "agent-1",
          title: "Software Engineer",
        },
      ],
    };

    expect(
      __liveUpdatesTestUtils.buildAgentStatusToast(
        {
          agentId: "agent-1",
          status: "error",
        },
        () => "CodexCoder",
        queryClient as never,
        "company-1",
      ),
    ).toMatchObject({
      title: "CodexCoder errored",
      body: "Software Engineer",
      tone: "error",
    });

    expect(
      __liveUpdatesTestUtils.buildRunStatusToast(
        {
          runId: "run-1",
          agentId: "agent-1",
          status: "failed",
          error: "boom",
        },
        () => "CodexCoder",
      ),
    ).toMatchObject({
      title: "CodexCoder run failed",
      body: "boom",
      tone: "error",
    });
  });

  it("routes run status copy through translation helpers", () => {
    const t = buildFakeT({
      "liveUpdates.runStatus.failedTitle": "{{name}} 运行失败",
      "liveUpdates.runStatus.triggerDetail": "触发来源：{{triggerDetail}}",
      "liveUpdates.action.viewRun": "查看运行",
    });

    expect(
      __liveUpdatesTestUtils.buildRunStatusToastWithT(
        t,
        {
          runId: "run-1",
          agentId: "agent-1",
          status: "failed",
          triggerDetail: "timer",
        },
        () => "CodexCoder",
      ),
    ).toMatchObject({
      title: "CodexCoder 运行失败",
      body: "触发来源：timer",
      tone: "error",
      action: {
        label: "查看运行",
        href: "/agents/agent-1/runs/run-1",
      },
    });
  });
});

describe("LiveUpdatesProvider socket helpers", () => {
  it("waits for the selected company object to catch up before connecting", () => {
    expect(__liveUpdatesTestUtils.resolveLiveCompanyId("company-1", null)).toBeNull();
    expect(__liveUpdatesTestUtils.resolveLiveCompanyId("company-1", "company-2")).toBeNull();
    expect(__liveUpdatesTestUtils.resolveLiveCompanyId("company-1", "company-1")).toBe("company-1");
  });

  it("defers close until onopen for sockets that are still connecting", () => {
    const socket = {
      readyState: 0,
      onopen: (() => undefined) as (() => void) | null,
      onmessage: (() => undefined) as (() => void) | null,
      onerror: (() => undefined) as (() => void) | null,
      onclose: (() => undefined) as (() => void) | null,
      close: vi.fn(),
    };

    __liveUpdatesTestUtils.closeSocketQuietly(socket as never, "provider_unmount");

    expect(socket.close).not.toHaveBeenCalled();
    expect(socket.onmessage).toBeNull();
    expect(socket.onclose).toBeNull();
    expect(socket.onopen).toBeTypeOf("function");
    expect(socket.onerror).toBeTypeOf("function");

    socket.onopen?.();

    expect(socket.close).toHaveBeenCalledWith(1000, "provider_unmount");
    expect(socket.onopen).toBeNull();
    expect(socket.onerror).toBeNull();
  });

  it("closes open sockets immediately without leaving handlers behind", () => {
    const socket = {
      readyState: 1,
      onopen: (() => undefined) as (() => void) | null,
      onmessage: (() => undefined) as (() => void) | null,
      onerror: (() => undefined) as (() => void) | null,
      onclose: (() => undefined) as (() => void) | null,
      close: vi.fn(),
    };

    __liveUpdatesTestUtils.closeSocketQuietly(socket as never, "stale_connection");

    expect(socket.close).toHaveBeenCalledWith(1000, "stale_connection");
    expect(socket.onopen).toBeNull();
    expect(socket.onmessage).toBeNull();
    expect(socket.onerror).toBeNull();
    expect(socket.onclose).toBeNull();
  });
});

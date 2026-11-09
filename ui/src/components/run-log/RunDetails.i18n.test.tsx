// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceOperation } from "@penclipai/shared";
import i18n from "../../i18n";
import { RunInvocationCard, WorkspaceOperationsSection } from "./RunDetails";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const resources = {
  en: {
    "runDetails.invocation": "Invocation",
    "runDetails.adapterLabel": "Adapter:",
    "runDetails.workspaceCount": "Workspace ({{count}})",
    "runDetails.phase.worktreePrepare": "Worktree setup",
    "runDetails.status.succeeded": "Succeeded",
    "runDetails.commandLabel": "Command:",
    "runLogViewer.stdoutExcerpt": "stdout excerpt",
  },
  "zh-CN": {
    "runDetails.invocation": "调用信息",
    "runDetails.adapterLabel": "适配器：",
    "runDetails.workspaceCount": "工作区（{{count}}）",
    "runDetails.phase.worktreePrepare": "工作树设置",
    "runDetails.status.succeeded": "成功",
    "runDetails.commandLabel": "命令：",
    "runLogViewer.stdoutExcerpt": "标准输出摘录",
  },
};

describe("run-log localization", () => {
  let container: HTMLDivElement;

  beforeEach(async () => {
    for (const [language, resource] of Object.entries(resources)) {
      i18n.addResourceBundle(language, "common", resource, true, true);
    }
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    container.remove();
    await i18n.changeLanguage("en");
  });

  it("switches owned labels without changing raw command and log output", async () => {
    const root = createRoot(container);
    const operation = {
      id: "operation-1",
      phase: "worktree_prepare",
      status: "succeeded",
      startedAt: "2026-11-10T00:00:00.000Z",
      command: "pnpm penclip dev",
      stdoutExcerpt: "原始日志 🚀 stdout --help",
      metadata: null,
    } as unknown as WorkspaceOperation;
    const unknownStatusOperation = {
      ...operation,
      id: "operation-unknown",
      status: "provider_custom_state",
    } as unknown as WorkspaceOperation;

    await act(async () => {
      root.render(<>
        <RunInvocationCard
          payload={{ adapterType: "provider-model-id" }}
          censorUsernameInLogs={false}
        />
        <WorkspaceOperationsSection operations={[operation, unknownStatusOperation]} censorUsernameInLogs={false} />
      </>);
    });

    expect(container.textContent).toContain("Invocation");
    expect(container.textContent).toContain("Workspace (2)");
    expect(container.textContent).toContain("Succeeded");
    expect(container.textContent).toContain("provider_custom_state");
    expect(container.textContent).toContain("pnpm penclip dev");
    expect(container.textContent).toContain("原始日志 🚀 stdout --help");
    expect(container.textContent).toContain("provider-model-id");

    await act(async () => { await i18n.changeLanguage("zh-CN"); });

    expect(container.textContent).toContain("调用信息");
    expect(container.textContent).toContain("工作区（2）");
    expect(container.textContent).toContain("工作树设置");
    expect(container.textContent).toContain("成功");
    expect(container.textContent).toContain("provider_custom_state");
    expect(container.textContent).toContain("标准输出摘录");
    expect(container.textContent).toContain("pnpm penclip dev");
    expect(container.textContent).toContain("原始日志 🚀 stdout --help");
    expect(container.textContent).toContain("provider-model-id");

    await act(async () => root.unmount());
  });
});

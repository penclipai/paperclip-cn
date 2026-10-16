// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DotConnectionChecks, ExternalAgentInviteContent, ExternalAgentPresetPicker } from "./ExternalAgentInviteContent";
import { Dialog } from "../ui/dialog";

const language = vi.hoisted(() => ({ value: "zh-CN" as "en" | "zh-CN" }));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  const { translateForTest } = await import("@/test-utils/i18n");
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => translateForTest(key, options, language.value),
      i18n: { language: language.value, resolvedLanguage: language.value },
    }),
  };
});

describe("ExternalAgentInviteContent localization", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    language.value = "zh-CN";
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
  });

  it("renders translated preset descriptions and Dot connection state", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<><ExternalAgentPresetPicker onSelect={() => {}} /><DotConnectionChecks state={{ phase: "connected" }} /></>);
    });

    expect(container.textContent).toContain("其他");
    expect(container.textContent).toContain("任何可以连接到 Paperclip 的智能体");
    expect(container.textContent).toContain("已连接到 Paperclip");
    expect(container.textContent).toContain("你的 Dot 已连接。正在等待它启用任务更新。");

    root.unmount();
  });

  it("renders the complete normal invitation description in zh-CN", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<Dialog open><ExternalAgentInviteContent
          preset="other"
          prompt="invite prompt"
          companyName="Acme"
          connection={{ phase: "waiting" }}
          onSelect={() => {}}
          onBack={() => {}}
          onClose={() => {}}
          onCopied={() => {}}
          onRetry={() => {}}
          onNewPrompt={() => {}}
        /></Dialog>);
    });

    expect(container.textContent).toContain("邀请中包含你的智能体加入 Acme 所需的全部信息。你可以在授予访问权限前查看其请求。");

    root.unmount();
  });
});

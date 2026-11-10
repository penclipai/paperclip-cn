// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Agent } from "@penclipai/shared";
import i18n from "i18next";
import { CoordinatorAgentSwitcher } from "./CoordinatorAgentSwitcher";

vi.mock("./AgentChatPicker", () => ({
  AgentChatPicker: ({ trigger }: { trigger: ReactNode }) => trigger,
}));
vi.mock("./AgentAvatar", () => ({ AgentAvatar: () => null }));
vi.mock("@/hooks/useAgentChatNavigation", () => ({
  useAgentChatNavigation: () => ({ agents: { data: [], isPending: false }, chats: { data: [] } }),
}));
vi.mock("@/lib/router", () => ({ useNavigate: () => vi.fn() }));

it("updates switcher labels on language change while preserving the agent name", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const agent = { id: "custom-agent", name: "My Codex 工程师", role: "engineer" } as Agent;
  try {
    await act(async () => root.render(<CoordinatorAgentSwitcher agent={agent} />));
    const button = container.querySelector("button")!;
    expect(button.getAttribute("title")).toBe("Switch agent");
    expect(button.getAttribute("aria-label")).toBe("Switch agent. Currently My Codex 工程师");
    await act(async () => { await i18n.changeLanguage("zh-CN"); });
    expect(button.getAttribute("title")).toBe("切换智能体");
    expect(button.getAttribute("aria-label")).toBe("切换智能体，当前为 My Codex 工程师");
    expect(container.textContent).toBe(agent.name);
    await act(async () => { await i18n.changeLanguage("en"); });
    expect(button.getAttribute("aria-label")).toBe("Switch agent. Currently My Codex 工程师");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    await i18n.changeLanguage("en");
    vi.unstubAllGlobals();
  }
});

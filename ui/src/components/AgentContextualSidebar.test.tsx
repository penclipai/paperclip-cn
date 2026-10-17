// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AgentContextualSidebar } from "./AgentContextualSidebar";
import { queryKeys } from "@/lib/queryKeys";
import i18n from "@/i18n";

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

vi.mock("./ContextualSidebarFrame", () => ({
  ContextualSidebarFrame: ({
    title,
    showHeader,
    className,
    children,
  }: {
    title: string;
    showHeader?: boolean;
    className?: string;
    children: React.ReactNode;
  }) => (
    <aside data-title={title} data-show-header={String(showHeader)} className={className}>
      {children}
    </aside>
  ),
}));

vi.mock("./SidebarNavItem", () => ({
  SidebarNavItem: ({ to, label }: { to: string; label: string }) => <a href={to}>{label}</a>,
}));

describe("AgentContextualSidebar", () => {
  it.each([false, true])("keeps Channels available for default email regardless of the chat setting (%s)", (enabled) => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.instance.experimentalSettings, { enableChatConnectors: enabled });
    const markup = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter>
      <AgentContextualSidebar agentRef="agent" agentId="agent-1" agentName="Agent" />
    </MemoryRouter></QueryClientProvider>);
    expect(markup.includes('href="/agents/agent/channels"')).toBe(true);
    expect(markup).toContain('href="/agents/agent/tools"');
    client.clear();
  });
  it("renders local definition/runtime/governance links and scoped Audit links", () => {
    const queryClient = new QueryClient();
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/agents/codexcoder/runtime"]}>
          <AgentContextualSidebar agentRef="codexcoder" agentId="agent-1" agentName="Codex Coder" />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).toContain("Codex Coder");
    expect(markup).toContain('aria-label="Codex Coder navigation"');
    expect(markup).toContain('data-show-header="false"');
    expect(markup).toContain("border-r border-border bg-background");
    expect(markup).toContain('data-slot="contextual-sidebar-nav"');
    expect(markup).toContain('href="/agents/codexcoder/overview"');
    expect(markup).toContain('href="/agents/codexcoder/permissions"');
    expect(markup).toContain('href="/agents/codexcoder/api-keys"');
    expect(markup).toContain('href="/activity?mode=agents&amp;agentId=agent-1"');
    expect(markup).toContain('href="/activity/runs?agentId=agent-1"');
    expect(markup).toContain("Harness / Runtime");
    expect(markup).toContain("Permissions / Trust");
  });

  it("localizes navigation labels while preserving explicit caller overrides", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      const queryClient = new QueryClient();
      const markup = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <AgentContextualSidebar
              agentRef="agent"
              agentId="agent-1"
              agentName="Agent"
              labels={{ secrets: "Caller override" }}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      );

      expect(markup).toContain("运行环境");
      expect(markup).toContain('aria-label="Agent的导航"');
      expect(markup).toContain("治理");
      expect(markup).toContain("执行框架 / 运行环境");
      expect(markup).toContain("权限 / 信任");
      expect(markup).toContain("Caller override");
      queryClient.clear();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it.each([
    ["en", "Agent navigation"],
    ["zh-CN", "智能体的导航"],
  ])("localizes the missing agent name and accessible navigation label in %s", async (language, expectedLabel) => {
    await i18n.changeLanguage(language);
    const queryClient = new QueryClient();
    try {
      const markup = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <AgentContextualSidebar agentRef="agent" agentId="agent-1" />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      const container = document.createElement("div");
      container.innerHTML = markup;
      expect(container.querySelector("nav")?.getAttribute("aria-label")).toBe(expectedLabel);
    } finally {
      queryClient.clear();
      await i18n.changeLanguage("en");
    }
  });
});

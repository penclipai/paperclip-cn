// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { AgentDetail } from "./AgentDetail";

const breadcrumbs = vi.hoisted(() => vi.fn());

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ companies: [], selectedCompanyId: null, setSelectedCompanyId: vi.fn() }),
}));
vi.mock("../context/PanelContext", () => ({ usePanel: () => ({ closePanel: vi.fn() }) }));
vi.mock("../context/SidebarContext", () => ({ useSidebar: () => ({ isMobile: false }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: breadcrumbs }) }));
vi.mock("../hooks/useResourceMemberships", () => ({
  isStarred: () => false,
  resourceMembershipState: () => "joined",
  useResourceMembershipMutation: () => ({ isPending: false }),
  useResourceMemberships: () => ({ data: undefined }),
}));
vi.mock("../components/AgentLifecycleStatus", () => ({
  AgentLifecycleStatus: () => null,
  useAgentLifecycleStatus: () => ({ isError: false }),
}));
vi.mock("../api/access", () => ({ accessApi: { getCurrentBoardAccess: vi.fn(async () => null) } }));
vi.mock("@/lib/router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Navigate: () => null,
  useBeforeUnload: () => {},
  useNavigate: () => vi.fn(),
  useParams: () => ({ agentId: "agent-1", tab: "runtime" }),
}));

describe("AgentDetail breadcrumbs", () => {
  let root: Root;
  let container: HTMLDivElement;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    breadcrumbs.mockClear();
    await i18n.changeLanguage("en");
  });

  it("refreshes the route-backed breadcrumb when the language changes", async () => {
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await act(async () => {
      root.render(<QueryClientProvider client={client}><AgentDetail /></QueryClientProvider>);
    });
    expect(breadcrumbs).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ label: "Harness / Runtime" }),
    ]));

    await act(async () => { await i18n.changeLanguage("zh-CN"); });
    expect(breadcrumbs).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ label: "执行框架 / 运行环境" }),
    ]));

    await act(async () => { await i18n.changeLanguage("en"); });
    expect(breadcrumbs).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ label: "Harness / Runtime" }),
    ]));
    client.clear();
  });
});

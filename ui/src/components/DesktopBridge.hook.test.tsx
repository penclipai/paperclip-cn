// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";

const { companyState, navigate, navigation } = vi.hoisted(() => ({
  companyState: { id: "company-1" },
  navigate: vi.fn(),
  navigation: { handler: null as ((path: string) => void) | null, unsubscribe: vi.fn() },
}));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: companyState.id }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en", resolvedLanguage: "en" } }),
}));
vi.mock("@/lib/router", () => ({ useNavigate: () => navigate }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: vi.fn() } }));
vi.mock("@/api/health", () => ({ healthApi: { get: vi.fn() } }));

import { DesktopBridge } from "./DesktopBridge";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DesktopBridge", () => {
  let client: QueryClient;
  let root: Root;
  let container: HTMLDivElement;
  let setContext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    companyState.id = "company-1";
    navigate.mockReset();
    navigation.handler = null;
    navigation.unsubscribe.mockReset();
    navigation.unsubscribe.mockReturnValue(undefined);
    setContext = vi.fn().mockResolvedValue(true);
    window.desktopShell = {
      isDesktop: true,
      setContext,
      onNavigate: vi.fn((handler) => {
        navigation.handler = handler;
        return navigation.unsubscribe;
      }),
    } as unknown as typeof window.desktopShell;
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(queryKeys.auth.session, { user: { id: "viewer" }, session: { id: "session", userId: "viewer" } });
    client.setQueryData(queryKeys.health, { deploymentMode: "cloud" });
    client.setQueryData(queryKeys.liveRuns("company-1"), [{ id: "run-1", status: "running" }]);
    client.setQueryData(queryKeys.liveRuns("company-2"), [{ id: "run-2", status: "running" }]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
    window.desktopShell = undefined;
    vi.clearAllMocks();
  });

  async function render() {
    await act(async () => root.render(<QueryClientProvider client={client}><DesktopBridge /></QueryClientProvider>));
    await act(async () => Promise.resolve());
  }

  it("sends fresh context, clears before a company switch, refreshes equal counts, and clears on sign-out", async () => {
    await render();
    expect(setContext).toHaveBeenCalledWith(expect.objectContaining({ companyId: "company-1", activeRuns: 1 }));

    const beforeRefresh = setContext.mock.calls.length;
    client.setQueryData(queryKeys.liveRuns("company-1"), [{ id: "run-1", status: "running", refreshed: true }]);
    await act(async () => Promise.resolve());
    expect(setContext.mock.calls.length).toBeGreaterThan(beforeRefresh);

    companyState.id = "company-2";
    await render();
    const companyTwoCalls = setContext.mock.calls.map(([value]) => value).filter((value) => value.companyId === "company-2");
    expect(companyTwoCalls[0]).toMatchObject({ activeRuns: null });
    expect(companyTwoCalls[1]).toMatchObject({ activeRuns: 1 });

    await act(async () => {
      client.setQueryData(queryKeys.auth.session, null);
      await Promise.resolve();
    });
    await render();
    expect(setContext).toHaveBeenLastCalledWith({ locale: "en", companyId: null, activeRuns: null });
  });

  it("accepts a native internal route, ignores unsafe routes, and clears context on unmount", async () => {
    await render();
    navigation.handler?.("/agents/agent-1");
    navigation.handler?.("/auth/login");
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/agents/agent-1");
    await act(async () => root.unmount());
    expect(navigation.unsubscribe).toHaveBeenCalledOnce();
    expect(setContext).toHaveBeenLastCalledWith({ locale: "en", companyId: null, activeRuns: null });
  });
});

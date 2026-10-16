// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolConnection } from "@penclipai/shared";
import { RemoteMcpProductionSetup } from "./RemoteMcpProductionSetup";

const language = vi.hoisted(() => ({ value: "zh-CN" as "en" | "zh-CN" }));
const mockToolsApi = vi.hoisted(() => ({
  getConnectionInstalls: vi.fn(),
  connectApp: vi.fn(),
  updateConnection: vi.fn(),
  putConnectionInstalls: vi.fn(),
  startOAuth: vi.fn(),
  finishApp: vi.fn(),
  syncAggregatorApps: vi.fn(),
}));
const mockAgentsApi = vi.hoisted(() => ({ list: vi.fn() }));
const mockQueries = vi.hoisted(() => ({ invalidateQueries: vi.fn(), fetchQuery: vi.fn(), setQueryData: vi.fn() }));
const queryResults = vi.hoisted(() => ({
  installs: { installs: [{ targetType: "company", targetId: "company-1" }] },
  agents: [] as unknown[],
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  const { translateForTest } = await import("../../../test-utils/i18n");
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => translateForTest(key, options, language.value),
      i18n: { language: language.value, resolvedLanguage: language.value },
    }),
  };
});

vi.mock("@/api/tools", () => ({ toolsApi: mockToolsApi }));
vi.mock("@/api/agents", () => ({ agentsApi: mockAgentsApi }));
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => ({
      data: queryKey[0] === "agents" ? queryResults.agents : queryResults.installs,
      isError: false,
    }),
    useQueryClient: () => mockQueries,
  };
});
vi.mock("@/api/companies-query", () => ({ resolveAccountUserId: vi.fn() }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1" }) }));
vi.mock("@/lib/router", () => ({ useNavigate: () => vi.fn(), useSearchParams: () => [new URLSearchParams()] }));
vi.mock("@/lib/browserNavigation", () => ({ navigateTopLevel: vi.fn() }));
vi.mock("../ConnectionInstructions", () => ({ ConnectionInstructionsEditor: () => null }));
vi.mock("../ConnectionSetupFlow", () => ({ readConnectionIntentOAuthOutcome: vi.fn() }));
vi.mock("./RemoteMcpConnectionSetup", () => ({
  RemoteMcpConnectionSetup: ({ state, actions }: { state: { notice: string | null }; actions: { connect: () => void } }) => (
    <section>
      <p role="status">{state.notice}</p>
      <button type="button" onClick={actions.connect}>connect</button>
    </section>
  ),
}));

async function flushReact() {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

const apiKeyConnection = {
  id: "connection-1",
  companyId: "company-1",
  applicationId: "application-1",
  name: "Composio",
  uid: "composio-connection-1",
  connectionKind: "managed",
  connectionPurpose: "tool",
  ownership: "customer",
  transport: "mcp_remote",
  authKind: "api_key",
  credentialSource: "paperclip_vault",
  credentialPolicy: "shared",
  status: "active",
  transportConfig: {},
  config: { url: "https://mcp.example.test" },
  credentialSecretRefs: [],
  healthStatus: "healthy",
  healthCheckedAt: null,
  lastError: null,
  enabled: true,
  createdByAgentId: null,
  createdByUserId: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
} as ToolConnection;

describe("RemoteMcpProductionSetup localization", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let queryClient: QueryClient;

  async function render() {
    await act(async () => {
      root.render(<QueryClientProvider client={queryClient}><RemoteMcpProductionSetup providerId="composio" connection={apiKeyConnection} /></QueryClientProvider>);
      await flushReact();
    });
  }

  beforeEach(() => {
    language.value = "zh-CN";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockAgentsApi.list.mockResolvedValue([]);
    mockToolsApi.getConnectionInstalls.mockResolvedValue({ installs: [{ targetType: "company", targetId: "company-1" }] });
    mockToolsApi.connectApp.mockRejectedValue("network failure");
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.clearAllMocks();
  });

  it("localizes credential retention and generic connection failures without translating raw errors", async () => {
    await render();
    expect(container.textContent).toContain("这些字段留空时会保留已保存的凭据。仅在需要更改时输入替换值。");

    language.value = "en";
    await render();
    expect(container.textContent).toContain("Saved credentials are retained when these fields are left blank.");

    language.value = "zh-CN";
    await render();
    await act(async () => {
      (container.querySelector("button") as HTMLButtonElement).click();
      await flushReact();
    });
    expect(container.textContent).toContain("无法连接，请重试。");

    language.value = "en";
    await render();
    expect(container.textContent).toContain("Could not connect. Please try again.");

    mockToolsApi.connectApp.mockRejectedValueOnce(new Error("provider error nonce"));
    await act(async () => {
      (container.querySelector("button") as HTMLButtonElement).click();
      await flushReact();
    });
    expect(container.textContent).toContain("provider error nonce");

    language.value = "zh-CN";
    await render();
    expect(container.textContent).toContain("provider error nonce");
  });
});

// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { aiConnectionRouterAppDefinition } from "@penclipai/shared";
import i18n from "@/i18n";
import { AiConnectionPoolConnector } from "./AiConnectionPoolConnector";

const api = vi.hoisted(() => ({ list: vi.fn(), pools: vi.fn(), gallery: vi.fn(), agents: vi.fn(), inspect: vi.fn(), setBreadcrumbs: vi.fn() }));
vi.mock("@/api/ai-connections", () => ({ aiConnectionsApi: { list: api.list } }));
vi.mock("@/api/ai-connection-pools", () => ({ aiConnectionPoolsApi: { list: api.pools, save: vi.fn(), remove: vi.fn(), inspect: api.inspect } }));
vi.mock("@/api/tools", () => ({ toolsApi: { listGallery: api.gallery } }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: api.agents } }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company" }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: api.setBreadcrumbs }) }));
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ pushToast: vi.fn() }) }));
vi.mock("@/lib/router", () => ({ Link: (props: ComponentProps<"a">) => <a {...props} />, useNavigate: () => vi.fn() }));
vi.mock("@/pages/apps/AppLogo", () => ({ AppLogo: () => null }));
vi.mock("@/pages/apps/AppDetail", () => ({ AppDetailHeader: ({ appName }: { appName: string }) => <div data-testid="pool-name">{appName}</div> }));
vi.mock("@/features/connections/ConnectionSetupHeader", () => ({ StepHeader: ({ title, subtitle, labels }: { title: string; subtitle: string; labels: string[] }) => <header><h1>{title}</h1><p>{subtitle}</p><span>{labels.join("/")}</span></header> }));
vi.mock("./AiConnectionUsagePanel", () => ({ AiConnectionUsagePanel: () => null }));

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let previousActEnvironment: boolean | undefined;
async function waitFor(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    check();
  }, { interval: 10, timeout: 1000 });
}
function render(connection?: { id: string }) {
  root.render(<QueryClientProvider client={client}><AiConnectionPoolConnector pluginKey="pool" connection={connection as never} /></QueryClientProvider>);
}
beforeEach(async () => {
  const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.list.mockResolvedValue({ canManageConnections: true, connections: [] });
  api.inspect.mockResolvedValue({});
  api.pools.mockResolvedValue([]); api.gallery.mockResolvedValue({ apps: [aiConnectionRouterAppDefinition("pool", { name: "Pool", description: "Pool" })] }); api.agents.mockResolvedValue([]);
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); client.clear(); vi.clearAllMocks();
  const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  if (previousActEnvironment === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT;
  else environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

it("localizes wizard steps and actions in place while retaining raw account names", async () => {
  api.list.mockResolvedValue({ canManageConnections: true, connections: [{ id: "account", grantId: "grant", provider: "openai", method: "api_key", name: "Raw Account Ω", ownership: "shared", status: "connected" }] });
  await act(async () => render());
  await waitFor(() => expect(container.textContent).toContain("Choose connections you already use."));
  expect(container.textContent).toContain("Choose connections you already use.");
  expect(container.textContent).toContain("Raw Account Ω");
  expect(container.textContent).toContain("Cancel");
  const account = container.querySelector('[aria-label="Raw Account Ω"]') as HTMLButtonElement;
  await act(async () => account.click());
  const continueButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Continue")!;
  await act(async () => continueButton.click());
  expect(container.textContent).toContain("New tasks rotate in this order.");
  expect(container.textContent).toContain("Back");
  await act(async () => { await i18n.changeLanguage("zh-CN"); });
  expect(container.textContent).toContain("新任务将按此顺序轮换。");
  expect(container.textContent).toContain("创建连接池");
  expect(container.textContent).toContain("返回");
  expect(container.textContent).toContain("Raw Account Ω");
  expect(container.querySelector('[aria-label="将 Raw Account Ω 上移"]')).not.toBeNull();
  expect(api.setBreadcrumbs).toHaveBeenLastCalledWith([{ label: "连接器", href: "/apps" }, { label: "添加连接池" }]);
  const back = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "返回")!;
  await act(async () => back.click());
  expect(container.textContent).toContain("取消");
  expect(container.textContent).toContain("继续");
});

it("preserves the existing pool name and an edited model after a language change", async () => {
  api.list.mockResolvedValue({ canManageConnections: true, connections: [{ id: "account", grantId: "grant", provider: "openai", method: "api_key", name: "Raw Account Ω", ownership: "shared", status: "connected" }] });
  api.pools.mockResolvedValue([{ id: "pool-id", pluginKey: "pool", revision: 1, name: "Owner pool Ω", enabled: false, members: [{ id: "member", binding: { mode: "shared", provider: "openai", method: "api_key", connectionId: "account", grantId: "grant" }, profile: { provider: "codex", model: "initial/model" } }], mode: "round_robin", thresholdPercent: 90 }]);
  await act(async () => render({ id: "pool-id" }));
  await waitFor(() => expect(container.querySelector('[data-testid="pool-name"]')?.textContent).toBe("Owner pool Ω"));
  expect(container.querySelector('[data-testid="pool-name"]')?.textContent).toBe("Owner pool Ω");
  const model = container.querySelector('input[aria-label="Model for connection 1"]');
  expect(model).toBeInstanceOf(HTMLInputElement);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(model, "custom/model");
    model!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { await i18n.changeLanguage("zh-CN"); });
  expect(container.querySelector('[data-testid="pool-name"]')?.textContent).toBe("Owner pool Ω");
  expect((container.querySelector('input[aria-label="连接 1 的模型"]') as HTMLInputElement).value).toBe("custom/model");
});

it("updates an app-owned inspection failure when the locale changes", async () => {
  api.inspect.mockRejectedValue(new Error("provider detail stays outside this app-owned fallback"));
  api.list.mockResolvedValue({ canManageConnections: true, connections: [{ id: "account", grantId: "grant", provider: "openai", method: "api_key", name: "Raw Account Ω", ownership: "shared", status: "connected" }] });
  api.pools.mockResolvedValue([{ id: "pool-id", pluginKey: "pool", revision: 1, name: "Owner pool Ω", enabled: false, members: [{ id: "member", binding: { mode: "shared", provider: "openai", method: "api_key", connectionId: "account", grantId: "grant" }, profile: { provider: "codex", model: "raw/model" } }], mode: "usage_aware", thresholdPercent: 90 }]);
  await act(async () => render({ id: "pool-id" }));
  await waitFor(() => expect(container.textContent).toContain("Usage unavailable."));
  await act(async () => { await i18n.changeLanguage("zh-CN"); });
  expect(container.textContent).toContain("用量信息不可用。");
  expect(container.textContent).not.toContain("Usage unavailable.");
  expect(container.querySelector('[data-testid="pool-name"]')?.textContent).toBe("Owner pool Ω");
});

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolConnection } from "@penclipai/shared";
import i18n from "@/i18n";
import { ComposioAppSetup } from "./ComposioAppSetup";

const setupComposioAppMock = vi.hoisted(() => vi.fn());
const pushToastMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/tools", () => ({ toolsApi: { setupComposioApp: setupComposioAppMock } }));
vi.mock("@/api/companies-query", () => ({ useAccountIdentity: () => ({ userId: "user", settled: true, failed: false }) }));
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ pushToast: pushToastMock }) }));

function connection(): ToolConnection {
  return {
    id: "raw-account-id",
    companyId: "company",
    applicationId: "application",
    name: "Raw Account Ω",
    uid: "raw-account-id",
    connectionKind: "managed",
    connectionPurpose: "tool",
    ownership: "customer",
    transport: "mcp_remote",
    authKind: "oauth",
    credentialSource: "paperclip_vault",
    credentialPolicy: "shared",
    status: "active",
    transportConfig: {},
    config: {},
    credentialSecretRefs: [],
    healthStatus: "healthy",
    healthCheckedAt: null,
    lastError: null,
    enabled: true,
    createdByAgentId: null,
    createdByUserId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

describe("ComposioAppSetup", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    client.clear();
    container.remove();
    await i18n.changeLanguage("en");
    vi.clearAllMocks();
  });

  function render() {
    root.render(<QueryClientProvider client={client}><ComposioAppSetup name="Raw App Ω" toolkit="RAW_COMPOSIO_TOOLKIT" connections={[connection()]} onClose={vi.fn()} onBack={vi.fn()} onConnectNew={vi.fn()} /></QueryClientProvider>);
  }

  it("updates pending and follow-up actions in place while retaining raw account and app values", async () => {
    let resolveSetup: (value: { status: "authorization_required"; authorizationUrl: string }) => void;
    setupComposioAppMock.mockReturnValueOnce(new Promise((resolve) => { resolveSetup = resolve; }));
    await act(async () => { render(); });
    expect(document.body.textContent).toContain("Composio account");
    expect(document.body.textContent).toContain("Raw Account Ω");
    const continueButton = Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Continue")!;
    await act(async () => { continueButton.click(); });
    expect(document.body.textContent).toContain("Checking…");

    await act(async () => { await i18n.changeLanguage("zh-CN"); });
    expect(document.body.textContent).toContain("Composio 账户");
    expect(document.body.textContent).toContain("正在检查…");
    expect(document.body.textContent).toContain("Raw Account Ω");

    await act(async () => { resolveSetup!({ status: "authorization_required", authorizationUrl: "https://composio.example/authorize" }); });
    expect(document.body.textContent).toContain("请在 Composio 中完成 Raw App Ω 的连接，然后返回此处。");
    expect(document.body.textContent).toContain("在 Composio 中连接 Raw App Ω");
    expect(document.body.textContent).toContain("获取新链接");
    expect(document.body.textContent).toContain("我已完成连接");
  });

  it("re-renders the app-owned fallback after a locale change while preserving server errors", async () => {
    setupComposioAppMock.mockRejectedValueOnce({});
    await act(async () => { render(); });
    await act(async () => {
      Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Continue")!.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(document.body.textContent).toContain("Couldn’t configure this app. Try again."));

    await act(async () => { await i18n.changeLanguage("zh-CN"); });
    expect(document.body.textContent).toContain("无法配置此应用，请重试。");
    expect(document.body.textContent).toContain("Raw Account Ω");
    expect(setupComposioAppMock).toHaveBeenCalledWith("raw-account-id", "RAW_COMPOSIO_TOOLKIT", { action: "start" });

    setupComposioAppMock.mockRejectedValueOnce(new Error("Raw provider error Ω"));
    await act(async () => {
      Array.from(document.querySelectorAll("button")).find(button => button.textContent === "继续")!.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(document.body.textContent).toContain("Raw provider error Ω"));
    expect(document.body.textContent).not.toContain("无法配置此应用，请重试。");
  });
});

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregatorAppCatalogEntry } from "@penclipai/shared/aggregator-app-catalog";
import type { ToolConnection } from "@penclipai/shared";
import i18n from "@/i18n";
import { AggregatorConnectDialog } from "./AggregatorConnectDialog";

vi.mock("./AppLogo", () => ({ AppLogo: ({ name }: { name: string }) => <span>{name}</span> }));
vi.mock("./ComposioAppSetup", () => ({ ComposioAppSetup: () => <div>Composio setup</div> }));

const app: AggregatorAppCatalogEntry = {
  slug: "raw-app-id",
  name: "Raw App Ω",
  aliases: [],
  routes: [
    { provider: "arcade", toolkit: "RAW_TOOLKIT_ARCADE", logoUrl: "", docsUrl: "" },
    { provider: "composio", toolkit: "RAW_TOOLKIT_COMPOSIO", logoUrl: "", docsUrl: "" },
  ],
};

function connection(overrides: Partial<ToolConnection> = {}): ToolConnection {
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
    ...overrides,
  };
}

describe("AggregatorConnectDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    document.body.innerHTML = "";
    await i18n.changeLanguage("en");
    vi.clearAllMocks();
  });

  it("localizes provider setup in place while retaining raw account and app names", async () => {
    await act(async () => {
      root.render(<AggregatorConnectDialog app={app} initialProvider="arcade" connections={{ arcade: [connection()] }} onClose={vi.fn()} onNavigate={vi.fn()} />);
    });
    expect(document.body.textContent).toContain("Connect Raw App Ω through Arcade");
    expect(document.body.textContent).toContain("Your Arcade gateway is already saved. Raw App Ω authorization is managed inside Arcade.");
    expect(document.body.textContent).toContain("Arcade account");
    expect((document.querySelector("#aggregator-account") as HTMLSelectElement).value).toBe("raw-account-id");
    expect(document.body.textContent).toContain("Raw Account Ω");

    await act(async () => { await i18n.changeLanguage("zh-CN"); });
    expect(document.body.textContent).toContain("通过 Arcade 连接 Raw App Ω");
    expect(document.body.textContent).toContain("你的 Arcade 网关已保存。Raw App Ω 的授权在 Arcade 中管理。");
    expect(document.body.textContent).toContain("Arcade 账户");
    expect(document.body.textContent).toContain("连接新账户");
    expect((document.querySelector("#aggregator-account") as HTMLSelectElement).value).toBe("raw-account-id");
    expect(document.body.textContent).toContain("Raw Account Ω");
  });

  it("localizes provider-choice statuses while retaining provider identifiers", async () => {
    await act(async () => {
      root.render(<AggregatorConnectDialog app={{ ...app, routes: [
        { provider: "arcade", toolkit: "RAW_ARCADE", logoUrl: "", docsUrl: "" },
        { provider: "composio", toolkit: "RAW_COMPOSIO", logoUrl: "", docsUrl: "" },
        { provider: "executor", toolkit: "RAW_EXECUTOR", logoUrl: "", docsUrl: "" },
      ] }} connections={{
        arcade: [connection()],
        composio: [connection({ id: "draft-account", name: "Raw Draft Ω", status: "draft" })],
        executor: [connection({ id: "attention-account", name: "Raw Attention Ω", enabled: false })],
      }} onClose={vi.fn()} onNavigate={vi.fn()} />);
    });
    expect(document.body.textContent).toContain("Which service would you like to use?");
    expect(document.body.textContent).toContain("Arcade");
    expect(document.body.textContent).toContain("Composio");
    expect(document.body.textContent).toContain("Executor");
    expect(document.body.textContent).toContain("Already connected");
    expect(document.body.textContent).toContain("Setup incomplete");
    expect(document.body.textContent).toContain("Needs attention");

    await act(async () => {
      root.render(<AggregatorConnectDialog app={{ ...app, routes: [
        { provider: "arcade", toolkit: "RAW_ARCADE", logoUrl: "", docsUrl: "" },
        { provider: "composio", toolkit: "RAW_COMPOSIO", logoUrl: "", docsUrl: "" },
        { provider: "executor", toolkit: "RAW_EXECUTOR", logoUrl: "", docsUrl: "" },
      ] }} connections={{
        arcade: [],
        composio: [connection({ id: "draft-account", name: "Raw Draft Ω", status: "draft" })],
        executor: [connection({ id: "attention-account", name: "Raw Attention Ω", enabled: false })],
      }} onClose={vi.fn()} onNavigate={vi.fn()} />);
    });
    expect(document.body.textContent).toContain("Set up a connection");

    await act(async () => { await i18n.changeLanguage("zh-CN"); });
    expect(document.body.textContent).toContain("你想使用哪项服务？");
    expect(document.body.textContent).toContain("设置连接");
    expect(document.body.textContent).toContain("设置未完成");
    expect(document.body.textContent).toContain("需要处理");
    expect(document.body.textContent).toContain("Arcade");
    expect(document.body.textContent).toContain("Composio");
    expect(document.body.textContent).toContain("Executor");
  });
});

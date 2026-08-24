// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@penclipai/shared";
import { AgentConfigForm } from "./AgentConfigForm";
import { ToastProvider } from "../context/ToastContext";

const translations: Record<string, string> = {
  "agentConfig.identity": "身份信息",
  "agentConfig.name": "名称",
  "agentConfig.agentName": "智能体名称",
  "agentConfig.title": "头衔",
  "agentConfig.titlePlaceholder": "例如：工程副总裁",
  "agentConfig.reportsTo": "汇报对象",
  "agentConfig.chooseManager": "选择上级…",
  "agentConfig.capabilities": "能力",
  "agentConfig.capabilitiesPlaceholder": "描述这个智能体能做什么...",
  "agentConfig.adapter": "适配器",
  "agentConfig.testEnvironment": "检测环境",
  "agentConfig.permissionsAndConfiguration": "权限与配置",
  "agentConfig.command": "命令",
  "agentConfig.model": "模型",
  "agentConfig.thinkingEffort": "思考强度",
  "agentConfig.default": "默认",
  "agentConfig.extraArgs": "额外参数",
  "agentConfig.extraArgsPlaceholder": "用逗号分隔，例如 --verbose, --search",
  "agentConfig.environmentVariables": "环境变量",
  "agentConfig.timeoutSec": "超时时间（秒）",
  "agentConfig.graceSec": "宽限时间（秒）",
  "agentConfig.runPolicy": "运行策略",
  "agentConfig.heartbeatOnInterval": "按间隔触发心跳",
  "agentConfig.advancedRunPolicy": "高级运行策略",
  "agentConfig.wakeOnDemand": "按需唤醒",
  "agentConfig.cooldownSec": "冷却时间（秒）",
  "agentConfig.maxConcurrentRuns": "最大并发运行数",
  "agentConfig.auto": "自动",
};

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => translations[key] ?? String(options?.defaultValue ?? key),
    }),
  };
});

const mockAgentsApi = vi.hoisted(() => ({
  list: vi.fn(),
  adapterModels: vi.fn(),
  detectModel: vi.fn(),
  testEnvironment: vi.fn(),
}));

const mockSecretsApi = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
}));

const mockAssetsApi = vi.hoisted(() => ({
  uploadImage: vi.fn(),
}));

vi.mock("../api/agents", () => ({
  agentsApi: mockAgentsApi,
}));

vi.mock("../api/secrets", () => ({
  secretsApi: mockSecretsApi,
}));

vi.mock("../api/assets", () => ({
  assetsApi: mockAssetsApi,
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
  }),
}));

vi.mock("../adapters", () => ({
  getUIAdapter: () => ({
    ConfigFields: () => null,
    buildAdapterConfig: () => ({}),
  }),
}));

vi.mock("../adapters/metadata", () => ({
  listAdapterOptions: () => [{ value: "claude_local", label: "Claude Code (local)" }],
  listVisibleAdapterTypes: () => ["claude_local"],
}));

vi.mock("../adapters/adapter-display-registry", () => ({
  getAdapterLabel: () => "Claude Code (local)",
  getAdapterDisplay: () => ({
    label: "Claude Code (local)",
    description: "Local Claude agent",
    icon: () => null,
  }),
}));

vi.mock("../adapters/use-disabled-adapters", () => ({
  useDisabledAdaptersSync: () => new Set<string>(),
}));

vi.mock("../adapters/claude-local/config-fields", () => ({
  ClaudeLocalAdvancedFields: () => null,
}));

vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: ({ placeholder }: { placeholder?: string }) => <textarea placeholder={placeholder} />,
}));

vi.mock("./ReportsToPicker", () => ({
  ReportsToPicker: ({ chooseLabel }: { chooseLabel: string }) => <button type="button">{chooseLabel}</button>,
}));

vi.mock("./environment-variables-editor", () => ({
  EnvironmentVariablesEditor: () => <div>ENV</div>,
}));

vi.mock("./PathInstructionsModal", () => ({
  ChoosePathButton: () => <button type="button">path</button>,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/toggle-switch", () => ({
  ToggleSwitch: ({ checked }: { checked: boolean }) => <button type="button">{checked ? "on" : "off"}</button>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function createAgent(): Agent {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "CEO",
    role: "ceo",
    title: "VP of Engineering",
    status: "active",
    adapterType: "claude_local",
    adapterConfig: {
      command: "claude",
      model: "",
      env: {},
      timeoutSec: 60,
      graceSec: 15,
    },
    runtimeConfig: {
      heartbeat: {
        enabled: true,
        intervalSec: 300,
        wakeOnDemand: true,
        cooldownSec: 10,
        maxConcurrentRuns: 1,
      },
    },
    reportsTo: null,
    capabilities: "",
    promptTemplate: null,
    budgetMonthlyCents: 0,
    lastHeartbeatAt: null,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    hiddenAt: null,
    icon: null,
    permissions: null,
  } as unknown as Agent;
}

function renderForm(container: HTMLDivElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const root = createRoot(container);
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AgentConfigForm
            mode="edit"
            agent={createAgent()}
            onSave={vi.fn()}
            sectionLayout="cards"
          />
        </ToastProvider>
      </QueryClientProvider>,
    );
  });
  return root;
}

describe("AgentConfigForm localization", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockAgentsApi.list.mockResolvedValue([]);
    mockAgentsApi.adapterModels.mockResolvedValue([]);
    mockAgentsApi.detectModel.mockResolvedValue({ model: null, candidates: [] });
    mockSecretsApi.list.mockResolvedValue([]);
    mockAssetsApi.uploadImage.mockResolvedValue({ contentPath: "/tmp/image.png" });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders key configuration labels in Chinese instead of regressed English", async () => {
    const root = renderForm(container);
    await flush();

    expect(container.textContent).toContain("身份信息");
    expect(container.textContent).toContain("名称");
    expect(container.textContent).toContain("头衔");
    expect(container.textContent).toContain("汇报对象");
    expect(container.textContent).toContain("能力");
    expect(container.textContent).toContain("适配器");
    expect(container.textContent).toContain("检测环境");
    expect(container.textContent).toContain("权限与配置");
    expect(container.textContent).toContain("命令");
    expect(container.textContent).toContain("环境变量");
    expect(container.textContent).toContain("超时时间（秒）");
    expect(container.textContent).toContain("运行策略");
    expect(container.textContent).toContain("按间隔触发心跳");
    expect(container.textContent).toContain("高级运行策略");
    const placeholders = Array.from(container.querySelectorAll("input, textarea"))
      .map((element) => element.getAttribute("placeholder"))
      .filter(Boolean);
    expect(placeholders).toContain("智能体名称");
    expect(placeholders).toContain("例如：工程副总裁");
    expect(placeholders).toContain("描述这个智能体能做什么...");

    expect(container.textContent).not.toContain("Identity");
    expect(container.textContent).not.toContain("Reports to");
    expect(container.textContent).not.toContain("Permissions & Configuration");

    act(() => root.unmount());
  });
});

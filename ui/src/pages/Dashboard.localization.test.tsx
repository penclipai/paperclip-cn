// @vitest-environment jsdom

import { type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";

const dashboardLanguage = vi.hoisted(() => ({ value: "zh-CN" as "en" | "zh-CN" }));
const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());
const mockOpenOnboarding = vi.hoisted(() => vi.fn());
const companyState = vi.hoisted(() => ({
  selectedCompanyId: null as string | null,
  companies: [] as Array<{ id: string; name: string }>,
}));

const mockDashboardApi = vi.hoisted(() => ({ summary: vi.fn() }));
const mockActivityApi = vi.hoisted(() => ({ list: vi.fn() }));
const mockAccessApi = vi.hoisted(() => ({ listUserDirectory: vi.fn() }));
const mockIssuesApi = vi.hoisted(() => ({ list: vi.fn() }));
const mockAgentsApi = vi.hoisted(() => ({ list: vi.fn() }));
const mockProjectsApi = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  const { translateForTest } = await import("../test-utils/i18n");
  return {
    ...actual,
    initReactI18next: { type: "3rdParty", init: () => {} },
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) =>
        translateForTest(key, options, dashboardLanguage.value),
      i18n: {
        language: dashboardLanguage.value,
        resolvedLanguage: dashboardLanguage.value,
      },
    }),
  };
});

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

vi.mock("../api/dashboard", () => ({ dashboardApi: mockDashboardApi }));
vi.mock("../api/activity", () => ({ activityApi: mockActivityApi }));
vi.mock("../api/access", () => ({ accessApi: mockAccessApi }));
vi.mock("../api/issues", () => ({ issuesApi: mockIssuesApi }));
vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));
vi.mock("../api/projects", () => ({ projectsApi: mockProjectsApi }));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => companyState,
}));

vi.mock("../context/DialogContext", () => ({
  useDialogActions: () => ({
    openOnboarding: mockOpenOnboarding,
  }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({
    setBreadcrumbs: mockSetBreadcrumbs,
  }),
}));

vi.mock("../hooks/useSharedPolling", () => ({
  useSharedPollingQuery: ({
    enabled,
    refetchInterval = false,
  }: {
    enabled?: boolean;
    refetchInterval?: number | false;
  }) => ({
    enabled,
    refetchInterval,
  }),
  usePublishSharedQueryData: () => {},
}));

vi.mock("../lib/company-members", () => ({
  buildCompanyUserProfileMap: () => new Map(),
}));

vi.mock("../lib/timeAgo", () => ({
  timeAgo: () => "刚刚",
}));

vi.mock("../lib/ui-flags", () => ({
  SHOW_TASK_PRIORITY_UI: false,
}));

vi.mock("../components/MetricCard", () => ({
  MetricCard: ({
    label,
    value,
    description,
  }: {
    label: string;
    value: ReactNode;
    description?: ReactNode;
  }) => (
    <div>
      <div>{label}</div>
      <div>{value}</div>
      <div>{description}</div>
    </div>
  ),
}));

vi.mock("../components/EmptyState", () => ({
  EmptyState: ({
    message,
    action,
    onAction,
  }: {
    message: string;
    action?: string;
    onAction?: () => void;
  }) => (
    <div>
      <p>{message}</p>
      {action ? <button type="button" onClick={onAction}>{action}</button> : null}
    </div>
  ),
}));

vi.mock("../components/StatusIcon", () => ({
  StatusIcon: () => <span>status-icon</span>,
}));

vi.mock("../components/ActivityRow", () => ({
  ActivityRow: ({ event }: { event: { id: string } }) => <div>{event.id}</div>,
}));

vi.mock("../components/Identity", () => ({
  Identity: ({ name }: { name: string }) => <span>{name}</span>,
}));

vi.mock("../components/ActiveAgentsPanel", () => ({
  ActiveAgentsPanel: () => <div>active-agents-panel</div>,
}));

vi.mock("../components/ActivityCharts", () => ({
  ChartCard: ({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) => (
    <section>
      <h4>{title}</h4>
      <p>{subtitle}</p>
      {children}
    </section>
  ),
  RunActivityChart: () => <div>run-activity-chart</div>,
  PriorityChart: () => <div>priority-chart</div>,
  IssueStatusChart: () => <div>issue-status-chart</div>,
  SuccessRateChart: () => <div>success-rate-chart</div>,
}));

vi.mock("../components/PageSkeleton", () => ({
  PageSkeleton: () => <div>loading</div>,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("@/plugins/slots", () => ({
  PluginSlotOutlet: () => <div>plugin-slot-outlet</div>,
}));

vi.mock("../components/SmokeLabDashboardCard", () => ({
  SmokeLabDashboardCard: () => <div>smoke-lab-dashboard-card</div>,
}));

async function flushReact() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

describe("Dashboard localization", () => {
  let container: HTMLDivElement;

  async function renderDashboard() {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    root.render(
      <QueryClientProvider client={queryClient}>
        <Dashboard />
      </QueryClientProvider>,
    );

    await flushReact();
    return root;
  }

  beforeEach(() => {
    dashboardLanguage.value = "zh-CN";
    mockSetBreadcrumbs.mockReset();
    mockOpenOnboarding.mockReset();
    companyState.selectedCompanyId = null;
    companyState.companies = [];
    mockDashboardApi.summary.mockReset();
    mockActivityApi.list.mockReset();
    mockAccessApi.listUserDirectory.mockReset();
    mockIssuesApi.list.mockReset();
    mockAgentsApi.list.mockReset();
    mockProjectsApi.list.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows the zh-CN onboarding empty state when no company is selected", async () => {
    const root = await renderDashboard();

    expect(container.textContent).toContain("欢迎使用 Paperclip CN。先创建你的第一家公司，再配好第一个智能体吧。");
    expect(container.textContent).toContain("开始使用");

    root.unmount();
  });

  it("localizes the no-agent banner, metrics, and recent-task section in zh-CN", async () => {
    companyState.selectedCompanyId = "company-1";
    companyState.companies = [{ id: "company-1", name: "Acme" }];
    mockAgentsApi.list.mockResolvedValue([]);
    mockDashboardApi.summary.mockResolvedValue({
      agents: { active: 1, running: 2, paused: 3, error: 4 },
      tasks: { inProgress: 5, open: 6, blocked: 7 },
      costs: { monthSpendCents: 12345, monthBudgetCents: 67890, monthUtilizationPercent: 18 },
      pendingApprovals: 1,
      budgets: {
        activeIncidents: 1,
        pausedAgents: 2,
        pausedProjects: 3,
        pendingApprovals: 4,
      },
      runActivity: [],
    });
    mockActivityApi.list.mockResolvedValue([]);
    mockIssuesApi.list.mockResolvedValue([]);
    mockProjectsApi.list.mockResolvedValue([]);
    mockAccessApi.listUserDirectory.mockResolvedValue({ users: [] });

    const root = await renderDashboard();

    expect(mockSetBreadcrumbs).toHaveBeenCalledWith([{ label: "仪表盘" }]);
    expect(container.textContent).toContain("你还没有智能体。");
    expect(container.textContent).toContain("在这里创建一个");
    expect(container.textContent).toContain("1 个活跃预算事件");
    expect(container.textContent).toContain("查看预算");
    expect(container.textContent).toContain("已启用智能体");
    expect(container.textContent).toContain("进行中的任务");
    expect(container.textContent).toContain("本月支出");
    expect(container.textContent).toContain("待审批");
    expect(container.textContent).toContain("最近任务");
    expect(container.textContent).toContain("还没有任务。");

    root.unmount();
  });
});

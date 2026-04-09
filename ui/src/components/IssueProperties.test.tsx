// @vitest-environment jsdom

import { act } from "react";
import type { ComponentProps, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Issue } from "@penclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueProperties } from "./IssueProperties";

const mockAgentsApi = vi.hoisted(() => ({
  list: vi.fn(),
}));

const mockProjectsApi = vi.hoisted(() => ({
  list: vi.fn(),
}));

const mockIssuesApi = vi.hoisted(() => ({
  listLabels: vi.fn(),
}));

const mockAuthApi = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
  }),
}));

vi.mock("../api/agents", () => ({
  agentsApi: mockAgentsApi,
}));

vi.mock("../api/projects", () => ({
  projectsApi: mockProjectsApi,
}));

vi.mock("../api/issues", () => ({
  issuesApi: mockIssuesApi,
}));

vi.mock("../api/auth", () => ({
  authApi: mockAuthApi,
}));

vi.mock("react-i18next", async () => {
  const actual = await vi.importActual<typeof import("react-i18next")>("react-i18next");
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
      i18n: {} as never,
      ready: true,
    }),
  };
});

vi.mock("../hooks/useProjectOrder", () => ({
  useProjectOrder: ({ projects }: { projects: unknown[] }) => ({
    orderedProjects: projects,
  }),
}));

vi.mock("../lib/recent-assignees", () => ({
  getRecentAssigneeIds: () => [],
  sortAgentsByRecency: (agents: unknown[]) => agents,
  trackRecentAssignee: vi.fn(),
}));

vi.mock("../lib/assignees", () => ({
  formatAssigneeUserLabel: () => "Me",
}));

vi.mock("./StatusIcon", () => ({
  StatusIcon: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock("./PriorityIcon", () => ({
  PriorityIcon: ({ priority }: { priority: string }) => <span>{priority}</span>,
}));

vi.mock("./Identity", () => ({
  Identity: ({ name }: { name: string }) => <span>{name}</span>,
}));

vi.mock("./AgentIconPicker", () => ({
  AgentIcon: () => null,
}));

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string } & ComponentProps<"a">) => <a href={to} {...props}>{children}</a>,
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function createIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    companyId: "company-1",
    projectId: null,
    projectWorkspaceId: null,
    goalId: null,
    parentId: null,
    title: "Parent issue",
    description: null,
    status: "todo",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    createdByAgentId: null,
    createdByUserId: "user-1",
    issueNumber: 1,
    identifier: "PAP-1",
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    executionWorkspaceId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    labels: [],
    labelIds: [],
    blockedBy: [],
    blocks: [],
    createdAt: new Date("2026-04-06T12:00:00.000Z"),
    updatedAt: new Date("2026-04-06T12:05:00.000Z"),
    ...overrides,
  };
}

async function renderProperties(container: HTMLDivElement, props: ComponentProps<typeof IssueProperties>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <IssueProperties {...props} />
      </QueryClientProvider>,
    );
    await Promise.resolve();
  });
  return root;
}

describe("IssueProperties", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockAgentsApi.list.mockResolvedValue([]);
    mockProjectsApi.list.mockResolvedValue([]);
    mockIssuesApi.listLabels.mockResolvedValue([]);
    mockAuthApi.getSession.mockResolvedValue({ user: { id: "user-1" } });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("always exposes the add sub-issue action", async () => {
    const onAddSubIssue = vi.fn();
    const root = await renderProperties(container, {
      issue: createIssue(),
      childIssues: [],
      onAddSubIssue,
      onUpdate: vi.fn(),
    });

    const renderedText = container.textContent ?? "";
    expect(renderedText).toMatch(/Sub-issues|子任务/);
    expect(renderedText).toMatch(/Add sub-issue|添加子任务/);

    const addButton = Array.from(container.querySelectorAll("button"))
      .find((button) => /Add sub-issue|添加子任务/.test(button.textContent ?? ""));
    expect(addButton).not.toBeUndefined();

    await act(async () => {
      addButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onAddSubIssue).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });
});

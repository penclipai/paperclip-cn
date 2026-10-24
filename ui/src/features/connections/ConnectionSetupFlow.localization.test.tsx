// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { CONNECTABLE_APP_DEFINITIONS, type AppDefinition, type ConnectionMethodDef } from "@penclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const locale = vi.hoisted(() => ({ value: "zh-CN" as "en" | "zh-CN" }));
const route = vi.hoisted(() => ({ appKey: "translation-fixture", method: null as string | null }));
const gallery = vi.hoisted(() => ({ apps: [] as AppDefinition[] }));
const queryResult = vi.hoisted(() => ({
  data: { apps: gallery.apps, credentialSources: { vercelConnect: { available: true } } },
  isLoading: false,
  isError: false,
  isFetching: false,
  isFetchedAfterMount: true,
  refetch: vi.fn(),
}));
const listQueryResult = vi.hoisted(() => ({
  data: [],
  isLoading: false,
  isError: false,
  isFetching: false,
  isFetchedAfterMount: true,
  refetch: vi.fn(),
}));
const enrollmentQueryResult = vi.hoisted(() => ({
  data: null,
  isLoading: false,
  isError: false,
  isFetching: false,
  isFetchedAfterMount: true,
  refetch: vi.fn(),
}));
const mutationResult = vi.hoisted(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false, error: null }));
const queryClient = vi.hoisted(() => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }));
const translate = vi.hoisted(() => (key: string, options?: Record<string, unknown>) => {
  const zh: Record<string, string> = {
    "connectionUi.setup.capability.question": "希望 Paperclip 能做什么？",
    "connectionUi.setup.capability.aria": "{{app}} 的访问级别",
    "connectionUi.setup.method.question": "希望如何连接？",
    "connectionUi.setup.method.aria": "如何连接 {{app}}",
    "apps.connect.googleSheets.invalidLink": "这看起来不是 Google Sheets 链接。",
    Connect: "连接",
  };
  const en: Record<string, string> = {
    "apps.detail.common.change": "Change",
  };
  const template = (locale.value === "zh-CN" ? zh[key] : en[key]) ?? String(options?.defaultValue ?? key);
  return template.replace(/{{(\w+)}}/g, (_match, name: string) => String(options?.[name] ?? ""));
});

vi.mock("@/i18n", () => ({ translateInstant: translate }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate, i18n: { language: locale.value } }) }));
vi.mock("@/api/tools", () => ({ toolsApi: {} }));
vi.mock("@/api/agents", () => ({ agentsApi: {} }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1", selectedCompany: { id: "company-1", name: "Test company" } }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }) }));
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ pushToast: vi.fn() }) }));
vi.mock("@/hooks/useChatConnectorsEnabled", () => ({ useChatConnectorsEnabled: () => ({ enabled: true, githubEnabled: true }), chatProviderVisible: () => true }));
vi.mock("@/hooks/useMemoryConnectorsEnabled", () => ({ useMemoryConnectorsEnabled: () => ({ enabled: true, loaded: true }) }));
vi.mock("@/lib/router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ appKey: route.appKey }),
  useSearchParams: () => [new URLSearchParams(route.method ? { method: route.method } : {})],
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    if (queryKey[0] === "apps" && queryKey[2] === "gallery") return queryResult;
    if (queryKey[0] === "cloud-connector") return enrollmentQueryResult;
    if (queryKey[0] === "tools" && queryKey[2] === "applications") {
      return { ...listQueryResult, data: { applications: [] } };
    }
    if (queryKey[0] === "tools" && queryKey[2] === "connections") {
      return { ...listQueryResult, data: { connections: [] } };
    }
    if (queryKey[0] === "instance" && queryKey[1] === "experimental-settings") {
      return { data: undefined, isLoading: false, isError: false, isFetched: true };
    }
    if (queryKey[0] === "tools" || queryKey[0] === "agents") return listQueryResult;
    throw new Error(`Unexpected query: ${JSON.stringify(queryKey)}`);
  },
  useMutation: () => mutationResult,
  useQueryClient: () => queryClient,
}));

import { ConnectionSetupFlow } from "./ConnectionSetupFlow";

const googleSheetsDefinition = CONNECTABLE_APP_DEFINITIONS.find((app) => app.slug === "google-sheets")!;
const methodTemplate = CONNECTABLE_APP_DEFINITIONS.find((app) => app.slug === "notion")!.methods[0]!;

function fixtureMethod(key: string, capability: string, auth: "oauth" | "api_key"): ConnectionMethodDef {
  return {
    ...methodTemplate,
    key,
    auth,
    capabilityProfile: { key: capability, label: capability, description: `${capability} description` },
  };
}

const multiMethodApp: AppDefinition = {
  ...googleSheetsDefinition,
  slug: "translation-fixture",
  name: "Fixture App",
  methods: [
    fixtureMethod("write-oauth", "write", "oauth"),
    fixtureMethod("write-key", "write", "api_key"),
    fixtureMethod("read-key", "read", "api_key"),
  ],
};

const googleSheetsApp: AppDefinition = {
  ...googleSheetsDefinition,
  availability: { available: true, robotEmail: "robot@example.test" },
};

async function flushReact() {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

describe("ConnectionSetupFlow localization", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let previousActEnvironment: boolean | undefined;

  async function render() {
    await act(async () => {
      root.render(<ConnectionSetupFlow host="dialog" />);
      await flushReact();
    });
  }

  async function clickButtonWithText(text: string) {
    const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === text);
    expect(button).toBeInstanceOf(HTMLButtonElement);
    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushReact();
    });
  }

  beforeEach(() => {
    const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    locale.value = "zh-CN";
    route.appKey = "translation-fixture";
    route.method = null;
    gallery.apps.splice(0, gallery.apps.length, multiMethodApp);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    if (previousActEnvironment === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT;
    else environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    vi.clearAllMocks();
  });

  it("localizes real capability and connection-method controls after an in-place language change", async () => {
    await render();
    await clickButtonWithText("apps.detail.common.change");
    expect(container.textContent).toContain("希望 Paperclip 能做什么？");
    expect(container.textContent).toContain("希望如何连接？");
    expect(container.querySelector('[aria-label="Fixture App 的访问级别"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="如何连接 Fixture App"]')).not.toBeNull();

    locale.value = "en";
    await render();
    expect(container.textContent).toContain("What should Paperclip be able to do?");
    expect(container.textContent).toContain("How do you want to connect?");
    expect(container.querySelector('[aria-label="Access level for Fixture App"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="How to connect Fixture App"]')).not.toBeNull();
  });

  it("re-renders the visible Google Sheets validation error after changing language", async () => {
    route.appKey = "google-sheets";
    route.method = "local";
    gallery.apps.splice(0, gallery.apps.length, googleSheetsApp);
    await render();
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "not-a-sheet");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const connect = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "连接");
    expect(connect).toBeInstanceOf(HTMLButtonElement);
    await act(async () => {
      connect!.click();
      await flushReact();
    });
    expect(container.textContent).toContain("这看起来不是 Google Sheets 链接。");

    locale.value = "en";
    await render();
    expect(container.textContent).toContain("That doesn't look like a Google Sheets link.");
  });
});

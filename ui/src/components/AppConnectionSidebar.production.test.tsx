// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { AppDetailSidebar } from "./AppConnectionSidebar.production";

const api = vi.hoisted(() => ({
  listApplications: vi.fn(),
  listConnections: vi.fn(),
  listGallery: vi.fn(),
  listAppsAttention: vi.fn(),
}));

vi.mock("@/api/tools", () => ({ toolsApi: api }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company" }) }));
vi.mock("@/context/SidebarContext", () => ({ useSidebar: () => ({ isMobile: false, setSidebarOpen: vi.fn() }) }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a> }));
vi.mock("@/pages/apps/AppLogo", () => ({ AppLogo: ({ name }: { name: string }) => <span data-app-name={name} /> }));
vi.mock("./SidebarNavItem.production", () => ({ SidebarNavItem: ({ to, label }: { to: string; label: string }) => <a data-nav-label={label} href={to}>{label}</a> }));

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function waitForRendered(check: () => void) {
  await vi.waitFor(async () => {
    await flushReact();
    check();
  });
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.listApplications.mockResolvedValue({ applications: [{ id: "app-id", name: "Owner App Ω" }] });
  api.listConnections.mockResolvedValue({ connections: [] });
  api.listGallery.mockResolvedValue({ apps: [] });
  api.listAppsAttention.mockResolvedValue({ apps: [] });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    await i18n.changeLanguage("en");
  });
  container.remove();
  client.clear();
  vi.clearAllMocks();
});

it("updates tab labels after a locale switch while preserving application data and routes", async () => {
  await act(async () => {
    root.render(<QueryClientProvider client={client}><AppDetailSidebar kind="application" applicationId="app-id" /></QueryClientProvider>);
  });
  await waitForRendered(() => expect(container.querySelector('[data-app-name="Owner App Ω"]')).not.toBeNull());
  expect(container.querySelector('[data-nav-label="Permissions"]')).not.toBeNull();
  expect(container.querySelector('[data-nav-label="Review"]')).not.toBeNull();
  expect(container.querySelector('[href="/apps/app/app-id/permissions"]')).not.toBeNull();
  expect(container.querySelector('[href="/apps/app/app-id/review"]')).not.toBeNull();

  await act(async () => { await i18n.changeLanguage("zh-CN"); });

  expect(container.querySelector('[data-app-name="Owner App Ω"]')).not.toBeNull();
  expect(container.querySelector('[data-nav-label="权限"]')).not.toBeNull();
  expect(container.querySelector('[data-nav-label="审阅"]')).not.toBeNull();
  expect(container.querySelector('[href="/apps/app/app-id/permissions"]')).not.toBeNull();
  expect(container.querySelector('[href="/apps/app/app-id/review"]')).not.toBeNull();
});

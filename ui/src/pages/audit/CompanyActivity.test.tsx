// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CompanyActivity } from "./CompanyActivity.production";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const setSearchParamsMock = vi.hoisted(() => vi.fn());
let currentSearch = "entityType=case&entityId=CAS-C1&action=case.";

vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1" }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }) }));
vi.mock("@/hooks/useStreamlinedUiEnabled", () => ({ useStreamlinedUiEnabled: () => ({ enabled: false }) }));
vi.mock("@/lib/router", () => ({
  useSearchParams: () => [new URLSearchParams(currentSearch), setSearchParamsMock],
}));
vi.mock("./AuditHub", () => ({ AuditHub: () => <div>Audit hub</div> }));
vi.mock("./AuditFeed.production", () => ({
  AuditFeed: (props: {
    companyId: string;
    lockedEntity?: { type: string; id: string };
    actionDomain: string;
    onActionDomainChange?: (value: string) => void;
    onEntityTypeChange?: (value: string) => void;
    onEntityIdChange?: (value: string) => void;
    onClearFilters?: () => void;
  }) => (
    <div data-company={props.companyId} data-entity={JSON.stringify(props.lockedEntity)} data-action={props.actionDomain}>
      <button onClick={() => props.onActionDomainChange?.("case.")}>Select case action</button>
      <button onClick={() => props.onEntityTypeChange?.("case")}>Select case entity</button>
      <button onClick={() => props.onEntityIdChange?.("CAS-C2")}>Set case ID</button>
      <button onClick={() => props.onClearFilters?.()}>Clear filters</button>
    </div>
  ),
}));

it("preserves case audit links when the streamlined shell is off", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    currentSearch = "entityType=case&entityId=CAS-C1&action=case.";
    await act(async () => root.render(<CompanyActivity />));
    expect(container.firstElementChild?.getAttribute("data-company")).toBe("company-1");
    expect(container.firstElementChild?.getAttribute("data-entity")).toBe(JSON.stringify({ type: "case", id: "CAS-C1" }));
    expect(container.firstElementChild?.getAttribute("data-action")).toBe("case.");
  } finally {
    await act(async () => root.unmount());
  }
});

it("writes action and case filters to the URL and clears them atomically", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    currentSearch = "";
    setSearchParamsMock.mockClear();
    await act(async () => root.render(<CompanyActivity />));
    const click = async (label: string) => {
      const button = Array.from(container.querySelectorAll("button")).find(item => item.textContent === label)!;
      await act(async () => button.click());
    };
    await click("Select case action");
    const actionParams = setSearchParamsMock.mock.calls[0][0](new URLSearchParams(currentSearch)) as URLSearchParams;
    expect(actionParams.get("action")).toBe("case.");
    await click("Select case entity");
    const entityParams = setSearchParamsMock.mock.calls[1][0](new URLSearchParams(currentSearch)) as URLSearchParams;
    expect(entityParams.get("entityType")).toBe("case");
    expect(entityParams.has("entityId")).toBe(false);
    await click("Set case ID");
    const idParams = setSearchParamsMock.mock.calls[2][0](new URLSearchParams(currentSearch)) as URLSearchParams;
    expect(idParams.get("entityId")).toBe("CAS-C2");
    await click("Clear filters");
    const cleared = setSearchParamsMock.mock.calls[3][0](new URLSearchParams("entityType=case&entityId=CAS-C1&action=case.")) as URLSearchParams;
    expect(cleared.has("action")).toBe(false);
    expect(cleared.has("entityType")).toBe(false);
    expect(cleared.has("entityId")).toBe(false);
    expect(setSearchParamsMock.mock.calls).toEqual(expect.arrayContaining([
      expect.arrayContaining([expect.any(Function), { replace: true }]),
    ]));
  } finally {
    await act(async () => root.unmount());
  }
});

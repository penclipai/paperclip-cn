// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BudgetPolicySummary } from "@penclipai/shared";
import { BudgetPolicyCard } from "./BudgetPolicyCard";

const language = vi.hoisted(() => ({ value: "zh-CN" as "en" | "zh-CN" }));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  const { translateForTest } = await import("../test-utils/i18n");
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => translateForTest(key, options, language.value),
      i18n: { language: language.value, resolvedLanguage: language.value },
    }),
  };
});

vi.mock("@/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../i18n")>();
  const { translateForTest } = await import("../test-utils/i18n");
  return {
    ...actual,
    translateInstant: (key: string, options?: Record<string, unknown>) => translateForTest(key, options, language.value),
  };
});

function summary(overrides: Partial<BudgetPolicySummary> = {}): BudgetPolicySummary {
  return {
    policyId: "policy-1", companyId: "company-1", scopeType: "project", scopeId: "project-1", scopeName: "项目一",
    metric: "cost", windowKind: "lifetime", amount: 0, observedAmount: 0, unpricedEventCount: 0, pendingRunCount: 0,
    remainingAmount: 0, utilizationPercent: 0, warnPercent: 80, hardStopEnabled: true, unpricedUsagePolicy: "block",
    notifyEnabled: true, isActive: true, status: "hard_stop", paused: true, pauseReason: "budget_hard_stop",
    windowStart: new Date("2026-01-01"), windowEnd: new Date("2026-02-01"), ...overrides,
  } as BudgetPolicySummary;
}

describe("BudgetPolicyCard localization", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    language.value = "zh-CN";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders budget status, progress, and blocked-project copy in Chinese", () => {
    act(() => {
      root.render(<BudgetPolicyCard summary={summary()} variant="plain" isSaving onSave={() => {}} />);
    });

    expect(container.textContent).toContain("累计预算");
    expect(container.textContent).toContain("未设置上限");
    expect(container.textContent).toContain("已禁用");
    expect(container.textContent).toContain("不限额");
    expect(container.textContent).toContain("已暂停");
    expect(container.textContent).toContain("在预算阻塞问题解决前，此项目的执行已暂停。");
    expect(container.textContent).toContain("保存中...");
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-label")).toBe("预算使用率：已使用 0%");
  });

  it("updates existing budget labels when the active language changes", () => {
    act(() => {
      root.render(<BudgetPolicyCard summary={summary({ amount: 10_000, observedAmount: 7_500, remainingAmount: 2_500, utilizationPercent: 75, paused: false, status: "warning" })} variant="plain" onSave={() => {}} />);
    });
    expect(container.textContent).toContain("已达到上限的 75%");
    expect(container.textContent).toContain("预警");

    language.value = "en";
    act(() => {
      root.render(<BudgetPolicyCard summary={summary({ amount: 10_000, observedAmount: 7_500, remainingAmount: 2_500, utilizationPercent: 75, paused: false, status: "warning" })} variant="plain" onSave={() => {}} />);
    });
    expect(container.textContent).toContain("75% of limit");
    expect(container.textContent).toContain("Warning");
  });
});

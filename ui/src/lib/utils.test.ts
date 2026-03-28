import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentLocaleMock } = vi.hoisted(() => ({
  getCurrentLocaleMock: vi.fn(() => "en"),
}));

vi.mock("../i18n", () => ({
  getCurrentLocale: getCurrentLocaleMock,
  translateInstant: vi.fn((key: string) => key),
}));

import { formatBudgetInputValue, formatCents, parseBudgetInputValue } from "./utils";

describe("currency formatting helpers", () => {
  beforeEach(() => {
    getCurrentLocaleMock.mockReset();
    getCurrentLocaleMock.mockReturnValue("en");
  });

  it("keeps budget input values in USD for zh-CN locales", () => {
    getCurrentLocaleMock.mockReturnValue("zh-CN");

    expect(formatBudgetInputValue(12_345)).toBe("123.45");
    expect(parseBudgetInputValue("123.45")).toBe(12_345);
  });

  it("formats USD amounts without applying a locale-specific FX conversion", () => {
    getCurrentLocaleMock.mockReturnValue("zh-CN");

    expect(formatCents(12_345).replace(/[^\d.]/g, "")).toBe("123.45");
    expect(formatCents(12_345)).toContain("$");
    expect(formatCents(12_345)).not.toContain("US$");
  });
});

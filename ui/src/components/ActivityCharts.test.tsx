// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../i18n", () => ({
  translateInstant: (
    key: string,
    options?: { defaultValue?: string },
  ) => {
    const translations: Record<string, string> = {
      "No issues": "No issues",
      "status.todo": "Todo",
      "status.inProgress": "In Progress",
    };
    return translations[key] ?? options?.defaultValue ?? key;
  },
}));

import { IssueStatusChart } from "./ActivityCharts";

describe("IssueStatusChart", () => {
  it("uses translated status labels instead of hardcoded Chinese strings", () => {
    const html = renderToStaticMarkup(
      <IssueStatusChart
        issues={[
          { status: "todo", createdAt: new Date("2026-03-28T12:00:00Z") },
          {
            status: "in_progress",
            createdAt: new Date("2026-03-28T12:00:00Z"),
          },
        ]}
      />,
    );

    expect(html).toContain("Todo");
    expect(html).toContain("In Progress");
    expect(html).not.toContain("待办");
    expect(html).not.toContain("进行中");
  });
});

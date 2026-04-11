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
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 1);

    const html = renderToStaticMarkup(
      <IssueStatusChart
        issues={[
          { status: "todo", createdAt: recentDate },
          {
            status: "in_progress",
            createdAt: recentDate,
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

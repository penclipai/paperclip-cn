// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgentStatusBadge, IssueStatusBadge, StatusBadge } from "./StatusBadge";
import { StatusGlyph } from "./StatusGlyph";
import { agentStatusVar, statusBadge, taskStatusVar } from "../lib/status-colors";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

/**
 * Issue/task status chips carry the unified glyph and are recolored from the
 * `--status-task-*` base hue via the `.status-chip` color-mix helper.
 */
describe("IssueStatusBadge", () => {
  it("wires each issue status to its --status-task-* base hue, with a glyph", () => {
    for (const [status, cssVar] of Object.entries(taskStatusVar)) {
      const html = renderToStaticMarkup(<IssueStatusBadge status={status} />);
      expect(html).toContain("status-chip");
      expect(html).toContain("border");
      expect(html).toContain(`var(${cssVar})`);
      expect(html).toContain('viewBox="0 0 24 24"');
    }
  });

  it("points in_progress at the blue liveness var and todo at the amber var", () => {
    expect(renderToStaticMarkup(<IssueStatusBadge status="in_progress" />)).toContain("var(--status-task-in_progress)");
    expect(renderToStaticMarkup(<IssueStatusBadge status="todo" />)).toContain("var(--status-task-todo)");
  });

  it("renders translated labels and regular weight", () => {
    const html = renderToStaticMarkup(<IssueStatusBadge status="in_review" />);
    expect(html).toContain("In Review");
    expect(html).toContain("font-normal");
    expect(html).not.toContain("font-medium");
  });

  it("strikes through cancelled chips", () => {
    expect(renderToStaticMarkup(<IssueStatusBadge status="cancelled" />)).toContain("line-through");
  });

  it("falls back to the backlog var for unknown statuses", () => {
    expect(renderToStaticMarkup(<IssueStatusBadge status="mystery" />)).toContain("var(--status-task-backlog)");
  });
});

/** Agent chips recolor from the `--status-agent-*` base hues. */
describe("AgentStatusBadge", () => {
  it("wires each agent status to its --status-agent-* base hue via status-chip", () => {
    for (const [status, cssVar] of Object.entries(agentStatusVar)) {
      const html = renderToStaticMarkup(<AgentStatusBadge status={status} />);
      expect(html).toContain("status-chip");
      expect(html).toContain(`var(${cssVar})`);
    }
  });

  it('renders "active" as the idle label', () => {
    expect(renderToStaticMarkup(<AgentStatusBadge status="active" />)).toContain("Idle");
  });

  it("renders agent status enums through shared status labels", () => {
    expect(renderToStaticMarkup(<AgentStatusBadge status="pending_approval" />)).toContain("Pending Approval");
  });
});

describe("StatusBadge", () => {
  it("uses the generic status badge palette and translated status labels", () => {
    expect(renderToStaticMarkup(<StatusBadge status="todo" />)).toContain(statusBadge.todo.split(" ")[0]);
    expect(renderToStaticMarkup(<StatusBadge status="todo" />)).toContain("Todo");
    expect(renderToStaticMarkup(<StatusBadge status="in_progress" />)).toContain(statusBadge.in_progress.split(" ")[0]);
    expect(renderToStaticMarkup(<StatusBadge status="in_progress" />)).toContain("In Progress");
  });
});

describe("StatusGlyph", () => {
  it("maps in_progress to the animated task-progress glyph", () => {
    const html = renderToStaticMarkup(<StatusGlyph status="in_progress" />);
    expect(html).toContain("lucide-task-progress-spinner");
    expect(html).toContain('stroke-dasharray="80 20"');
    expect(html).toContain("motion-safe:animate-spin");
  });

  it("maps in_review to the Lucide circle-dot glyph", () => {
    const html = renderToStaticMarkup(<StatusGlyph status="in_review" />);
    expect(html).toContain("lucide-circle-dot");
    expect(html).toContain('r="1"');
  });

  it("maps done to the Lucide circle-check glyph", () => {
    const html = renderToStaticMarkup(<StatusGlyph status="done" />);
    expect(html).toContain("lucide-circle-check");
    expect(html).toContain('d="m16 9-5.5 5.5L8 12"');
  });

  it("maps blocked to the Lucide circle-minus glyph", () => {
    const html = renderToStaticMarkup(<StatusGlyph status="blocked" />);
    expect(html).toContain("lucide-circle-minus");
    expect(html).toContain('d="M8 12h8"');
  });

  it("maps backlog to the Lucide circle-dashed glyph", () => {
    const html = renderToStaticMarkup(<StatusGlyph status="backlog" />);
    expect(html).toContain("lucide-circle-dashed");
    expect(html).toContain('d="M10.1 2.182a10 10 0 0 1 3.8 0"');
  });

  it("maps cancelled to the Lucide ban glyph", () => {
    const html = renderToStaticMarkup(<StatusGlyph status="cancelled" />);
    expect(html).toContain("lucide-ban");
    expect(html).toContain('d="M4.929 4.929 19.07 19.071"');
  });
});

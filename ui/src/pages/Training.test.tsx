import { renderToStaticMarkup } from "react-dom/server";
import type { DecisionTrainingExample } from "@penclipai/shared";
import { describe, expect, it, vi } from "vitest";
import { TrainingThreadPanel, partitionTrainingThread } from "./Training";

const { mockT } = vi.hoisted(() => ({
  mockT: vi.fn((key: string, options?: Record<string, unknown>) => {
    const template =
      typeof options?.defaultValue === "string" ? options.defaultValue : key;
    return template.replace(/\{\{(\w+)\}\}/g, (_match, token) =>
      String(options?.[token] ?? ""),
    );
  }),
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  const { translateForTest } = await import("../test-utils/i18n");
  mockT.mockImplementation((key: string, options?: Record<string, unknown>) =>
    translateForTest(key, options),
  );
  return {
    ...actual,
    useTranslation: () => ({ t: mockT }),
  };
});

const example: DecisionTrainingExample = {
  id: "training-1",
  companyId: "company-1",
  sourceKind: "interaction",
  sourceId: "interaction-1",
  issueId: "issue-1",
  cutoffAt: "2026-07-16T13:02:00.000Z",
  notes: "Use the smaller change.",
  notesHistory: [],
  decisionOutcome: "approved",
  retentionPolicy: "scrub_deleted_comments_v1",
  snapshot: {
    version: 1,
    capturedAt: "2026-07-16T13:10:00.000Z",
    cutoff: {
      at: "2026-07-16T13:02:00.000Z",
      lastCommentId: "before-2",
      commentCount: 2,
    },
    issue: {},
    comments: [
      {
        id: "before-1",
        body: "included",
        createdAt: "2026-07-16T12:00:00.000Z",
      },
      {
        id: "before-2",
        body: "last visible",
        createdAt: "2026-07-16T13:00:00.000Z",
      },
    ],
    runs: [],
    decision: {
      kind: "interaction",
      payload: {},
      actor: null,
      outcome: "approved",
    },
    code: { repoUrl: null, ref: null, commitSha: null, resolution: "none" },
  },
  createdByUserId: "local-board",
  createdAt: "2026-07-16T13:10:00.000Z",
  updatedAt: "2026-07-16T13:10:00.000Z",
};

const postCutoffComment = {
  id: "after-1",
  companyId: "company-1",
  issueId: "issue-1",
  body: "excluded tail",
  authorType: "agent" as const,
  authorAgentId: "agent-1",
  authorUserId: null,
  presentation: null,
  metadata: null,
  createdAt: new Date("2026-07-16T13:30:00.000Z"),
  updatedAt: new Date("2026-07-16T13:30:00.000Z"),
};

describe("training cutoff rendering", () => {
  it("keeps post-cutoff comments out of snapshot data and renders them ghosted for audit", () => {
    const result = partitionTrainingThread(
      example.snapshot.comments,
      [...example.snapshot.comments, postCutoffComment],
      example.cutoffAt,
    );
    expect(result.included).toEqual(example.snapshot.comments);
    expect(result.excluded).toEqual([postCutoffComment]);
    expect(result.included).not.toContainEqual(postCutoffComment);

    const markup = renderToStaticMarkup(
      <TrainingThreadPanel
        example={example}
        liveComments={[postCutoffComment]}
      />,
    );

    expect(markup).toContain("CUTOFF");
    expect(markup).toContain("excluded tail");
    expect(markup).toContain("Excluded from snapshot");
    expect(markup).toContain('data-excluded-from-snapshot="true"');
    expect(markup).toContain("opacity-50");
    expect(markup).toContain("included");
    expect(markup).toContain("after-1");
    expect(mockT).toHaveBeenCalledWith(
      "training.thread.cutoff",
      expect.objectContaining({ defaultValue: "CUTOFF · {{date}}" }),
    );
    expect(mockT).toHaveBeenCalledWith("training.thread.excludedAfterCutoff", {
      defaultValue: "Excluded from snapshot · after cutoff",
    });
    expect(mockT).toHaveBeenCalledWith("training.thread.authors.agent", {
      defaultValue: "Agent",
    });
  });
});

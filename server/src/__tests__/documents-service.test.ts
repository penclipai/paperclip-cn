import { describe, expect, it, vi } from "vitest";
import { documentService } from "../services/documents.js";

describe("documentService.restoreIssueDocumentRevision", () => {
  it("maps revision number races to a 409 conflict", async () => {
    const existing = {
      id: "document-1",
      companyId: "company-1",
      issueId: "issue-1",
      key: "plan",
      title: "Plan",
      format: "markdown",
      latestBody: "current body",
      latestRevisionId: "revision-2",
      latestRevisionNumber: 2,
      createdByAgentId: null,
      createdByUserId: "user-1",
      updatedByAgentId: null,
      updatedByUserId: "user-1",
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    };
    const revision = {
      id: "revision-1",
      companyId: "company-1",
      documentId: "document-1",
      revisionNumber: 1,
      title: "Plan",
      format: "markdown",
      body: "older body",
    };

    const tx = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([revision]),
          }),
        }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue({ code: "23505" }),
        }),
      }),
      update: vi.fn(),
    };
    const db = {
      transaction: vi.fn(async (callback: (innerTx: typeof tx) => Promise<unknown>) => callback(tx)),
    };

    const svc = documentService(db as never);

    await expect(
      svc.restoreIssueDocumentRevision({
        issueId: "issue-1",
        key: "plan",
        revisionId: "revision-1",
        createdByUserId: "user-2",
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "Document was updated by someone else",
      details: {
        currentRevisionId: "revision-2",
      },
    });

    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(tx.update).not.toHaveBeenCalled();
  });
});

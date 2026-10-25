import { createHash } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { chatActions, chatGitHubReviews, type Db } from "@penclipai/db";

export async function hasPublishedGitHubReview(db: Db, binding: {
  companyId: string;
  issueId: string;
  runId: string;
}): Promise<boolean> {
  const reviews = await db.select({ id: chatGitHubReviews.id, endpointId: chatGitHubReviews.endpointId })
    .from(chatGitHubReviews)
    .where(and(
      eq(chatGitHubReviews.companyId, binding.companyId),
      eq(chatGitHubReviews.issueId, binding.issueId),
      eq(chatGitHubReviews.runId, binding.runId),
      eq(chatGitHubReviews.state, "completed"),
    ));
  if (!reviews.length) return false;
  const [publication] = await db.select({ id: chatActions.id }).from(chatActions).where(and(
    eq(chatActions.companyId, binding.companyId),
    or(...reviews.map(review => and(
      eq(chatActions.endpointId, review.endpointId),
      eq(chatActions.providerActionId, `github_publication:${binding.issueId}:assessment:${createHash("sha256").update(JSON.stringify(review.id)).digest("hex")}`),
    ))),
    eq(chatActions.kind, "github_review_publication"),
    eq(chatActions.status, "processed"),
  )).limit(1);
  return !!publication;
}

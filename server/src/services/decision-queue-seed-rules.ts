import { and, eq, type SQLWrapper } from "drizzle-orm";
import { issueWorkProducts } from "@penclipai/db";

export function pullRequestSeedProductCondition(companyId: string | SQLWrapper) {
  return and(eq(issueWorkProducts.companyId, companyId), eq(issueWorkProducts.type, "pull_request"));
}

import { and, inArray, isNull } from "drizzle-orm";
import { executionWorkspaces } from "@penclipai/db";

export function taskWorkspaceSelectableCondition() {
  return and(
    inArray(executionWorkspaces.status, ["active", "idle"]),
    isNull(executionWorkspaces.closedAt),
  )!;
}

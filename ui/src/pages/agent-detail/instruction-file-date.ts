import type { AgentInstructionsFileSummary } from "@penclipai/shared";
import { translateInstant } from "@/i18n";
import { formatDate } from "@/lib/utils";

/** Missing historical metadata must never become an invented creation date. */
export function instructionFileDateLabel(file?: Pick<AgentInstructionsFileSummary, "createdAt" | "updatedAt"> | null) {
  if (file?.updatedAt && Number.isFinite(Date.parse(file.updatedAt))) {
    return translateInstant("agentDetail.instructions.lastUpdated", {
      date: formatDate(file.updatedAt),
      defaultValue: "Last updated {{date}}",
    });
  }
  if (file?.createdAt && Number.isFinite(Date.parse(file.createdAt))) {
    return translateInstant("agentDetail.instructions.dateCreated", {
      date: formatDate(file.createdAt),
      defaultValue: "Date created {{date}}",
    });
  }
  return translateInstant("agentDetail.instructions.dateUnavailable", { defaultValue: "Date unavailable" });
}

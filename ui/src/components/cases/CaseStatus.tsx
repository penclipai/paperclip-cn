import type { CaseStatus as CaseStatusValue } from "@/api/cases";
import { StatusBadge } from "@/components/StatusBadge";
import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";

export const CASE_STATUS_LABELS: Record<CaseStatusValue, string> = {
  get draft() { return translateInstant("cases.status.draft", { defaultValue: "Draft" }); },
  get in_progress() { return translateInstant("status.in_progress", { defaultValue: "In progress" }); },
  get in_review() { return translateInstant("status.in_review", { defaultValue: "In review" }); },
  get approved() { return translateInstant("Approved"); },
  get done() { return translateInstant("status.done", { defaultValue: "Done" }); },
  get cancelled() { return translateInstant("status.cancelled", { defaultValue: "Cancelled" }); },
};

export function CaseStatus({ status, className }: { status: CaseStatusValue; className?: string }) {
  useTranslation();
  return <StatusBadge status={status} label={CASE_STATUS_LABELS[status]} className={className} />;
}

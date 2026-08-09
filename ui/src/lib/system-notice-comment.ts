import type {
  IssueCommentMetadata,
  IssueCommentMetadataRow,
  IssueCommentPresentation,
} from "@penclipai/shared";
import type { TFunction } from "i18next";
import type {
  SystemNoticeMetadataRow,
  SystemNoticeMetadataSection,
  SystemNoticeProps,
  SystemNoticeTone,
} from "../components/SystemNotice";
import { translateStatusLabel } from "./i18n-labels";

const TONE_LABEL: Record<SystemNoticeTone, string> = {
  neutral: "System notice",
  info: "System notice",
  success: "System notice",
  warning: "System warning",
  danger: "System alert",
};

const SYSTEM_NOTICE_TITLE_KEYS: Record<string, string> = {
  "Missing issue disposition": "systemNotice.successfulRunHandoff.missingDispositionTitle",
  "Missing disposition recovery blocked": "systemNotice.successfulRunHandoff.recoveryBlockedTitle",
};

const SYSTEM_NOTICE_BODY_KEYS: Record<string, string> = {
  "Paperclip needs a disposition before this issue can continue.": "systemNotice.successfulRunHandoff.missingDispositionBody",
  "Paperclip could not resolve this issue's missing disposition automatically. The issue is blocked on a recovery owner.": "systemNotice.successfulRunHandoff.recoveryBlockedBody",
};

const SYSTEM_NOTICE_LABEL_KEYS: Record<string, string> = {
  "Assignee": "systemNotice.successfulRunHandoff.assignee",
  "Cause": "systemNotice.metadata.cause",
  "Cause code": "systemNotice.metadata.causeCode",
  "Completed run": "systemNotice.metadata.completedRun",
  "Corrective handoff run": "systemNotice.successfulRunHandoff.correctiveHandoffRun",
  "Automatic retry": "systemNotice.successfulRunHandoff.automaticRetry",
  "Detected progress": "systemNotice.successfulRunHandoff.detectedProgress",
  "Latest handoff run status": "systemNotice.successfulRunHandoff.latestHandoffRunStatus",
  "Latest issue status": "systemNotice.successfulRunHandoff.latestIssueStatus",
  "Missing disposition": "systemNotice.successfulRunHandoff.missingDisposition",
  "Normalized cause": "systemNotice.successfulRunHandoff.normalizedCause",
  "Reason": "systemNotice.metadata.reason",
  "Recovery issue": "systemNotice.successfulRunHandoff.recoveryIssue",
  "Recovery owner": "systemNotice.successfulRunHandoff.recoveryOwner",
  "Required action": "systemNotice.successfulRunHandoff.requiredAction",
  "Run context": "systemNotice.metadata.runContext",
  "Run evidence": "systemNotice.successfulRunHandoff.runEvidence",
  "Run status": "systemNotice.successfulRunHandoff.runStatus",
  "Source assignee": "systemNotice.successfulRunHandoff.sourceAssignee",
  "Source issue": "systemNotice.successfulRunHandoff.sourceIssue",
  "Source run": "systemNotice.successfulRunHandoff.sourceRun",
  "Status": "Status",
  "Status before": "systemNotice.metadata.statusBefore",
  "Successful run": "systemNotice.successfulRunHandoff.successfulRun",
  "Suggested action": "systemNotice.successfulRunHandoff.suggestedAction",
  "Valid dispositions": "systemNotice.successfulRunHandoff.validDispositions",
};

const SYSTEM_NOTICE_VALUE_KEYS: Record<string, string> = {
  clear_next_step: "systemNotice.successfulRunHandoff.value.clearNextStep",
  corrective_handoff_queued: "systemNotice.successfulRunHandoff.value.correctiveHandoffQueued",
  "choose and record a valid issue disposition without copying transcript content": "systemNotice.successfulRunHandoff.value.chooseValidDisposition",
  successful_run_missing_state: "systemNotice.successfulRunHandoff.value.successfulRunMissingState",
  useful_output_no_action_evidence: "systemNotice.successfulRunHandoff.value.usefulOutputNoActionEvidence",
  "done, cancelled, in_review with assignee, blocked with blockers, delegated follow-up, or explicit continuation":
    "systemNotice.successfulRunHandoff.value.validDispositions",
  "done, cancelled, in_review with an owner, blocked with blockers, delegated follow-up, or explicit continuation":
    "systemNotice.successfulRunHandoff.value.validDispositions",
  "one corrective handoff wake queued": "systemNotice.successfulRunHandoff.value.correctiveHandoffQueued",
  "Run produced useful output but no concrete action evidence":
    "systemNotice.successfulRunHandoff.value.usefulOutputNoActionEvidence",
  unknown: "unknown",
};

function translateKnownText(t: TFunction | undefined, text: string, keys: Record<string, string>) {
  const key = keys[text];
  return key && t ? t(key, { defaultValue: text }) : text;
}

function translateMetadataValue(t: TFunction | undefined, value: string) {
  if (!t) return value;
  const key = SYSTEM_NOTICE_VALUE_KEYS[value];
  if (key) return t(key, { defaultValue: value });
  if (/^[a-z]+(?:_[a-z]+)*$/.test(value)) return translateStatusLabel(t, value);
  return value;
}

export function translateSystemNoticeBodyText(text: string, t?: TFunction) {
  return translateKnownText(t, text, SYSTEM_NOTICE_BODY_KEYS);
}

function metadataRowText(row: { label?: string | null }, fallback: string, t?: TFunction) {
  const label = row.label?.trim();
  return translateKnownText(t, label && label.length > 0 ? label : fallback, SYSTEM_NOTICE_LABEL_KEYS);
}

function mapMetadataRow(
  row: IssueCommentMetadataRow,
  ctx: { runAgentId?: string | null; t?: TFunction },
): SystemNoticeMetadataRow | null {
  switch (row.type) {
    case "text":
      return {
        kind: "text",
        label: metadataRowText(row, "Detail", ctx.t),
        value: translateMetadataValue(ctx.t, row.text),
      };
    case "code":
      return { kind: "code", label: metadataRowText(row, "Code", ctx.t), value: row.code };
    case "key_value":
      return {
        kind: "text",
        label: translateKnownText(ctx.t, row.label, SYSTEM_NOTICE_LABEL_KEYS),
        value: translateMetadataValue(ctx.t, row.value),
      };
    case "issue_link": {
      const identifier = row.identifier ?? null;
      if (!identifier) {
        return {
          kind: "text",
          label: metadataRowText(row, "Issue", ctx.t),
          value: row.title ?? translateMetadataValue(ctx.t, "unknown"),
        };
      }
      return {
        kind: "issue",
        label: metadataRowText(row, "Issue", ctx.t),
        identifier,
        href: `/issues/${identifier}`,
        title: row.title ?? undefined,
      };
    }
    case "agent_link": {
      const name = row.name?.trim() || row.agentId.slice(0, 8);
      return {
        kind: "agent",
        label: metadataRowText(row, "Agent", ctx.t),
        name,
        href: `/agents/${row.agentId}`,
      };
    }
    case "run_link": {
      const runAgentId = row.agentId ?? ctx.runAgentId ?? null;
      const href = runAgentId ? `/agents/${runAgentId}/runs/${row.runId}` : undefined;
      return {
        kind: "run",
        label: metadataRowText(row, "Run", ctx.t),
        runId: row.runId,
        href,
        status: row.title ? translateMetadataValue(ctx.t, row.title) : undefined,
      };
    }
    default:
      return null;
  }
}

export function mapCommentMetadataToSystemNoticeSections(
  metadata: IssueCommentMetadata | null | undefined,
  ctx: { runAgentId?: string | null; t?: TFunction } = {},
): SystemNoticeMetadataSection[] {
  if (!metadata || !Array.isArray(metadata.sections)) return [];
  return metadata.sections
    .map((section) => {
      const rows = section.rows
        .map((row) => mapMetadataRow(row, ctx))
        .filter((r): r is SystemNoticeMetadataRow => r !== null);
      if (rows.length === 0) return null;
      const out: SystemNoticeMetadataSection = { rows };
      if (section.title) out.title = translateKnownText(ctx.t, section.title, SYSTEM_NOTICE_LABEL_KEYS);
      return out;
    })
    .filter((s): s is SystemNoticeMetadataSection => s !== null);
}

export function systemNoticeLabelForTone(
  tone: SystemNoticeTone,
  presentationTitle?: string | null,
  t?: TFunction,
): string {
  const trimmed = presentationTitle?.trim();
  if (trimmed && trimmed.length > 0) return translateKnownText(t, trimmed, SYSTEM_NOTICE_TITLE_KEYS);
  return t
    ? t(
      tone === "danger"
        ? "systemNotice.alert"
        : tone === "warning"
          ? "systemNotice.warning"
          : "systemNotice.notice",
      { defaultValue: TONE_LABEL[tone] },
    )
    : TONE_LABEL[tone];
}

export function buildSystemNoticeProps(input: {
  presentation: IssueCommentPresentation | null;
  metadata: IssueCommentMetadata | null;
  body: import("react").ReactNode;
  timestamp?: string;
  source?: SystemNoticeProps["source"];
  runAgentId?: string | null;
  t?: TFunction;
}): SystemNoticeProps {
  const tone: SystemNoticeTone = input.presentation?.tone ?? "neutral";
  const label = systemNoticeLabelForTone(tone, input.presentation?.title, input.t);
  const detailsDefaultOpen = Boolean(input.presentation?.detailsDefaultOpen);
  const sections = mapCommentMetadataToSystemNoticeSections(input.metadata, {
    runAgentId: input.runAgentId ?? null,
    t: input.t,
  });
  return {
    tone,
    label,
    body: typeof input.body === "string"
      ? translateSystemNoticeBodyText(input.body, input.t)
      : input.body,
    metadata: sections.length > 0 ? sections : undefined,
    detailsDefaultOpen,
    timestamp: input.timestamp,
    source: input.source,
  };
}

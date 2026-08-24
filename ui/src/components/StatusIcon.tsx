import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { IssueBlockerAttention } from "@penclipai/shared";
import { cn } from "../lib/utils";
import { translateStatusLabel } from "../lib/i18n-labels";
import { StatusGlyph, type StatusGlyphSize } from "./StatusGlyph";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

const allStatuses = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled", "blocked"];

interface StatusIconProps {
  status: string;
  blockerAttention?: IssueBlockerAttention | null;
  onChange?: (status: string) => void;
  className?: string;
  showLabel?: boolean;
  /** Glyph size (PAP-243a). Default `md` (16px); lists/detail/mentions use `lg` (20px). */
  size?: StatusGlyphSize;
}

function blockedAttentionLabel(t: TFunction, blockerAttention: IssueBlockerAttention | null | undefined) {
  if (!blockerAttention || blockerAttention.state === "none") return translateStatusLabel(t, "blocked");

  if (blockerAttention.reason === "active_child") {
    const count = blockerAttention.coveredBlockerCount;
    if (count === 1 && blockerAttention.sampleBlockerIdentifier) {
      return t("statusIcon.blocked.waitingOnActiveSubIssueNamed", {
        identifier: blockerAttention.sampleBlockerIdentifier,
        defaultValue: "Blocked · waiting on active sub-task {{identifier}}",
      });
    }
    if (count === 1) {
      return t("statusIcon.blocked.waitingOnOneActiveSubIssue", {
        defaultValue: "Blocked · waiting on 1 active sub-task",
      });
    }
    return t("statusIcon.blocked.waitingOnActiveSubIssues", {
      count,
      defaultValue: "Blocked · waiting on {{count}} active sub-tasks",
    });
  }

  if (blockerAttention.reason === "active_dependency") {
    const count = blockerAttention.coveredBlockerCount;
    if (count === 1 && blockerAttention.sampleBlockerIdentifier) {
      return t("statusIcon.blocked.coveredByActiveDependencyNamed", {
        identifier: blockerAttention.sampleBlockerIdentifier,
        defaultValue: "Blocked · covered by active dependency {{identifier}}",
      });
    }
    if (count === 1) {
      return t("statusIcon.blocked.coveredByOneActiveDependency", {
        defaultValue: "Blocked · covered by 1 active dependency",
      });
    }
    return t("statusIcon.blocked.coveredByActiveDependencies", {
      count,
      defaultValue: "Blocked · covered by {{count}} active dependencies",
    });
  }

  if (blockerAttention.reason === "stalled_review") {
    const count = blockerAttention.stalledBlockerCount;
    const leaf = blockerAttention.sampleStalledBlockerIdentifier ?? blockerAttention.sampleBlockerIdentifier;
    if (count === 1 && leaf) {
      return t("statusIcon.blocked.reviewStalledOn", {
        identifier: leaf,
        defaultValue: "Blocked · review stalled on {{identifier}}",
      });
    }
    if (count === 1) {
      return t("statusIcon.blocked.oneReviewStalled", {
        defaultValue: "Blocked · review stalled with no clear next step",
      });
    }
    return t("statusIcon.blocked.reviewsStalled", {
      count,
      defaultValue: "Blocked · {{count}} reviews stalled with no clear next step",
    });
  }

  if (blockerAttention.reason === "attention_required") {
    const count = blockerAttention.attentionBlockerCount || blockerAttention.unresolvedBlockerCount;
    const attention = count === 1
      ? t("statusIcon.blocked.oneBlockerNeedsAttention", { defaultValue: "1 blocker needs attention" })
      : t("statusIcon.blocked.blockersNeedAttention", {
        count,
        defaultValue: "{{count}} blockers need attention",
      });
    const coveredCount = blockerAttention.coveredBlockerCount;
    if (coveredCount > 0) {
      return t("statusIcon.blocked.attentionAndCovered", {
        attention,
        coveredCount,
        defaultValue: "Blocked · {{attention}}; {{coveredCount}} covered by active work",
      });
    }
    return t("statusIcon.blocked.attention", {
      attention,
      defaultValue: "Blocked · {{attention}}",
    });
  }

  return translateStatusLabel(t, "blocked");
}

/**
 * Task/issue status indicator — renders the unified, color-blind-safe
 * {@link StatusGlyph} (one distinct shape per status). With `onChange` it also
 * acts as a status picker (popover). This one component drives every standalone
 * status surface: list, kanban, detail header, properties row + picker flyout,
 * sub-task / blocked-by pills, blocked inbox, quicklook, sibling nav, filters,
 * search, columns, dashboard.
 *
 * A "covered" blocked task (waiting on active work) maps to the `in_queue`
 * glyph — the blocked shape recoloured blue — while the full blocked reason
 * still rides on the accessible label.
 */
export function StatusIcon({ status, blockerAttention, onChange, className, showLabel, size = "md" }: StatusIconProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const isCoveredBlocked = status === "blocked" && blockerAttention?.state === "covered";
  const label = translateStatusLabel(t, status);
  const ariaLabel = status === "blocked" ? blockedAttentionLabel(t, blockerAttention) : label;
  const glyphStatus = isCoveredBlocked ? "in_queue" : status;

  const glyph = (
    <StatusGlyph
      status={glyphStatus}
      size={size}
      className={cn(onChange && !showLabel && "cursor-pointer", className)}
      title={ariaLabel}
    />
  );

  if (!onChange) {
    return showLabel ? (
      <span className="inline-flex items-center gap-1.5">
        {glyph}
        <span className="text-sm">{label}</span>
      </span>
    ) : (
      glyph
    );
  }

  const trigger = showLabel ? (
    <button
      type="button"
      aria-label={`Change status (current: ${ariaLabel})`}
      className="inline-flex min-h-5 items-center gap-1.5 cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1 py-0.5 transition-colors"
    >
      {glyph}
      <span className="text-sm">{label}</span>
    </button>
  ) : (
    <button
      type="button"
      data-slot="icon-button"
      aria-label={`Change status (current: ${ariaLabel})`}
      className="inline-flex cursor-pointer items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-(length:--rad-3) focus-visible:ring-ring"
    >
      {glyph}
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="start">
        {allStatuses.map((s) => (
          <Button
            key={s}
            variant="ghost"
            size="sm"
            className={cn("w-full justify-start gap-2 text-xs", s === status && "bg-accent")}
            onClick={() => {
              onChange(s);
              setOpen(false);
            }}
          >
            <StatusIcon status={s} size="lg" />
            {translateStatusLabel(t, s)}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

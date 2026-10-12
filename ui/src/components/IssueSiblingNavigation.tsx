import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Issue } from "@penclipai/shared";
import type { IssueSiblingNavigation as IssueSiblingNavigationState } from "@/lib/issue-detail-subissues";
import { createIssueDetailPath, withIssueDetailHeaderSeed } from "@/lib/issueDetailBreadcrumb";
import { cn } from "@/lib/utils";
import { Link } from "@/lib/router";
import { StatusIcon } from "./StatusIcon";

type IssueSiblingNavigationProps = {
  navigation: IssueSiblingNavigationState | null;
  linkState?: unknown;
};

export function IssueSiblingNavigation({ navigation, linkState }: IssueSiblingNavigationProps) {
  const { t } = useTranslation(undefined, { useSuspense: false });

  if (!navigation) return null;

  return (
    <nav
      aria-label={t("issueSiblingNavigation.ariaLabel", { defaultValue: "Sub-issue navigation" })}
      className="mt-4 flex flex-col gap-3 sm:mt-6 sm:grid sm:grid-cols-2"
    >
      {navigation.previous ? (
        <SiblingLink direction="previous" issue={navigation.previous} linkState={linkState} />
      ) : null}
      {navigation.next ? (
        <SiblingLink
          direction="next"
          issue={navigation.next}
          linkState={linkState}
          className={!navigation.previous ? "sm:col-start-2" : undefined}
        />
      ) : null}
    </nav>
  );
}

function SiblingLink({
  direction,
  issue,
  linkState,
  className,
}: {
  direction: "previous" | "next";
  issue: Issue;
  linkState?: unknown;
  className?: string;
}) {
  const { t } = useTranslation(undefined, { useSuspense: false });
  const issuePathId = issue.identifier ?? issue.id;
  const label = direction === "previous"
    ? t("issueSiblingNavigation.previous", { defaultValue: "Previous" })
    : t("issueSiblingNavigation.next", { defaultValue: "Next" });
  const identifier = issue.identifier ?? issue.id.slice(0, 8);
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
  const ariaLabel = direction === "previous"
    ? t("issueSiblingNavigation.previousAria", {
      defaultValue: "Previous sub-issue: {{identifier}} - {{title}}",
      identifier,
      title: issue.title,
    })
    : t("issueSiblingNavigation.nextAria", {
      defaultValue: "Next sub-issue: {{identifier}} - {{title}}",
      identifier,
      title: issue.title,
    });

  return (
    <Link
      // design-allow(card-pattern): navigation <Link> card; Card renders a div and would break anchor semantics (C5a Run 3)
      to={createIssueDetailPath(issuePathId)}
      state={withIssueDetailHeaderSeed(linkState, issue)}
      issuePrefetch={issue}
      issueQuicklookSide="top"
      issueQuicklookAlign={direction === "previous" ? "start" : "end"}
      aria-label={ariaLabel}
      className={cn(
        "group min-w-0 rounded-lg border border-border bg-card px-3 py-2.5 text-left no-underline transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-(length:--rad-3) focus-visible:ring-ring",
        direction === "next" && "sm:text-right",
        className,
      )}
    >
      <div className="min-w-0 space-y-1.5">
        <div className={cn(
          "flex items-center gap-1.5 text-xs text-muted-foreground transition-colors group-hover:text-foreground",
          direction === "next" && "sm:justify-end",
        )}>
          {direction === "previous" ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
          <span>{label}</span>
          {direction === "next" ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
        </div>
        <div className={cn(
          "flex min-w-0 items-center gap-1.5 text-xs font-mono text-muted-foreground transition-colors group-hover:text-foreground",
          direction === "next" && "sm:justify-end",
        )}>
          <StatusIcon status={issue.status} externalConversationState={issue.externalConversationState} blockerAttention={issue.blockerAttention} />
          <span className="shrink-0">{identifier}</span>
        </div>
        <div className="truncate text-sm text-foreground">
          {issue.title}
        </div>
      </div>
    </Link>
  );
}

import { useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Link } from "@/lib/router";
import { Bot, User, Cog, ChevronDown, ListFilter } from "lucide-react";
import type { CaseEvent, CaseEventKind } from "@/api/cases";
import { Button } from "@/components/ui/button";
import { StatusIcon } from "@/components/StatusIcon";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, relativeTime } from "@/lib/utils";

const EVENT_COPY: Record<CaseEventKind, { key: string; defaultValue: string }> = {
  created: { key: "caseComponents.activity.events.created", defaultValue: "created" },
  updated: { key: "caseComponents.activity.events.updated", defaultValue: "updated" },
  fields_changed: { key: "caseComponents.activity.events.fieldsChanged", defaultValue: "fields changed" },
  status_changed: { key: "caseComponents.activity.events.statusChanged", defaultValue: "status changed" },
  issue_linked: { key: "caseComponents.activity.events.issueLinked", defaultValue: "issue linked" },
  issue_unlinked: { key: "caseComponents.activity.events.issueUnlinked", defaultValue: "issue unlinked" },
  document_revised: { key: "caseComponents.activity.events.documentRevised", defaultValue: "document revised" },
  child_linked: { key: "caseComponents.activity.events.childLinked", defaultValue: "child linked" },
  attachment_added: { key: "caseComponents.activity.events.attachmentAdded", defaultValue: "attachment added" },
  label_added: { key: "caseComponents.activity.events.labelAdded", defaultValue: "label added" },
  label_removed: { key: "caseComponents.activity.events.labelRemoved", defaultValue: "label removed" },
  handoff_requested: { key: "caseComponents.activity.events.handoffRequested", defaultValue: "handoff requested" },
  handoff_applied: { key: "caseComponents.activity.events.handoffApplied", defaultValue: "task handed off" },
  handoff_delivered: { key: "caseComponents.activity.events.handoffDelivered", defaultValue: "agent wake queued" },
  handoff_completed: { key: "caseComponents.activity.events.handoffCompleted", defaultValue: "case completed" },
  handoff_cancelled: { key: "caseComponents.activity.events.handoffCancelled", defaultValue: "handoff cancelled" },
};

function eventLabel(kind: CaseEventKind, t: TFunction): string {
  const copy = EVENT_COPY[kind];
  return copy ? t(copy.key, { defaultValue: copy.defaultValue }) : kind;
}

/** Human label for the actor, preferring the resolved agent name. */
function actorLabel(event: CaseEvent, t: TFunction): string {
  if (event.actorType === "agent") {
    return event.actorAgentName ?? t("caseComponents.activity.actors.agent", { defaultValue: "Agent" });
  }
  if (event.actorType === "user") {
    return t("caseComponents.activity.actors.user", { defaultValue: "User" });
  }
  return t("caseComponents.activity.actors.system", { defaultValue: "System" });
}

function ActorIcon({ event }: { event: CaseEvent }) {
  const Icon = event.actorType === "agent" ? Bot : event.actorType === "user" ? User : Cog;
  return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />;
}

function issueRelationLabel(event: CaseEvent, t: TFunction): string {
  return event.kind === "issue_linked" || event.kind === "issue_unlinked"
    ? t("caseComponents.activity.relations.issue", { defaultValue: "issue" })
    : t("caseComponents.activity.relations.via", { defaultValue: "via" });
}

/** One event with actor + run→issue attribution (P4 §1). */
export function CaseEventRow({ event, compact = false }: { event: CaseEvent; compact?: boolean }) {
  const { t } = useTranslation();
  const detail =
    event.kind === "status_changed" && event.payload
      ? `${(event.payload.previousStatus as string) ?? "?"} → ${(event.payload.status as string) ?? "?"}`
      : "";
  return (
    <div className={cn("flex items-start gap-2 text-xs", compact ? "py-1.5" : "py-2")}>
      <span className="mt-1"><ActorIcon event={event} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="font-medium">{eventLabel(event.kind, t)}</span>
          {detail && <span className="text-muted-foreground">· {detail}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
          <span>{actorLabel(event, t)}</span>
          {event.issue && (
            <>
              <span aria-hidden>·</span>
              <span>{issueRelationLabel(event, t)}</span>
              <Link
                to={`/issues/${event.issue.identifier}`}
                className="inline-flex min-w-0 items-center gap-1 text-foreground/80 hover:underline"
                title={event.issue.title}
              >
                <StatusIcon status={event.issue.status} size="sm" />
                <span className="shrink-0 font-mono">{event.issue.identifier}</span>
                <span className="min-w-0 truncate">{event.issue.title}</span>
              </Link>
            </>
          )}
          <span aria-hidden>·</span>
          <span>{relativeTime(event.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

/** The full activity feed with kind filters (detail-page Activity tab). */
export function CaseActivityFeed({ events }: { events: CaseEvent[] }) {
  const { t } = useTranslation();
  const [active, setActive] = useState<Set<CaseEventKind>>(new Set());

  // Only offer filters for kinds actually present, in first-seen order.
  const presentKinds = useMemo(() => {
    const seen: CaseEventKind[] = [];
    for (const e of events) if (!seen.includes(e.kind)) seen.push(e.kind);
    return seen;
  }, [events]);

  const filtered = useMemo(
    () => (active.size === 0 ? events : events.filter((e) => active.has(e.kind))),
    [events, active],
  );

  function toggle(kind: CaseEventKind) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  const filterLabel = active.size === 0
    ? t("caseComponents.activity.allActivity", { defaultValue: "All activity" })
    : active.size === 1
      ? eventLabel([...active][0]!, t)
      : t("caseComponents.activity.filterCount", {
          count: active.size,
          defaultValue: "{{count}} filters",
        });

  if (events.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("caseComponents.activity.noActivity", { defaultValue: "No activity yet." })}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {t("caseComponents.activity.eventsSummary", {
            defaultValue: "{{filtered}} of {{total}} events",
            filtered: filtered.length,
            total: events.length,
          })}
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5">
              <ListFilter className="h-3.5 w-3.5" />
              {filterLabel}
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              {t("caseComponents.activity.filterLabel", { defaultValue: "Activity filter" })}
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setActive(new Set())}>
              {t("caseComponents.activity.allActivity", { defaultValue: "All activity" })}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {presentKinds.map((kind) => (
              <DropdownMenuCheckboxItem
                key={kind}
                checked={active.has(kind)}
                onCheckedChange={() => toggle(kind)}
              >
                {eventLabel(kind, t)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("caseComponents.activity.noMatchingEvents", {
            defaultValue: "No events match this filter.",
          })}
        </p>
      ) : (
        <div className="divide-y divide-border">
          {filtered.map((event) => (
            <CaseEventRow key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

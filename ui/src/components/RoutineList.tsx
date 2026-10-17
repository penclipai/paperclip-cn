import type { AgentAppearance } from "@penclipai/shared";
import { AgentAvatar } from "@/components/AgentAvatar";
import type { ReactNode } from "react";
import { MoreHorizontal, Play } from "lucide-react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";

export type RoutineListProjectSummary = {
  name: string;
  color?: string | null;
};

export type RoutineListAgentSummary = {
  id?: string;
  appearance?: AgentAppearance | null;
  name: string;
  icon?: string | null;
};

export type RoutineListRowItem = {
  id: string;
  title: string;
  status: string;
  projectId: string | null;
  assigneeAgentId: string | null;
  lastRun?: {
    triggeredAt?: Date | string | null;
    status?: string | null;
  } | null;
};

export function formatLastRunTimestamp(value: Date | string | null | undefined) {
  if (!value) return translateInstant("Never");
  return new Date(value).toLocaleString();
}

export function formatRoutineRunStatus(value: string | null | undefined) {
  if (!value) return null;
  const key = value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  return translateInstant(`status.${key}`, { defaultValue: value.replaceAll("_", " ") });
}

export function nextRoutineStatus(currentStatus: string, enabled: boolean) {
  if (currentStatus === "archived" && enabled) return "active";
  return enabled ? "active" : "paused";
}

export function RoutineListRow<TRoutine extends RoutineListRowItem>({
  routine,
  projectById,
  agentById,
  runningRoutineId,
  statusMutationRoutineId,
  href,
  configureLabel,
  managedByLabel,
  secondaryDetails,
  runNowButton = false,
  disableRunNow = false,
  disableToggle = false,
  hideArchiveAction = false,
  divider = true,
  selected = false,
  selectMode = false,
  extraMenuItems,
  onSelectChange,
  onRunNow,
  onToggleEnabled,
  onToggleArchived,
}: {
  routine: TRoutine;
  projectById: Map<string, RoutineListProjectSummary>;
  agentById: Map<string, RoutineListAgentSummary>;
  runningRoutineId: string | null;
  statusMutationRoutineId: string | null;
  href: string;
  configureLabel?: string;
  managedByLabel?: string | null;
  secondaryDetails?: ReactNode;
  runNowButton?: boolean;
  disableRunNow?: boolean;
  disableToggle?: boolean;
  hideArchiveAction?: boolean;
  /** Render a bottom divider between consecutive rows. Off when the group is its own card. */
  divider?: boolean;
  selected?: boolean;
  selectMode?: boolean;
  extraMenuItems?: ReactNode;
  onSelectChange?: (routine: TRoutine, selected: boolean) => void;
  onRunNow: (routine: TRoutine) => void;
  onToggleEnabled: (routine: TRoutine, enabled: boolean) => void;
  onToggleArchived?: (routine: TRoutine) => void;
}) {
  const { t } = useTranslation();
  const configureText = configureLabel ?? t("common.edit");
  const enabled = routine.status === "active";
  const isArchived = routine.status === "archived";
  const isStatusPending = statusMutationRoutineId === routine.id;
  const project = routine.projectId ? projectById.get(routine.projectId) ?? null : null;
  const agent = routine.assigneeAgentId ? agentById.get(routine.assigneeAgentId) ?? null : null;
  const isDraft = !isArchived && !routine.assigneeAgentId;
  const runDisabled = runningRoutineId === routine.id || isArchived || disableRunNow;

  return (
    <Link
      to={href}
      className={`group flex flex-col gap-3 px-3 py-3 transition-colors hover:bg-accent/50 sm:flex-row sm:items-center no-underline text-inherit${
        divider ? " border-b border-border last:border-b-0" : ""
      }`}
    >
      {selectMode ? (
        <div
          className="flex items-start pt-0.5 sm:pt-1"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border"
            checked={selected}
            aria-label={t("routines.selectRoutine", { name: routine.title })}
            onChange={(event) => onSelectChange?.(routine, event.target.checked)}
          />
        </div>
      ) : null}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{routine.title}</span>
          {(isArchived || routine.status === "paused" || isDraft) ? (
            <span className="text-xs text-muted-foreground">
              {isArchived ? translateInstant("status.archived") : isDraft ? translateInstant("status.draft") : translateInstant("status.paused")}
            </span>
          ) : null}
          {managedByLabel ? (
            <span className="text-xs text-muted-foreground">{managedByLabel}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: project?.color ?? "var(--project-none)" }}
            />
            <span>{routine.projectId ? (project?.name ?? translateInstant("routines.unknownProject")) : translateInstant("routines.noProject")}</span>
          </span>
          <span className="flex items-center gap-2">
            {routine.assigneeAgentId ? <AgentAvatar agent={{ ...agent, id: routine.assigneeAgentId }} size={16} className="h-3.5 w-3.5 shrink-0"/> : null}
            <span>{routine.assigneeAgentId ? (agent?.name ?? t("routines.unknownAssignee")) : t("No default agent")}</span>
          </span>
          <span>
            {formatLastRunTimestamp(routine.lastRun?.triggeredAt)}
            {routine.lastRun ? ` · ${formatRoutineRunStatus(routine.lastRun.status)}` : ""}
          </span>
        </div>
        {secondaryDetails ? (
          <div className="text-xs text-muted-foreground">{secondaryDetails}</div>
        ) : null}
      </div>

      <div className="flex items-center gap-3" onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}>
        {runNowButton ? (
          <Button
            variant="outline"
            size="sm"
            disabled={runDisabled}
            onClick={() => onRunNow(routine)}
          >
            <Play className="h-3.5 w-3.5" />
            {runningRoutineId === routine.id ? translateInstant("Running...") : translateInstant("Run now")}
          </Button>
        ) : null}

        <div className="flex items-center gap-3">
          <ToggleSwitch
            size="lg"
            checked={enabled}
            onCheckedChange={() => onToggleEnabled(routine, enabled)}
            disabled={isStatusPending || isArchived || disableToggle}
            aria-label={enabled ? translateInstant("Disable {{name}}", { name: routine.title }) : translateInstant("Enable {{name}}", { name: routine.title })}
          />
          <span className="w-12 text-xs text-muted-foreground">
            {isArchived ? translateInstant("status.archived") : isDraft ? translateInstant("status.draft") : enabled ? translateInstant("On") : translateInstant("Off")}
          </span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={translateInstant("More actions for {{name}}", { name: routine.title })}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to={href}>{configureText}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={runDisabled}
              onClick={() => onRunNow(routine)}
            >
              {runningRoutineId === routine.id ? translateInstant("Running...") : translateInstant("Run now")}
            </DropdownMenuItem>
            {extraMenuItems ? (
              <>
                <DropdownMenuSeparator />
                {extraMenuItems}
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onToggleEnabled(routine, enabled)}
              disabled={isStatusPending || isArchived || disableToggle}
            >
              {enabled ? translateInstant("Pause") : translateInstant("Enable")}
            </DropdownMenuItem>
            {!hideArchiveAction && onToggleArchived ? (
              <DropdownMenuItem
                onClick={() => onToggleArchived(routine)}
                disabled={isStatusPending}
              >
                {routine.status === "archived" ? t("attentionQueue.restore") : t("common.archive")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Link>
  );
}

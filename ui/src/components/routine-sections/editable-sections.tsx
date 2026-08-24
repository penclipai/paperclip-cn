import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Braces,
  Clock3,
  Edit3,
  KeyRound,
  Play,
  Plus,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioCardGroup } from "@/components/ui/radio-card";
import { cn } from "@/lib/utils";
import { nextCronFires, previewFirePolicies } from "../../lib/cron-fires";
import { timeAgo } from "../../lib/timeAgo";
import { EmptyState } from "../EmptyState";
import { InlineEntitySelector } from "../InlineEntitySelector";
import {
  DocumentAnnotationsCountChip,
  IssueDocumentAnnotations,
} from "../IssueDocumentAnnotations";
import { AgentIcon } from "../AgentIconPicker";
import { MarkdownEditor } from "../MarkdownEditor";
import { ScheduleEditor, getScheduleCronValidation } from "../ScheduleEditor";
import {
  RoutineVariablesEditor,
  RoutineVariablesHint,
} from "../RoutineVariablesEditor";
import { RoutineTriggerCard } from "../RoutineTriggerCard";
import { EnvironmentVariablesEditor } from "../environment-variables-editor";
import { createDefaultNewTrigger, useRoutineDetail } from "./context";
import type {
  EnvBinding,
  RoutineDetail as RoutineDetailType,
} from "@penclipai/shared";

const concurrencyPolicyOptions = [
  {
    value: "coalesce_if_active",
    title: "Coalesce if active",
    description:
      "Keep one follow-up run queued while an active run is still working.",
  },
  {
    value: "always_enqueue",
    title: "Always enqueue",
    description:
      "Queue every trigger occurrence, even if several runs stack up.",
  },
  {
    value: "skip_if_active",
    title: "Skip if active",
    description:
      "Drop overlapping trigger occurrences while the routine is already active.",
  },
];

const catchUpPolicyOptions = [
  {
    value: "skip_missed",
    title: "Skip missed",
    description: "Ignore schedule windows that were missed while paused.",
  },
  {
    value: "enqueue_missed_with_cap",
    title: "Enqueue missed with cap",
    description:
      "Catch up missed schedule windows after recovery; sub-hourly schedules are combined into one catch-up run, slower schedules replay each missed window up to a cap.",
  },
];

const activityGatePolicyOptions = [
  {
    value: "always",
    title: "Run on every scheduled tick",
    description: "Fire on the schedule no matter what — the default behavior.",
  },
  {
    value: "require_external_activity",
    title: "Skip when there's been no activity since the last run",
    description:
      "On a scheduled tick, only run if something happened since the last run that finished. Lets a watcher-style routine stay asleep while the system is settled instead of burning tokens.",
  },
];

const activityGateScopeOptions = [
  {
    value: "company",
    title: "Company-wide",
    description: "Any activity across the company counts as a reason to run.",
  },
  {
    value: "project",
    title: "This project",
    description:
      "Only activity in the routine's project counts as a reason to run.",
  },
];

const triggerKinds = ["schedule", "webhook"];
const signingModes = ["bearer", "hmac_sha256", "github_hmac", "none"];
const signingModeDescriptions: Record<string, string> = {
  bearer: "Expect a shared bearer token in the Authorization header.",
  hmac_sha256:
    "Expect an HMAC SHA-256 signature over the request using the shared secret.",
  github_hmac:
    "Accept GitHub-style X-Hub-Signature-256 header (HMAC over raw body, no timestamp).",
  none: "No authentication — the webhook URL itself acts as a shared secret.",
};
const SIGNING_MODES_WITHOUT_REPLAY_WINDOW = new Set(["github_hmac", "none"]);

function signingModeDescription(
  signingMode: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  switch (signingMode) {
    case "bearer":
      return t("routineDetail.signingMode.bearer", {
        defaultValue: signingModeDescriptions.bearer,
      });
    case "hmac_sha256":
      return t("routineDetail.signingMode.hmacSha256", {
        defaultValue: signingModeDescriptions.hmac_sha256,
      });
    case "github_hmac":
      return t("routineDetail.signingMode.githubHmac", {
        defaultValue: signingModeDescriptions.github_hmac,
      });
    case "none":
      return t("routineDetail.signingMode.none", {
        defaultValue: signingModeDescriptions.none,
      });
    default:
      return signingMode;
  }
}

export function OverviewSection({
  defaultDescriptionAnnotationsOpen = false,
}: {
  defaultDescriptionAnnotationsOpen?: boolean;
} = {}) {
  const { t } = useTranslation();
  const ctx = useRoutineDetail();
  const {
    routine,
    editDraft,
    setEditDraft,
    assigneeOptions,
    projectOptions,
    recentAssigneeIds,
    recentProjectIds,
    agentById,
    projectById,
    currentAssignee,
    currentProject,
    mentionOptions,
    assigneeSelectorRef,
    projectSelectorRef,
    descriptionEditorRef,
    routineRuns,
    activity,
    saveRoutine,
    saveConflict,
    isSectionDirty,
    navigateToSection,
  } = ctx;
  const [descriptionAnnotationsOpen, setDescriptionAnnotationsOpen] = useState(
    defaultDescriptionAnnotationsOpen,
  );

  const activeTriggers = routine.triggers.length;
  const nextFire = useMemo(() => {
    const upcoming = routine.triggers
      .filter((trigger) => trigger.kind === "schedule" && trigger.nextRunAt)
      .map((trigger) => new Date(trigger.nextRunAt as Date))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    return upcoming ? upcoming.toLocaleString() : null;
  }, [routine.triggers]);
  const boundSecrets = editDraft.env ? Object.keys(editDraft.env).length : 0;
  const lastRun = (routineRuns ?? [])[0] ?? null;
  const recentActivity = (activity ?? []).slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Assignment row */}
      <div className="overflow-x-auto overscroll-x-contain">
        <div className="inline-flex min-w-full flex-wrap items-center gap-2 text-sm text-muted-foreground sm:min-w-max sm:flex-nowrap">
          <span>
            {t("routineDetail.assignmentFor", { defaultValue: "For" })}
          </span>
          <InlineEntitySelector
            ref={assigneeSelectorRef}
            value={editDraft.assigneeAgentId}
            options={assigneeOptions}
            recentOptionIds={recentAssigneeIds}
            placeholder={t("issueChat.assigneePlaceholder", {
              defaultValue: "Responsible",
            })}
            noneLabel={t("issueChat.noAssignee", {
              defaultValue: "No responsible",
            })}
            searchPlaceholder={t("issueChat.searchAssignees", {
              defaultValue: "Search responsible...",
            })}
            emptyMessage={t("issueChat.noAssigneesFound", {
              defaultValue: "No responsible found.",
            })}
            onChange={(assigneeAgentId) =>
              setEditDraft((current) => ({ ...current, assigneeAgentId }))
            }
            onConfirm={() => {
              if (editDraft.projectId) {
                descriptionEditorRef.current?.focus();
              } else {
                projectSelectorRef.current?.focus();
              }
            }}
            renderTriggerValue={(option) =>
              option ? (
                currentAssignee ? (
                  <>
                    <AgentIcon
                      icon={currentAssignee.icon}
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    />
                    <span className="truncate">{option.label}</span>
                  </>
                ) : (
                  <span className="truncate">{option.label}</span>
                )
              ) : (
                <span className="text-muted-foreground">
                  {t("issueChat.assigneePlaceholder", {
                    defaultValue: "Responsible",
                  })}
                </span>
              )
            }
            renderOption={(option) => {
              if (!option.id)
                return <span className="truncate">{option.label}</span>;
              const assignee = agentById.get(option.id);
              return (
                <>
                  {assignee ? (
                    <AgentIcon
                      icon={assignee.icon}
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    />
                  ) : null}
                  <span className="truncate">{option.label}</span>
                </>
              );
            }}
          />
          <span>{t("in", { defaultValue: "in" })}</span>
          <InlineEntitySelector
            ref={projectSelectorRef}
            value={editDraft.projectId}
            options={projectOptions}
            recentOptionIds={recentProjectIds}
            placeholder={t("Project", { defaultValue: "Project" })}
            noneLabel={t("No project", { defaultValue: "No project" })}
            searchPlaceholder={t("Search projects...", {
              defaultValue: "Search projects...",
            })}
            emptyMessage={t("No projects found.", {
              defaultValue: "No projects found.",
            })}
            onChange={(projectId) =>
              setEditDraft((current) => ({ ...current, projectId }))
            }
            onConfirm={() => descriptionEditorRef.current?.focus()}
            renderTriggerValue={(option) =>
              option && currentProject ? (
                <>
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-sm"
                    style={{
                      backgroundColor:
                        currentProject.color ?? "var(--project-none)",
                    }}
                  />
                  <span className="truncate">{option.label}</span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  {t("Project", { defaultValue: "Project" })}
                </span>
              )
            }
            renderOption={(option) => {
              if (!option.id)
                return <span className="truncate">{option.label}</span>;
              const project = projectById.get(option.id);
              return (
                <>
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-sm"
                    style={{
                      backgroundColor: project?.color ?? "var(--project-none)",
                    }}
                  />
                  <span className="truncate">{option.label}</span>
                </>
              );
            }}
          />
        </div>
      </div>

      {!routine.assigneeAgentId ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-900 dark:text-amber-200">
          {t("routineDetail.defaultAgentRequiredNotice", {
            defaultValue:
              "Default agent required. This routine can stay as a draft and still run manually, but automation stays paused until you assign a default agent.",
          })}
        </div>
      ) : null}

      {/* Instructions */}
      <div className="space-y-2">
        <div className="flex items-center justify-end">
          {routine.descriptionDocument ? (
            <DocumentAnnotationsCountChip
              issueId={routine.id}
              docKey="description"
              target={{
                kind: "routine",
                routineId: routine.id,
                documentKey: "description",
              }}
              panelOpen={descriptionAnnotationsOpen}
              onToggle={() => setDescriptionAnnotationsOpen((open) => !open)}
            />
          ) : null}
        </div>
        {routine.descriptionDocument ? (
          <IssueDocumentAnnotations
            issueId={routine.id}
            doc={routine.descriptionDocument}
            target={{
              kind: "routine",
              routineId: routine.id,
              documentKey: "description",
            }}
            bodyMarkdown={editDraft.description}
            draftDirty={isSectionDirty("overview") || saveRoutine.isPending}
            draftConflicted={saveConflict}
            historicalPreview={false}
            locationHash={
              typeof window === "undefined" ? "" : window.location.hash
            }
            panelOpen={descriptionAnnotationsOpen}
            onPanelOpenChange={setDescriptionAnnotationsOpen}
          >
            <MarkdownEditor
              ref={descriptionEditorRef}
              value={editDraft.description}
              onChange={(description) =>
                setEditDraft((current) => ({ ...current, description }))
              }
              placeholder={t("routineDetail.addInstructions", {
                defaultValue: "Add instructions...",
              })}
              bordered={false}
              contentClassName="min-h-(--sz-120px) text-sm leading-7"
              mentions={mentionOptions}
              onSubmit={() => {
                if (!saveRoutine.isPending && editDraft.title.trim()) {
                  saveRoutine.mutate();
                }
              }}
            />
          </IssueDocumentAnnotations>
        ) : (
          <MarkdownEditor
            ref={descriptionEditorRef}
            value={editDraft.description}
            onChange={(description) =>
              setEditDraft((current) => ({ ...current, description }))
            }
            placeholder={t("routineDetail.addInstructions", {
              defaultValue: "Add instructions...",
            })}
            bordered={false}
            contentClassName="min-h-(--sz-120px) text-sm leading-7"
            mentions={mentionOptions}
            onSubmit={() => {
              if (!saveRoutine.isPending && editDraft.title.trim()) {
                saveRoutine.mutate();
              }
            }}
          />
        )}
      </div>

      {/* Variables peek */}
      <div className="space-y-3">
        <RoutineVariablesHint />
        <RoutineVariablesEditor
          title={editDraft.title}
          description={editDraft.description}
          value={editDraft.variables}
          onChange={(variables) =>
            setEditDraft((current) => ({ ...current, variables }))
          }
        />
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          icon={Clock3}
          label={t("Triggers", { defaultValue: "Triggers" })}
          value={
            activeTriggers === 0
              ? t("None", { defaultValue: "None" })
              : t("routineDetail.activeTriggerCount", {
                  defaultValue: "{{count}} active",
                  count: activeTriggers,
                })
          }
          hint={
            nextFire
              ? t("routineDetail.nextFireAt", {
                  defaultValue: "Next fire {{time}}",
                  time: nextFire,
                })
              : t("No schedule", { defaultValue: "No schedule" })
          }
          to={() => navigateToSection("triggers")}
          ariaLabel={t("routineDetail.openTriggersAria", {
            defaultValue: "{{count}} triggers. Open triggers.",
            count: activeTriggers,
          })}
        />
        <SummaryCard
          icon={KeyRound}
          label={t("Secrets", { defaultValue: "Secrets" })}
          value={
            boundSecrets === 0
              ? t("None", { defaultValue: "None" })
              : t("routineDetail.boundSecretCount", {
                  defaultValue: "{{count}} bound",
                  count: boundSecrets,
                })
          }
          hint={t("routineDetail.manageBoundSecrets", {
            defaultValue: "Manage bound secrets",
          })}
          to={() => navigateToSection("secrets")}
          ariaLabel={t("routineDetail.openSecretsAria", {
            defaultValue: "{{count}} secrets bound. Open secrets.",
            count: boundSecrets,
          })}
        />
        <SummaryCard
          icon={Play}
          label={t("Last run", { defaultValue: "Last run" })}
          value={
            lastRun
              ? lastRun.status.replaceAll("_", " ")
              : t("No runs", { defaultValue: "No runs" })
          }
          hint={
            lastRun
              ? timeAgo(lastRun.triggeredAt)
              : t("routineDetail.triggerARun", {
                  defaultValue: "Trigger a run",
                })
          }
          to={() => navigateToSection("runs")}
          ariaLabel={
            lastRun
              ? t("routineDetail.openRunsWithStatusAria", {
                  defaultValue: "Last run {{status}}. Open runs.",
                  status: lastRun.status,
                })
              : t("routineDetail.openRunsEmptyAria", {
                  defaultValue: "No runs. Open runs.",
                })
          }
        />
      </div>

      {/* Recent activity */}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("Recent activity", { defaultValue: "Recent activity" })}
        </p>
        {recentActivity.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("routineDetail.noActivityYet", {
              defaultValue: "No activity yet.",
            })}
          </p>
        ) : (
          <div className="divide-y divide-border/60">
            {recentActivity.map((event) => (
              <div
                key={event.id}
                className="flex items-center gap-2 py-1.5 text-xs"
              >
                <Badge variant="outline" className="shrink-0 font-mono">
                  {event.action}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {event.details && Object.keys(event.details).length > 0
                    ? Object.keys(event.details).slice(0, 3).join(" · ")
                    : ""}
                </span>
                <span className="shrink-0 text-muted-foreground/60">
                  {timeAgo(event.createdAt)}
                </span>
              </div>
            ))}
            <button
              type="button"
              onClick={() => navigateToSection("activity")}
              className="flex items-center gap-1 pt-2 text-xs text-muted-foreground hover:text-foreground"
            >
              {t("routineDetail.viewAllActivity", {
                defaultValue: "View all activity",
              })}{" "}
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
  to,
  ariaLabel,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
  hint: string;
  to: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={to}
      aria-label={ariaLabel}
      className="text-left"
    >
      <Card className="gap-2 p-4 transition-colors hover:border-border hover:bg-accent/30">
        <CardContent className="space-y-1 p-0">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
            <Icon className="h-3.5 w-3.5" />
            {label}
            <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground/60" />
          </div>
          <p className="text-lg font-semibold">{value}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      </Card>
    </button>
  );
}

export function TriggersSection() {
  const { t } = useTranslation();
  const ctx = useRoutineDetail();
  const {
    routine,
    newTrigger,
    setNewTrigger,
    createTrigger,
    updateTrigger,
    deleteTrigger,
    rotateTrigger,
  } = ctx;
  const [addOpen, setAddOpen] = useState(false);
  const [newScheduleEditorValid, setNewScheduleEditorValid] = useState(true);
  const newScheduleValidation = useMemo(
    () =>
      newTrigger.kind === "schedule"
        ? getScheduleCronValidation(newTrigger.cronExpression, t)
        : null,
    [newTrigger.cronExpression, newTrigger.kind, t],
  );
  const addDisabled =
    createTrigger.isPending ||
    (newScheduleValidation
      ? !newScheduleValidation.valid || !newScheduleEditorValid
      : false);

  useEffect(() => {
    if (newTrigger.kind !== "schedule") setNewScheduleEditorValid(true);
  }, [newTrigger.kind]);

  return (
    <div className="space-y-4">
      {/* Add-trigger drawer header (§3.2) */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">
          {routine.triggers.length === 0
            ? t("routineDetail.noTriggersYet", {
                defaultValue: "No triggers yet",
              })
            : t("routineDetail.triggerCount", {
                defaultValue: "{{count}} trigger",
                defaultValue_other: "{{count}} triggers",
                count: routine.triggers.length,
              })}
        </p>
        <Button
          size="sm"
          variant={addOpen ? "secondary" : "default"}
          onClick={() => setAddOpen((open) => !open)}
          aria-expanded={addOpen}
        >
          {addOpen ? (
            <>
              <X className="mr-1.5 h-3.5 w-3.5" />
              {t("Cancel", { defaultValue: "Cancel" })}
            </>
          ) : (
            <>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {t("routineDetail.newTrigger", { defaultValue: "New trigger" })}
            </>
          )}
        </Button>
      </div>

      {/* Add trigger form — expand-on-click drawer */}
      {addOpen ? (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <p className="text-sm font-medium">
            {t("routineDetail.addTrigger", { defaultValue: "Add trigger" })}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">
                {t("Kind", { defaultValue: "Kind" })}
              </Label>
              <Select
                value={newTrigger.kind}
                onValueChange={(kind) =>
                  setNewTrigger((current) => ({ ...current, kind }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {triggerKinds.map((kind) => (
                    <SelectItem
                      key={kind}
                      value={kind}
                      disabled={kind === "webhook"}
                    >
                      {kind}
                      {kind === "webhook"
                        ? ` - ${t("Coming soon", { defaultValue: "Coming soon" })}`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {newTrigger.kind === "schedule" && (
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs">
                  {t("Schedule", { defaultValue: "Schedule" })}
                </Label>
                <ScheduleEditor
                  value={newTrigger.cronExpression}
                  onChange={(cronExpression) =>
                    setNewTrigger((current) => ({ ...current, cronExpression }))
                  }
                  onValidityChange={setNewScheduleEditorValid}
                />
              </div>
            )}
            {newTrigger.kind === "webhook" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {t("routineDetail.signingMode", {
                      defaultValue: "Signing mode",
                    })}
                  </Label>
                  <Select
                    value={newTrigger.signingMode}
                    onValueChange={(signingMode) =>
                      setNewTrigger((current) => ({ ...current, signingMode }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {signingModes.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {mode}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {signingModeDescription(newTrigger.signingMode, t)}
                  </p>
                </div>
                {!SIGNING_MODES_WITHOUT_REPLAY_WINDOW.has(
                  newTrigger.signingMode,
                ) && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      {t("routineDetail.replayWindowSeconds", {
                        defaultValue: "Replay window (seconds)",
                      })}
                    </Label>
                    <Input
                      value={newTrigger.replayWindowSec}
                      onChange={(event) =>
                        setNewTrigger((current) => ({
                          ...current,
                          replayWindowSec: event.target.value,
                        }))
                      }
                    />
                  </div>
                )}
              </>
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAddOpen(false)}>
              {t("Cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              size="sm"
              onClick={() =>
                createTrigger.mutate(undefined, {
                  onSuccess: () => {
                    setNewTrigger(createDefaultNewTrigger());
                    setAddOpen(false);
                  },
                })
              }
              disabled={addDisabled}
            >
              {createTrigger.isPending
                ? t("Adding...", { defaultValue: "Adding..." })
                : t("routineDetail.addTrigger", {
                    defaultValue: "Add trigger",
                  })}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Existing triggers */}
      {routine.triggers.length === 0 ? (
        <EmptyState
          icon={Clock3}
          message={t("routineDetail.noTriggersYetPeriod", {
            defaultValue: "No triggers yet.",
          })}
          action={t("routineDetail.addSchedule", {
            defaultValue: "Add a schedule",
          })}
          onAction={() => setAddOpen(true)}
        />
      ) : (
        <div className="space-y-3">
          {routine.triggers.map((trigger) => (
            <RoutineTriggerCard
              key={trigger.id}
              trigger={trigger}
              onSave={(id, patch) => updateTrigger.mutate({ id, patch })}
              onRotate={(id) => rotateTrigger.mutate(id)}
              onDelete={(id) => deleteTrigger.mutate(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function VariablesSection() {
  const { t } = useTranslation();
  const ctx = useRoutineDetail();
  const { editDraft, setEditDraft, navigateToSection } = ctx;
  const hasVariables = editDraft.variables.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-md border border-border bg-muted/20 px-4 py-3 text-xs">
        <span className="flex-1 text-muted-foreground">
          {t("routineDetail.variablesAutoDetectedPrefix", {
            defaultValue: "Variables are auto-detected from",
          })}{" "}
          <code className="font-mono">{"{{placeholders}}"}</code>{" "}
          {t("routineDetail.variablesAutoDetectedSuffix", {
            defaultValue:
              "in the title and instructions. The variable name is read-only - rename by editing the placeholder.",
          })}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigateToSection("overview")}
        >
          <Edit3 className="mr-1.5 h-3.5 w-3.5" />
          {t("routineDetail.editInstructions", {
            defaultValue: "Edit instructions",
          })}
        </Button>
      </div>

      {hasVariables ? (
        <RoutineVariablesEditor
          title={editDraft.title}
          description={editDraft.description}
          value={editDraft.variables}
          onChange={(variables) =>
            setEditDraft((current) => ({ ...current, variables }))
          }
        />
      ) : (
        <EmptyState
          icon={Braces}
          message={t("routineDetail.noVariablesYet", {
            defaultValue:
              "No variables yet. Add a {{placeholder}} in the title or instructions to create one.",
          })}
          action={t("routineDetail.editInstructions", {
            defaultValue: "Edit instructions",
          })}
          onAction={() => navigateToSection("overview")}
        />
      )}
    </div>
  );
}

export function SecretsSection() {
  const { t } = useTranslation();
  const ctx = useRoutineDetail();
  const {
    editDraft,
    setEditDraft,
    availableSecrets,
    createSecret,
    secretMessage,
    copySecretValue,
  } = ctx;

  // Project/company-scoped secrets that already see real usage, surfaced as
  // quick-bind chips (§3.4). Ranked by reference count then recency.
  const recentlyUsedSecrets = useMemo(
    () =>
      [...availableSecrets]
        .filter((secret) => secret.status === "active")
        .sort((a, b) => {
          const refDelta = (b.referenceCount ?? 0) - (a.referenceCount ?? 0);
          if (refDelta !== 0) return refDelta;
          return (
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        })
        .slice(0, 8),
    [availableSecrets],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        {t("routineDetail.secretsApplyPrefix", {
          defaultValue:
            "Routine secrets apply to every task this routine creates. They override matching keys in project and agent env.",
        })}{" "}
        <span className="font-mono">PAPERCLIP_*</span>{" "}
        {t("routineDetail.secretsReservedSuffix", {
          defaultValue: "names are reserved.",
        })}
      </div>

      {secretMessage ? (
        <div className="space-y-3 rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-sm">
          <div>
            <p className="font-medium">{secretMessage.title}</p>
            <p className="text-xs text-muted-foreground">
              {t("routineDetail.saveSecretNow", {
                defaultValue:
                  "Save this now. Paperclip will not show the secret value again.",
              })}
            </p>
          </div>
          <div className="space-y-3">
            {secretMessage.entries.map((entry, index) => (
              <div key={`${entry.webhookUrl}-${index}`} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input value={entry.webhookUrl} readOnly className="flex-1" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      copySecretValue(
                        t("routineDetail.webhookUrl", {
                          defaultValue: "Webhook URL",
                        }),
                        entry.webhookUrl,
                      )
                    }
                  >
                    {t("tools.smokeLab.services.url")}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={entry.webhookSecret}
                    readOnly
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      copySecretValue("Webhook secret", entry.webhookSecret)
                    }
                  >
                    {t("envVarEditor.secret")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <EnvironmentVariablesEditor
        value={(editDraft.env ?? {}) as Record<string, EnvBinding>}
        secrets={availableSecrets}
        recentlyUsedSecrets={recentlyUsedSecrets}
        onCreateSecret={async (name, value) =>
          createSecret.mutateAsync({ name, value })
        }
        onChange={(env) =>
          setEditDraft((current) => ({ ...current, env: env ?? null }))
        }
      />
    </div>
  );
}

export function DeliverySection() {
  const { t } = useTranslation();
  const ctx = useRoutineDetail();
  const { editDraft, setEditDraft, routine } = ctx;
  const concurrencyOptions = useMemo(
    () =>
      concurrencyPolicyOptions.map((option) => ({
        ...option,
        title: t(`routineDetail.policyTitle.${option.value}`, {
          defaultValue: option.title,
        }),
        description: t(`routineDetail.policyDescription.${option.value}`, {
          defaultValue: option.description,
        }),
      })),
    [t],
  );
  const catchUpOptions = useMemo(
    () =>
      catchUpPolicyOptions.map((option) => ({
        ...option,
        title: t(`routineDetail.policyTitle.${option.value}`, {
          defaultValue: option.title,
        }),
        description: t(`routineDetail.policyDescription.${option.value}`, {
          defaultValue: option.description,
        }),
      })),
    [t],
  );

  // The activity gate only affects schedule ticks (webhook/manual/API fires are
  // themselves activity and always run), so the control is only meaningful for
  // routines that have a schedule trigger. Disable — rather than hide — it
  // elsewhere so the capability stays discoverable.
  const hasScheduleTrigger = routine.triggers.some(
    (trigger) => trigger.kind === "schedule",
  );
  const gateEnabled =
    editDraft.activityGatePolicy === "require_external_activity";

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-(--tracking-caps) text-muted-foreground">
          {t("routineDetail.concurrency", { defaultValue: "Concurrency" })}
        </p>
        <RadioCardGroup
          ariaLabel={t("routineDetail.concurrencyPolicy", {
            defaultValue: "Concurrency policy",
          })}
          value={editDraft.concurrencyPolicy}
          onValueChange={(concurrencyPolicy) =>
            setEditDraft((current) => ({ ...current, concurrencyPolicy }))
          }
          options={concurrencyOptions}
        />
      </div>
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-(--tracking-caps) text-muted-foreground">
          {t("routineDetail.catchUp", { defaultValue: "Catch-up" })}
        </p>
        <RadioCardGroup
          ariaLabel={t("routineDetail.catchUpPolicy", {
            defaultValue: "Catch-up policy",
          })}
          value={editDraft.catchUpPolicy}
          onValueChange={(catchUpPolicy) =>
            setEditDraft((current) => ({ ...current, catchUpPolicy }))
          }
          options={catchUpOptions}
        />
      </div>
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-(--tracking-caps) text-muted-foreground">
          {t("agentConfig.advancedRunPolicy")}
        </p>
        <RadioCardGroup
          ariaLabel="Advanced run policy"
          value={editDraft.activityGatePolicy}
          onValueChange={(activityGatePolicy) =>
            setEditDraft((current) => ({ ...current, activityGatePolicy }))
          }
          options={activityGatePolicyOptions}
          disabled={!hasScheduleTrigger}
        />
        {!hasScheduleTrigger ? (
          <p className="text-xs text-muted-foreground">
            {t("routineEditor.scheduleTriggerHint")}
          </p>
        ) : gateEnabled ? (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <Label className="text-xs font-medium">
              {t("routineEditor.activityScope")}
            </Label>
            <RadioCardGroup
              ariaLabel="Activity gate scope"
              value={editDraft.activityGateScope}
              onValueChange={(activityGateScope) =>
                setEditDraft((current) => ({ ...current, activityGateScope }))
              }
              options={activityGateScopeOptions}
            />
          </div>
        ) : null}
      </div>
      <NextFiresPreview
        triggers={routine.triggers}
        concurrencyPolicy={editDraft.concurrencyPolicy}
      />
    </div>
  );
}

const dispositionToneClass: Record<string, string> = {
  queued: "text-emerald-600 dark:text-emerald-400",
  coalesced: "text-amber-600 dark:text-amber-400",
  skipped: "text-muted-foreground",
};

/**
 * "Next 5 fires" preview (§3.5) — the strongest "what does this policy mean?"
 * surface. Picks the soonest-firing schedule trigger, computes its next fires
 * client-side, and annotates each with how the chosen concurrency policy would
 * treat it.
 */
function NextFiresPreview({
  triggers,
  concurrencyPolicy,
}: {
  triggers: RoutineDetailType["triggers"];
  concurrencyPolicy: string;
}) {
  const { t } = useTranslation();
  const preview = useMemo(() => {
    const schedule = triggers
      .filter(
        (trigger) =>
          trigger.kind === "schedule" &&
          trigger.enabled &&
          trigger.cronExpression,
      )
      .map((trigger) => {
        const fires = nextCronFires(trigger.cronExpression, 5, {
          timeZone: trigger.timezone ?? "UTC",
        });
        return { trigger, fires };
      })
      .filter((entry) => entry.fires.length > 0)
      .sort((a, b) => a.fires[0]!.getTime() - b.fires[0]!.getTime())[0];
    if (!schedule) return null;
    return {
      timeZone: schedule.trigger.timezone ?? "UTC",
      entries: previewFirePolicies(schedule.fires, concurrencyPolicy),
    };
  }, [triggers, concurrencyPolicy]);

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-(--tracking-caps) text-muted-foreground">
        {t("routineDetail.nextFiveFires", { defaultValue: "Next 5 fires" })}
      </p>
      {preview ? (
        <>
          <div className="space-y-1.5 rounded-lg border border-border p-3 font-mono text-xs">
            {preview.entries.map((entry, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="text-muted-foreground/40">·</span>
                <span className="tabular-nums">
                  {formatFireTime(entry.at, preview.timeZone)}
                </span>
                <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                <span
                  className={cn(
                    "font-medium",
                    dispositionToneClass[entry.disposition],
                  )}
                >
                  {entry.label}
                </span>
                {entry.note ? (
                  <span className="truncate text-muted-foreground/60">
                    ({entry.note})
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          <p className="text-(length:--text-micro) text-muted-foreground/60">
            {t("routineDetail.previewAssumesPreviousRun", {
              defaultValue:
                "Preview assumes the previous run is still in flight when the next fires. Times shown in",
            })}{" "}
            {preview.timeZone}.
          </p>
        </>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          {t("routineDetail.noSchedulePreview", {
            defaultValue:
              "No enabled schedule trigger to preview. Add a schedule in Triggers to see how this policy treats upcoming fires.",
          })}
        </p>
      )}
    </div>
  );
}

function formatFireTime(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .format(date)
      .replace(",", "");
  } catch {
    return date.toISOString();
  }
}

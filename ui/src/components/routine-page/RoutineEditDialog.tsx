import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CompanySecret, EnvBinding, RoutineEnvConfig, RoutineTrigger, RoutineVariable } from "@penclipai/shared";
import { GitBranch, Plus, Webhook, X } from "lucide-react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { InlineEntitySelector } from "@/components/InlineEntitySelector";
import { MarkdownEditor, type MarkdownEditorRef, type MentionOption } from "@/components/MarkdownEditor";
import { RoutineVariablesEditor } from "@/components/RoutineVariablesEditor";
import { ScheduleEditor } from "@/components/ScheduleEditor";
import { EnvironmentVariablesEditor, type EnvironmentVariablesEditorHandle } from "@/components/environment-variables-editor";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deriveInitials } from "@/components/Identity";
import { cn } from "@/lib/utils";
import type { RoutinePageAgent, RoutinePageProject, RoutinePerson } from "./RoutinePage";
import { WEBHOOK_HEALTH_LABELS, webhookHealth, webhookTitle } from "./routine-summary";

export type RoutineFormDraft = {
  title: string;
  description: string;
  projectId: string;
  assigneeAgentId: string;
  responsibleUserId: string;
  /** The responsibility this routine is filed under itself; empty for none. */
  responsibilityId: string;
  variables: RoutineVariable[];
  env: RoutineEnvConfig | null;
  schedule: { cronExpression: string; timezone: string } | null;
};

export const EMPTY_ROUTINE_FORM_DRAFT: RoutineFormDraft = {
  title: "",
  description: "",
  projectId: "",
  assigneeAgentId: "",
  responsibleUserId: "",
  responsibilityId: "",
  variables: [],
  env: null,
  schedule: null,
};

export type RoutineResponsibilityOption = {
  id: string;
  title: string;
  areaTitle?: string | null;
  /** Projects filed under it. A routine in one of them is already under this responsibility. */
  projectIds?: readonly string[];
};

export type RoutineEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: "edit" | "create";
  initial: RoutineFormDraft;
  agents: readonly RoutinePageAgent[];
  projects: readonly RoutinePageProject[];
  people: readonly RoutinePerson[];
  secrets: readonly CompanySecret[];
  /** Leave undefined while areas of responsibility are switched off; the field is then hidden. */
  responsibilities?: readonly RoutineResponsibilityOption[];
  mentions?: MentionOption[];
  /** False when this person may not reassign responsibility. */
  canChangeResponsibleUser?: boolean;
  saving?: boolean;
  /** Someone else saved this routine while the form was open. */
  saveConflict?: boolean;
  error?: string | null;
  onSave: (draft: RoutineFormDraft) => void;
  onReloadLatest?: () => void;
  onCreateSecret: (name: string, value: string) => Promise<CompanySecret>;
  /** Saved webhooks. They are created and changed right away, apart from the form's Save. */
  webhooks?: readonly RoutineTrigger[];
  /** Opens the webhook dialog; `null` starts a new webhook. Omit while creating a routine. */
  onOpenWebhook?: (trigger: RoutineTrigger | null) => void;
  onRemoveWebhook?: (trigger: RoutineTrigger) => void;
  /** Webhooks removed while this form is open, offered back with Undo. */
  removedWebhooks?: readonly RoutineTrigger[];
  onRestoreWebhook?: (trigger: RoutineTrigger) => void;
  /** The webhook dialog, rendered inside this one so both stay open together. */
  children?: ReactNode;
};

const SCHEDULE_TIMEZONES = ["America/Los_Angeles", "America/Chicago", "America/New_York", "Europe/London", "UTC"];

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function RoutineEditDialog({
  open,
  onOpenChange,
  mode = "edit",
  initial,
  agents,
  projects,
  people,
  secrets,
  responsibilities,
  mentions,
  canChangeResponsibleUser = true,
  saving = false,
  saveConflict = false,
  error = null,
  onSave,
  onReloadLatest,
  onCreateSecret,
  webhooks = [],
  onOpenWebhook,
  onRemoveWebhook,
  removedWebhooks = [],
  onRestoreWebhook,
  children,
}: RoutineEditDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [secretsOpen, setSecretsOpen] = useState(() => Object.keys(initial.env ?? {}).length > 0);
  const [scheduleValid, setScheduleValid] = useState(true);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const editorRef = useRef<MarkdownEditorRef>(null);
  const secretsRef = useRef<EnvironmentVariablesEditorHandle>(null);
  /** Secrets rows being typed that the secrets editor has not promoted into the draft yet. */
  const [secretsDirty, setSecretsDirty] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    setDraft(initial);
    setSecretsOpen(Object.keys(initial.env ?? {}).length > 0);
    setConfirmingDiscard(false);
    setSecretsDirty(false);
  }, [initial, open]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial]) || secretsDirty;
  const patch = (change: Partial<RoutineFormDraft>) => setDraft((current) => ({ ...current, ...change }));
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const personById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const responsibilityById = useMemo(
    () => new Map((responsibilities ?? []).map((responsibility) => [responsibility.id, responsibility])),
    [responsibilities],
  );
  const throughProject = draft.projectId
    ? (responsibilities ?? []).find(
        (responsibility) => responsibility.id !== draft.responsibilityId && responsibility.projectIds?.includes(draft.projectId),
      ) ?? null
    : null;
  const canSave = draft.title.trim().length > 0 && scheduleValid && !saving && !saveConflict && (mode === "create" || dirty);

  /** Saves the draft, including secrets rows still being typed. */
  const submit = () => {
    if (!canSave) return;
    const flushed = secretsRef.current?.flushPendingDraft();
    if (flushed?.status === "blocked") return;
    onSave(
      flushed?.status === "flushed"
        ? { ...draft, env: Object.keys(flushed.value).length > 0 ? flushed.value : null }
        : draft,
    );
  };

  /** Escape, the close button and Cancel all come here. Nothing closes while a save is running, so a failed save keeps the draft and its error. */
  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirmingDiscard(true);
    else onOpenChange(false);
  };

  const personOption = (id: string) => {
    const person = personById.get(id);
    if (!person) return null;
    return (
      <>
        <Avatar size="xs" aria-hidden="true">
          {person.avatarUrl ? <AvatarImage src={person.avatarUrl} alt="" /> : null}
          <AvatarFallback>{deriveInitials(person.name)}</AvatarFallback>
        </Avatar>
        <span className="truncate">{person.name}</span>
      </>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
      <DialogContent className="flex max-h-(--sz-calc-18) flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="px-6 pb-4 pt-6">
          <DialogTitle>{mode === "create" ? t("routines.newRoutine", { defaultValue: "New routine" }) : t("routinePage.editRoutine", { defaultValue: "Edit routine" })}</DialogTitle>
          <DialogDescription className="sr-only">
            {mode === "create"
              ? t("routineForm.createDescription", { defaultValue: "Describe the work, then choose who does it and when." })
              : t("routineForm.editDescription", { defaultValue: "Change what this routine does, who does it, and when." })}
          </DialogDescription>
        </DialogHeader>

        <form
          id={`${titleId}-form`}
          className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6 [&>*]:shrink-0"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={titleId}>{t("routines.sortField.title", { defaultValue: "Title" })}</Label>
            <Input
              id={titleId}
              value={draft.title}
              autoFocus={mode === "create"}
              placeholder={t("routineForm.titlePlaceholder", { defaultValue: "Send the weekly digest" })}
              onChange={(event) => patch({ title: event.target.value })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("routinePage.instructions", { defaultValue: "Instructions" })}</Label>
            {/* The frame owns the border and the drag handle; the editor scrolls inside it. */}
            <div
              className="h-48 min-h-32 resize-y overflow-y-auto rounded-md border border-border px-3 py-2 focus-within:border-ring"
              onClick={(event) => {
                if (event.target === event.currentTarget) editorRef.current?.focus();
              }}
            >
            <MarkdownEditor
              ref={editorRef}
              bordered={false}
              ariaLabel={t("routinePage.instructions", { defaultValue: "Instructions" })}
              value={draft.description}
              onChange={(description) => patch({ description })}
              placeholder={t("routineForm.instructionsPlaceholder", { defaultValue: "What should the agent do each time? Type / for skills and routines, @ to mention, {{name}} to ask for a value." })}
              contentClassName="text-sm leading-6"
              mentions={mentions}
              submitKey="mod-enter"
              onSubmit={submit}
            />
            </div>
          </div>

          <RoutineVariablesEditor
            title={draft.title}
            description={draft.description}
            value={draft.variables}
            onChange={(variables) => patch({ variables })}
            variant="compact"
          />

          <div className="flex flex-col gap-2">
            <Label>{t("routinePage.repeats", { defaultValue: "Repeats" })}</Label>
            {draft.schedule ? (
              <div className="flex flex-col gap-3">
                <ScheduleEditor
                  inline
                  value={draft.schedule.cronExpression}
                  onChange={(cronExpression) =>
                    setDraft((current) => (current.schedule ? { ...current, schedule: { ...current.schedule, cronExpression } } : current))
                  }
                  onValidityChange={setScheduleValid}
                  trailing={(
                    <Select
                      value={draft.schedule.timezone}
                      onValueChange={(timezone) =>
                        setDraft((current) => (current.schedule ? { ...current, schedule: { ...current.schedule, timezone } } : current))
                      }
                    >
                      <SelectTrigger className="w-48" aria-label={t("routineForm.timezoneAria", { defaultValue: "Time zone" })}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from(new Set([draft.schedule.timezone, localTimezone(), ...SCHEDULE_TIMEZONES])).map((zone) => (
                          <SelectItem key={zone} value={zone}>{zone}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-mx-2 w-fit text-muted-foreground"
                  onClick={() => {
                    setScheduleValid(true);
                    patch({ schedule: null });
                  }}
                >
                  {t("routinePage.removeSchedule", { defaultValue: "Remove schedule" })}
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => patch({ schedule: { cronExpression: "0 9 * * 1-5", timezone: localTimezone() } })}
              >
                <Plus className="h-3.5 w-3.5" />
                {t("routineDetail.addSchedule", { defaultValue: "Add schedule" })}
              </Button>
            )}
          </div>

          {onOpenWebhook ? (
            <div className="flex flex-col gap-2">
              <Label>{t("routineForm.webhooks", { defaultValue: "Webhooks" })}</Label>
              {removedWebhooks.map((trigger) => (
                <p key={trigger.id} role="status" className="flex max-w-md items-center gap-2 text-sm text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">{t("routinePage.triggerRemoved", { title: webhookTitle(trigger), defaultValue: "{{title}} removed." })}</span>
                  <Button type="button" variant="ghost" size="xs" onClick={() => onRestoreWebhook?.(trigger)}>{t("common.undo", { defaultValue: "Undo" })}</Button>
                </p>
              ))}
              {webhooks.length > 0 ? (
                <ul className="flex max-w-md flex-col">
                  {webhooks.map((trigger) => {
                    const health = webhookHealth(trigger);
                    const Icon = trigger.signingMode === "github_hmac" ? GitBranch : Webhook;
                    const title = webhookTitle(trigger);
                    return (
                      <li key={trigger.id} className="group/webhook -mx-2 flex items-center rounded-md hover:bg-accent/50 focus-within:bg-accent/50">
                        <button
                          type="button"
                          aria-label={t("routineForm.configureWebhookAria", { title, defaultValue: "Configure {{title}}" })}
                          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => onOpenWebhook(trigger)}
                        >
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
                          <span className={cn("shrink-0 text-xs", health === "rejected" ? "text-destructive" : "text-muted-foreground")}>
                            {WEBHOOK_HEALTH_LABELS[health]}
                          </span>
                        </button>
                        {onRemoveWebhook ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t("routineForm.removeWebhookAria", { title, defaultValue: "Remove {{title}}" })}
                            className="mr-1 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover/webhook:opacity-100 group-focus-within/webhook:opacity-100"
                            onClick={() => onRemoveWebhook(trigger)}
                          >
                            <X />
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => onOpenWebhook(null)}>
                <Plus className="h-3.5 w-3.5" />
                {t("routineForm.addWebhook", { defaultValue: "Add webhook" })}
              </Button>
            </div>
          ) : null}

          <div className="flex max-w-xs flex-col gap-6">
            <div className="flex min-w-0 flex-col gap-2">
              <Label>{t("routinePage.defaultAgent", { defaultValue: "Default agent" })}</Label>
              <InlineEntitySelector
                value={draft.assigneeAgentId}
                options={agents.map((agent) => ({ id: agent.id, label: agent.name }))}
                placeholder={t("routinePage.chooseAgent", { defaultValue: "Choose an agent" })}
                noneLabel={t("No default agent", { defaultValue: "No default agent" })}
                searchPlaceholder={t("routineForm.searchAgents", { defaultValue: "Search agents…" })}
                emptyMessage={t("routineForm.noAgentsFound", { defaultValue: "No agents found." })}
                disablePortal
                className="h-9 w-full justify-start"
                onChange={(assigneeAgentId) => patch({ assigneeAgentId })}
                renderTriggerValue={(option) => {
                  const agent = option ? agentById.get(option.id) : null;
                  return agent ? (
                    <>
                      <AgentAvatar agent={agent} size={20} className="shrink-0" />
                      <span className="truncate">{agent.name}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{t("routinePage.chooseAgent", { defaultValue: "Choose an agent" })}</span>
                  );
                }}
                renderOption={(option) => {
                  const agent = agentById.get(option.id);
                  return (
                    <>
                      {agent ? <AgentAvatar agent={agent} size={20} className="shrink-0" /> : null}
                      <span className="truncate">{option.label}</span>
                    </>
                  );
                }}
              />
            </div>

            <div className="flex min-w-0 flex-col gap-2">
              <Label>{t("routines.project", { defaultValue: "Project" })}</Label>
              <InlineEntitySelector
                value={draft.projectId}
                options={projects.map((project) => ({ id: project.id, label: project.name }))}
                placeholder={t("routines.noProject", { defaultValue: "No project" })}
                noneLabel={t("routines.noProject", { defaultValue: "No project" })}
                searchPlaceholder={t("routineForm.searchProjects", { defaultValue: "Search projects…" })}
                emptyMessage={t("routineForm.noProjectsFound", { defaultValue: "No projects found." })}
                disablePortal
                className="h-9 w-full justify-start"
                onChange={(projectId) => patch({ projectId })}
                renderTriggerValue={(option) => {
                  const project = option ? projectById.get(option.id) : null;
                  return project ? (
                    <>
                      <span className="h-3.5 w-3.5 shrink-0 rounded-sm" style={{ backgroundColor: project.color ?? "var(--project-none)" }} />
                      <span className="truncate">{project.name}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{t("routines.noProject", { defaultValue: "No project" })}</span>
                  );
                }}
                renderOption={(option) => {
                  const project = projectById.get(option.id);
                  return (
                    <>
                      {project ? (
                        <span className="h-3.5 w-3.5 shrink-0 rounded-sm" style={{ backgroundColor: project.color ?? "var(--project-none)" }} />
                      ) : null}
                      <span className="truncate">{option.label}</span>
                    </>
                  );
                }}
              />
            </div>

            {responsibilities ? (
              <div className="flex min-w-0 flex-col gap-2">
                <Label>{t("routinePage.responsibility", { defaultValue: "Responsibility" })}</Label>
                <InlineEntitySelector
                  value={draft.responsibilityId}
                  options={responsibilities.map((responsibility) => ({
                    id: responsibility.id,
                    label: responsibility.title,
                    searchText: responsibility.areaTitle ?? "",
                  }))}
                  placeholder={t("routineForm.noResponsibility", { defaultValue: "No responsibility" })}
                  noneLabel={t("routineForm.noResponsibility", { defaultValue: "No responsibility" })}
                  searchPlaceholder={t("routineForm.searchResponsibilities", { defaultValue: "Search responsibilities…" })}
                  emptyMessage={t("routineForm.noResponsibilitiesFound", { defaultValue: "No responsibilities found." })}
                  disablePortal
                  className="h-9 w-full justify-start"
                  onChange={(responsibilityId) => patch({ responsibilityId })}
                  renderTriggerValue={(option) =>
                    option?.id ? <span className="truncate">{option.label}</span> : <span className="text-muted-foreground">{t("routineForm.noResponsibility", { defaultValue: "No responsibility" })}</span>
                  }
                  renderOption={(option) => {
                    const areaTitle = responsibilityById.get(option.id)?.areaTitle;
                    return (
                      <>
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                        {areaTitle ? <span className="shrink-0 text-xs text-muted-foreground">{areaTitle}</span> : null}
                      </>
                    );
                  }}
                />
                {throughProject ? (
                  <p className="text-xs text-muted-foreground">
                    {t("routineForm.alreadyUnderThroughProject", {
                      responsibility: throughProject.title,
                      project: projectById.get(draft.projectId)?.name ?? t("routineForm.itsProject", { defaultValue: "its project" }),
                      defaultValue: "Already under {{responsibility}} through {{project}}.",
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex min-w-0 flex-col gap-2">
              <Label>{t("routinePage.defaultResponsibleUser", { defaultValue: "Default responsible user" })}</Label>
              <InlineEntitySelector
                value={draft.responsibleUserId}
                options={people.map((person) => ({ id: person.id, label: person.name }))}
                placeholder={t("routineForm.choosePerson", { defaultValue: "Choose a person" })}
                noneLabel={t("routineForm.noOne", { defaultValue: "No one" })}
                // A responsible user can be changed but not cleared; "No one" only shows while there is none.
                hideNone={Boolean(initial.responsibleUserId)}
                searchPlaceholder={t("routineForm.findPerson", { defaultValue: "Find a person…" })}
                emptyMessage={t("routineForm.noPeopleFound", { defaultValue: "No people found." })}
                disablePortal
                disabled={!canChangeResponsibleUser}
                className="h-9 w-full justify-start"
                onChange={(responsibleUserId) => patch({ responsibleUserId })}
                renderTriggerValue={(option) =>
                  (option && personOption(option.id)) || <span className="text-muted-foreground">{t("routineForm.choosePerson", { defaultValue: "Choose a person" })}</span>
                }
                renderOption={(option) => personOption(option.id) ?? <span className="truncate">{option.label}</span>}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("Secrets", { defaultValue: "Secrets" })}</Label>
            {secretsOpen ? (
              <EnvironmentVariablesEditor
                ref={secretsRef}
                onDirtyChange={setSecretsDirty}
                value={(draft.env ?? {}) as Record<string, EnvBinding>}
                secrets={secrets}
                onCreateSecret={onCreateSecret}
                onChange={(env) => patch({ env: env && Object.keys(env).length > 0 ? env : null })}
                footerHint={null}
                hideDraftActions
                startWithEmptyRow
                addLabel={t("routineForm.addSecret", { defaultValue: "Add secret" })}
              />
            ) : (
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setSecretsOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                {t("routineForm.addSecret", { defaultValue: "Add secret" })}
              </Button>
            )}
          </div>
        </form>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
          {confirmingDiscard ? (
            <>
              <p className="text-sm" role="alert">{t("routineForm.discardConfirm", { defaultValue: "Discard your changes?" })}</p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setConfirmingDiscard(false)}>{t("routineForm.keepEditing", { defaultValue: "Keep editing" })}</Button>
                <Button variant="destructive" onClick={() => onOpenChange(false)}>{t("Discard", { defaultValue: "Discard" })}</Button>
              </div>
            </>
          ) : saveConflict ? (
            <>
              <p className="min-w-0 flex-1 text-sm" role="alert">
                {t("routineForm.saveConflict", { defaultValue: "This routine changed while you were editing. Reload to see the latest version." })}
              </p>
              <Button variant="outline" onClick={onReloadLatest}>{t("routineForm.reloadLatest", { defaultValue: "Reload latest" })}</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={requestClose} disabled={saving}>{t("Cancel", { defaultValue: "Cancel" })}</Button>
              <div className="flex min-w-0 items-center gap-3">
                {error ? <p className="min-w-0 text-sm text-destructive" role="alert">{error}</p> : null}
                <Button type="submit" form={`${titleId}-form`} disabled={!canSave}>
                  {saving ? t("Saving…", { defaultValue: "Saving…" }) : mode === "create" ? t("routines.create", { defaultValue: "Create routine" }) : t("Save changes", { defaultValue: "Save changes" })}
                </Button>
              </div>
            </>
          )}
        </footer>
        {children}
      </DialogContent>
    </Dialog>
  );
}

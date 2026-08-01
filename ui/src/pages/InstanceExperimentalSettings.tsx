import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Clock,
  FlaskConical,
  Lock,
  Play,
  Search,
} from "lucide-react";
import type {
  InstanceExperimentalSettings,
  InstanceExperimentalSettingsWithManaged,
  IssueGraphLivenessAutoRecoveryPreview,
  ManagedSettingMetadata,
  PatchInstanceExperimentalSettings,
} from "@penclipai/shared";
import { instanceSettingsApi } from "@/api/instanceSettings";
import {
  getWorktreeInstanceId,
  isWorktreeRuntime,
} from "../lib/worktree-branding";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function issueHref(identifier: string | null, issueId: string) {
  if (!identifier) return `/issues/${issueId}`;
  const prefix = identifier.split("-")[0] || "PAP";
  return `/${prefix}/issues/${identifier}`;
}

function formatRecoveryState(state: string) {
  return state.replace(/_/g, " ");
}

type WorktreeRunExecutionDisplayState =
  | { kind: "off" }
  | { kind: "armed"; activatedAt: string }
  | {
      kind: "fail_closed";
      reason: "missing_cutoff" | "missing_instance_id" | "instance_mismatch";
    };

/**
 * Mirror of the server's `resolveWorktreeRunExecutionActivation` fail-closed
 * ladder (server/src/services/instance-settings.ts) so the card never claims a
 * copied/legacy row is arming execution. The derived fields are display-only —
 * the PATCH the toggle sends still writes just the boolean.
 */
function resolveWorktreeRunExecutionDisplayState(
  settings:
    | Pick<
        InstanceExperimentalSettings,
        | "enableWorktreeRunExecution"
        | "worktreeRunExecutionActivatedAt"
        | "worktreeRunExecutionActivationInstanceId"
      >
    | undefined,
  currentInstanceId: string | null,
): WorktreeRunExecutionDisplayState {
  if (settings?.enableWorktreeRunExecution !== true) return { kind: "off" };
  if (!settings.worktreeRunExecutionActivatedAt)
    return { kind: "fail_closed", reason: "missing_cutoff" };
  if (!currentInstanceId)
    return { kind: "fail_closed", reason: "missing_instance_id" };
  if (settings.worktreeRunExecutionActivationInstanceId !== currentInstanceId) {
    return { kind: "fail_closed", reason: "instance_mismatch" };
  }
  return {
    kind: "armed",
    activatedAt: settings.worktreeRunExecutionActivatedAt,
  };
}

function formatActivationTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// PAP-11233: keep Conference Room code intact, but hide the user-facing opt-in for now.
const SHOW_CONFERENCE_ROOM_EXPERIMENTAL_SETTING = false;

function ManagedByCloudBadge() {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <Lock aria-hidden="true" />
      {t("instanceExperimentalSettings.managedByCloud")}
    </Badge>
  );
}

function ExperimentalToggleCard({
  title,
  experimental = false,
  description,
  footnote,
  checked,
  onCheckedChange,
  disabled,
  managed,
  ariaLabel,
}: {
  title: string;
  experimental?: boolean;
  description: string;
  footnote?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled: boolean;
  managed?: ManagedSettingMetadata;
  ariaLabel: string;
}) {
  const { t } = useTranslation();
  const isManaged = managed?.managed === true;
  return (
    <Card className="block p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            {experimental ? (
              <Badge variant="secondary">{t("Experimental")}</Badge>
            ) : null}
            {isManaged ? <ManagedByCloudBadge /> : null}
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
          {footnote ? (
            <p className="max-w-2xl text-xs text-muted-foreground">
              {footnote}
            </p>
          ) : null}
        </div>
        <ToggleSwitch
          checked={checked}
          onCheckedChange={(next) => {
            if (isManaged) return;
            onCheckedChange(next);
          }}
          disabled={disabled || isManaged}
          aria-label={ariaLabel}
        />
      </div>
    </Card>
  );
}

function RecoveryPreviewDialog({
  preview,
  open,
  onOpenChange,
  onEnableOnly,
  onEnableAndRun,
  isPending,
}: {
  preview: IssueGraphLivenessAutoRecoveryPreview | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEnableOnly: () => void;
  onEnableAndRun: () => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const count = preview?.recoverableFindings ?? 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("Confirm auto-recovery")}</DialogTitle>
          <DialogDescription>
            {preview
              ? `${count} recovery ${count === 1 ? "task" : "tasks"} match the last ${preview.lookbackHours} hours.`
              : "Checking recovery candidates before enabling."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-(--sz-calc-36) space-y-3 overflow-y-auto pr-1">
          {preview && preview.items.length === 0 ? (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
              {t(
                "No recovery tasks would be created right now. Auto-recovery can still run for future liveness incidents in this window.",
              )}
            </div>
          ) : null}

          {preview?.items.map((item) => (
            <Card key={item.incidentKey} className="block px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={issueHref(item.identifier, item.issueId)}
                  className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                >
                  {item.identifier ?? item.issueId}
                </a>
                <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {formatRecoveryState(item.state)}
                </span>
              </div>
              <p className="mt-1 text-sm text-foreground">{item.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.reason}
              </p>
              <div className="mt-2 text-xs text-muted-foreground">
                {t("Recovery target:")}{" "}
                <a
                  href={issueHref(
                    item.recoveryIdentifier,
                    item.recoveryIssueId,
                  )}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  {item.recoveryIdentifier ?? item.recoveryIssueId}
                </a>
              </div>
            </Card>
          ))}
        </div>

        {preview && preview.skippedOutsideLookback > 0 ? (
          <p className="text-xs text-muted-foreground">
            {preview.skippedOutsideLookback} {t("agentConfig.currentBadge")}{" "}
            {preview.skippedOutsideLookback === 1
              ? "finding is"
              : "findings are"}{" "}
            {t("instanceExperimentalSettings.outsideLookback")}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t("Cancel")}
          </Button>
          <Button
            variant="outline"
            onClick={onEnableOnly}
            disabled={isPending || !preview}
          >
            {t("instanceExperimentalSettings.enableOnly")}
          </Button>
          <Button onClick={onEnableAndRun} disabled={isPending || !preview}>
            {count > 0 ? `Enable and create ${count}` : "Enable"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InstanceExperimentalSettings() {
  const { t } = useTranslation();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [lookbackHoursDraft, setLookbackHoursDraft] = useState("24");
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [pendingPreview, setPendingPreview] =
    useState<IssueGraphLivenessAutoRecoveryPreview | null>(null);

  function closeRecoveryPreview() {
    setPreviewDialogOpen(false);
    setPendingPreview(null);
  }

  useEffect(() => {
    setBreadcrumbs([
      { label: "Settings", href: "/company/settings" },
      {
        label: "Instance settings",
        href: "/company/settings/instance/general",
      },
      { label: "Experimental" },
    ]);
  }, [setBreadcrumbs]);

  const experimentalQuery = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });

  const toggleMutation = useMutation<
    InstanceExperimentalSettingsWithManaged,
    Error,
    PatchInstanceExperimentalSettings,
    { previousSettings?: InstanceExperimentalSettingsWithManaged }
  >({
    mutationFn: async (patch: PatchInstanceExperimentalSettings) =>
      instanceSettingsApi.updateExperimental(patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.instance.experimentalSettings,
      });
      const previousSettings =
        queryClient.getQueryData<InstanceExperimentalSettingsWithManaged>(
          queryKeys.instance.experimentalSettings,
        );
      if (previousSettings) {
        queryClient.setQueryData<InstanceExperimentalSettingsWithManaged>(
          queryKeys.instance.experimentalSettings,
          { ...previousSettings, ...patch },
        );
      }
      return { previousSettings };
    },
    onSuccess: async (updatedSettings) => {
      setActionError(null);
      queryClient.setQueryData(
        queryKeys.instance.experimentalSettings,
        updatedSettings,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.instance.experimentalSettings,
        }),
        queryClient.invalidateQueries({ queryKey: ["built-in-agents"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.health }),
      ]);
    },
    onError: (error, _patch, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(
          queryKeys.instance.experimentalSettings,
          context.previousSettings,
        );
      }
      setActionError(
        error instanceof Error
          ? error.message
          : "Failed to update experimental settings.",
      );
    },
  });

  const previewMutation = useMutation({
    mutationFn: async (lookbackHours: number) =>
      instanceSettingsApi.previewIssueGraphLivenessAutoRecovery({
        lookbackHours,
      }),
    onSuccess: (preview) => {
      setActionError(null);
      setPendingPreview(preview);
      setPreviewDialogOpen(true);
    },
    onError: (error) => {
      setActionError(
        error instanceof Error
          ? error.message
          : "Failed to preview recovery tasks.",
      );
    },
  });

  const runRecoveryMutation = useMutation({
    mutationFn: async (lookbackHours: number) =>
      instanceSettingsApi.runIssueGraphLivenessAutoRecovery({ lookbackHours }),
    onSuccess: async () => {
      setActionError(null);
      closeRecoveryPreview();
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.instance.experimentalSettings,
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.health }),
      ]);
    },
    onError: (error) => {
      setActionError(
        error instanceof Error
          ? error.message
          : "Failed to create recovery tasks.",
      );
    },
  });

  useEffect(() => {
    const next =
      experimentalQuery.data?.issueGraphLivenessAutoRecoveryLookbackHours;
    if (typeof next === "number") {
      setLookbackHoursDraft(String(next));
    }
  }, [experimentalQuery.data?.issueGraphLivenessAutoRecoveryLookbackHours]);

  const autoRecoveryManaged =
    experimentalQuery.data?.managedKeys?.enableIssueGraphLivenessAutoRecovery
      ?.managed === true;

  // If refreshed settings mark auto-recovery as managed while the preview
  // dialog is open, close it so its confirmation actions cannot emit a PATCH.
  useEffect(() => {
    if (autoRecoveryManaged) {
      closeRecoveryPreview();
    }
  }, [autoRecoveryManaged]);

  if (experimentalQuery.isLoading) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("instanceExperimentalSettings.loading")}
      </div>
    );
  }

  if (experimentalQuery.error) {
    return (
      <div className="text-sm text-destructive">
        {experimentalQuery.error instanceof Error
          ? experimentalQuery.error.message
          : "Failed to load experimental settings."}
      </div>
    );
  }

  const inWorktree = isWorktreeRuntime();
  // Present only on cloud-managed instances: keys the managed overlay controls
  // render locked with the "Managed by Paperclip Cloud" badge. Self-hosted
  // responses carry no `managedKeys`, so every card stays editable.
  const managedKeys = experimentalQuery.data?.managedKeys ?? {};
  const enableWorktreeRunExecution =
    experimentalQuery.data?.enableWorktreeRunExecution === true;
  const worktreeRunExecutionManaged =
    managedKeys.enableWorktreeRunExecution?.managed === true;
  const worktreeRunExecutionState = resolveWorktreeRunExecutionDisplayState(
    experimentalQuery.data,
    getWorktreeInstanceId(),
  );
  const enableEnvironments =
    experimentalQuery.data?.enableEnvironments === true;
  const enableIsolatedWorkspaces =
    experimentalQuery.data?.enableIsolatedWorkspaces === true;
  const enableApps = experimentalQuery.data?.enableApps === true;
  // Streamlined left navigation is now the standard sidebar (PAP-12472); the
  // experimental opt-out was retired, so it no longer surfaces a toggle here.
  const enableConferenceRoomChat =
    experimentalQuery.data?.enableConferenceRoomChat === true;
  const enableIssuePlanDecompositions =
    experimentalQuery.data?.enableIssuePlanDecompositions === true;
  const enableExperimentalFileViewer =
    experimentalQuery.data?.enableExperimentalFileViewer === true;
  const enableTaskWatchdogs =
    experimentalQuery.data?.enableTaskWatchdogs === true;
  const enableExternalObjects =
    experimentalQuery.data?.enableExternalObjects === true;
  const enableBuiltInAgents =
    experimentalQuery.data?.enableBuiltInAgents === true;
  const enableBetaSkills = experimentalQuery.data?.enableBetaSkills === true;
  const enableSummaries = experimentalQuery.data?.enableSummaries === true;
  const enableStatusCards = experimentalQuery.data?.enableStatusCards === true;
  const summariesManaged = managedKeys.enableSummaries?.managed === true;
  const statusCardsManaged = managedKeys.enableStatusCards?.managed === true;
  const statusCardsBlockedByManagedSummaries =
    summariesManaged && !enableSummaries;
  const summariesRequiredByManagedStatusCards =
    statusCardsManaged && enableStatusCards;
  const enableDecisions = experimentalQuery.data?.enableDecisions === true;
  const enableGoalsSidebarLink =
    experimentalQuery.data?.enableGoalsSidebarLink === true;
  const enableCases = experimentalQuery.data?.enableCases === true;
  const enableServerInfoDebugView =
    experimentalQuery.data?.enableServerInfoDebugView === true;
  const enableSmokeLab = experimentalQuery.data?.enableSmokeLab === true;
  const autoRestartDevServerWhenIdle =
    experimentalQuery.data?.autoRestartDevServerWhenIdle === true;
  const enableIssueGraphLivenessAutoRecovery =
    experimentalQuery.data?.enableIssueGraphLivenessAutoRecovery === true;
  const lookbackHours =
    experimentalQuery.data?.issueGraphLivenessAutoRecoveryLookbackHours ?? 24;
  const parsedLookbackHours = Number.parseInt(lookbackHoursDraft, 10);
  const lookbackHoursIsValid =
    Number.isInteger(parsedLookbackHours) &&
    parsedLookbackHours >= 1 &&
    parsedLookbackHours <= 720;
  const recoveryActionPending =
    toggleMutation.isPending ||
    previewMutation.isPending ||
    runRecoveryMutation.isPending;

  function previewForEnable() {
    if (autoRecoveryManaged) return;
    if (!lookbackHoursIsValid) {
      setActionError("Lookback hours must be a whole number from 1 to 720.");
      return;
    }
    closeRecoveryPreview();
    previewMutation.mutate(parsedLookbackHours);
  }

  function enableOnly() {
    if (autoRecoveryManaged) return;
    if (!lookbackHoursIsValid) return;
    closeRecoveryPreview();
    toggleMutation.mutate({
      enableIssueGraphLivenessAutoRecovery: true,
      issueGraphLivenessAutoRecoveryLookbackHours: parsedLookbackHours,
    });
  }

  function enableAndRun() {
    if (autoRecoveryManaged) return;
    if (!lookbackHoursIsValid) return;
    closeRecoveryPreview();
    toggleMutation.mutate(
      {
        enableIssueGraphLivenessAutoRecovery: true,
        issueGraphLivenessAutoRecoveryLookbackHours: parsedLookbackHours,
      },
      {
        onSuccess: () => runRecoveryMutation.mutate(parsedLookbackHours),
      },
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t("Experimental")}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {t(
            "Opt into features that are still being evaluated before they become default behavior.",
          )}
        </p>
      </div>

      <div
        role="alert"
        className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">
              {t("instanceExperimentalSettings.warningTitle")}
            </p>
            <p className="text-muted-foreground">
              {t("instanceExperimentalSettings.warningBody")}
            </p>
          </div>
        </div>
      </div>

      {actionError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {inWorktree ? (
        <Card className="block p-5">
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold">
                    {t(
                      "instanceExperimentalSettings.worktreeRunExecutionTitle",
                    )}
                  </h2>
                  {worktreeRunExecutionManaged ? <ManagedByCloudBadge /> : null}
                </div>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  {t("instanceExperimentalSettings.previewExecutionHint")}
                </p>
              </div>
              <ToggleSwitch
                checked={enableWorktreeRunExecution}
                onCheckedChange={(checked) => {
                  if (worktreeRunExecutionManaged) return;
                  toggleMutation.mutate({
                    enableWorktreeRunExecution: checked,
                  });
                }}
                disabled={
                  toggleMutation.isPending || worktreeRunExecutionManaged
                }
                aria-label={t(
                  "instanceExperimentalSettings.worktreeRunExecutionToggle",
                )}
              />
            </div>

            {worktreeRunExecutionState.kind === "armed" ? (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-foreground">
                <Play className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>
                  {t("instanceExperimentalSettings.runningAfter")}{" "}
                  <span className="font-medium">
                    {formatActivationTimestamp(
                      worktreeRunExecutionState.activatedAt,
                    )}
                  </span>
                  .
                </span>
              </div>
            ) : null}

            {worktreeRunExecutionState.kind === "fail_closed" ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <div className="space-y-0.5">
                  <p className="font-medium text-foreground">
                    {t("instanceExperimentalSettings.executionSuppressed")}
                  </p>
                  <p className="text-muted-foreground">
                    {worktreeRunExecutionState.reason === "instance_mismatch"
                      ? "This setting was armed in a different instance and copied here, so no tasks run automatically."
                      : "This setting is missing its activation cutoff, so no tasks run automatically."}{" "}
                    {t(
                      "instanceExperimentalSettings.worktreeRunExecutionRearm",
                    )}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      <ExperimentalToggleCard
        title={t("instanceExperimentalSettings.appsTitle")}
        experimental
        description={t("instanceExperimentalSettings.appsDescription")}
        checked={enableApps}
        onCheckedChange={(checked) =>
          toggleMutation.mutate({ enableApps: checked })
        }
        disabled={toggleMutation.isPending}
        managed={managedKeys.enableApps}
        ariaLabel="Toggle apps experimental setting"
      />

      <ExperimentalToggleCard
        title={t("instanceExperimentalSettings.casesTitle")}
        experimental
        description={t("instanceExperimentalSettings.casesDescription")}
        footnote="Turning Cases off hides the tab and blocks the case API; existing case data is kept."
        checked={enableCases}
        onCheckedChange={(checked) =>
          toggleMutation.mutate({ enableCases: checked })
        }
        disabled={toggleMutation.isPending}
        managed={managedKeys.enableCases}
        ariaLabel="Toggle cases experimental setting"
      />

      <ExperimentalToggleCard
        title={t("Enable Environments")}
        description={t(
          "Show environment management in company settings and allow project and agent environment assignment controls.",
        )}
        checked={enableEnvironments}
        onCheckedChange={(checked) =>
          toggleMutation.mutate({ enableEnvironments: checked })
        }
        disabled={toggleMutation.isPending}
        managed={managedKeys.enableEnvironments}
        ariaLabel="Toggle environments experimental setting"
      />

      <ExperimentalToggleCard
        title={t("instanceExperimentalSettings.builtInAgentsTitle")}
        description={t("instanceExperimentalSettings.builtInAgentsDescription")}
        checked={enableBuiltInAgents}
        onCheckedChange={(checked) =>
          toggleMutation.mutate({ enableBuiltInAgents: checked })
        }
        disabled={toggleMutation.isPending}
        managed={managedKeys.enableBuiltInAgents}
        ariaLabel="Toggle built-in agents experimental setting"
      />

      <ExperimentalToggleCard
        title={t("instanceExperimentalSettings.betaSkillsTitle")}
        description={t("instanceExperimentalSettings.betaSkillsDescription")}
        checked={enableBetaSkills}
        onCheckedChange={(checked) =>
          toggleMutation.mutate({ enableBetaSkills: checked })
        }
        disabled={toggleMutation.isPending}
        managed={managedKeys.enableBetaSkills}
        ariaLabel="Toggle beta skills experimental setting"
      />

      <ExperimentalToggleCard
        title={t("instanceExperimentalSettings.summariesTitle")}
        description={t("instanceExperimentalSettings.summariesDescription")}
        footnote="Status Cards requires Summaries. Disabling Summaries also disables Status Cards."
        checked={enableSummaries}
        onCheckedChange={(checked) =>
          toggleMutation.mutate(
            checked || !enableStatusCards
              ? { enableSummaries: checked }
              : { enableSummaries: false, enableStatusCards: false },
          )
        }
        disabled={
          toggleMutation.isPending || summariesRequiredByManagedStatusCards
        }
        managed={managedKeys.enableSummaries}
        ariaLabel="Toggle summaries experimental setting"
      />

      <ExperimentalToggleCard
        title={t("instanceExperimentalSettings.fileViewerTitle")}
        description={t("instanceExperimentalSettings.fileViewerDescription")}
        checked={enableExperimentalFileViewer}
        onCheckedChange={(checked) =>
          toggleMutation.mutate({ enableExperimentalFileViewer: checked })
        }
        disabled={toggleMutation.isPending}
        managed={managedKeys.enableExperimentalFileViewer}
        ariaLabel="Toggle experimental file viewer setting"
      />

      <ExperimentalToggleCard
        title={t("instanceExperimentalSettings.statusCardsTitle")}
        description={t("instanceExperimentalSettings.statusCardsDescription")}
        footnote="Enabling Status Cards also enables Summaries."
        checked={enableStatusCards}
        onCheckedChange={(checked) =>
          toggleMutation.mutate(
            checked
              ? { enableSummaries: true, enableStatusCards: true }
              : { enableStatusCards: false },
          )
        }
        disabled={
          toggleMutation.isPending || statusCardsBlockedByManagedSummaries
        }
        managed={managedKeys.enableStatusCards}
        ariaLabel="Toggle status cards experimental setting"
      />

      <ExperimentalToggleCard
        title={t("instanceExperimentalSettings.externalObjectsTitle")}
        description={t(
          "instanceExperimentalSettings.externalObjectsDescription",
        )}
        checked={enableExternalObjects}
        onCheckedChange={(checked) =>
          toggleMutation.mutate({ enableExternalObjects: checked })
        }
        disabled={toggleMutation.isPending}
        managed={managedKeys.enableExternalObjects}
        ariaLabel="Toggle external objects experimental setting"
      />

      <ExperimentalToggleCard
        title={t("instanceExperimentalSettings.decisionsTitle")}
        description={t("instanceExperimentalSettings.decisionsDescription")}
        checked={enableDecisions}
        onCheckedChange={(checked) =>
          toggleMutation.mutate({ enableDecisions: checked })
        }
        disabled={toggleMutation.isPending}
        managed={managedKeys.enableDecisions}
        ariaLabel="Toggle decisions experimental setting"
      />

      <ExperimentalToggleCard
        title={t("instanceExperimentalSettings.goalsSidebarLinkTitle")}
        description={t(
          "instanceExperimentalSettings.goalsSidebarLinkDescription",
        )}
        checked={enableGoalsSidebarLink}
        onCheckedChange={(checked) =>
          toggleMutation.mutate({ enableGoalsSidebarLink: checked })
        }
        disabled={toggleMutation.isPending}
        managed={managedKeys.enableGoalsSidebarLink}
        ariaLabel="Toggle goals sidebar link experimental setting"
      />

      <ExperimentalToggleCard
        title={t("Enable Isolated Workspaces")}
        description={t("instanceExperimentalSettings.workspacesDescription")}
        checked={enableIsolatedWorkspaces}
        onCheckedChange={(checked) =>
          toggleMutation.mutate({ enableIsolatedWorkspaces: checked })
        }
        disabled={toggleMutation.isPending}
        managed={managedKeys.enableIsolatedWorkspaces}
        ariaLabel="Toggle isolated workspaces experimental setting"
      />

      {SHOW_CONFERENCE_ROOM_EXPERIMENTAL_SETTING ? (
        <ExperimentalToggleCard
          title={t("instanceExperimentalSettings.conferenceChatTitle")}
          description={t(
            "instanceExperimentalSettings.conferenceChatDescription",
          )}
          checked={enableConferenceRoomChat}
          onCheckedChange={(checked) =>
            toggleMutation.mutate({ enableConferenceRoomChat: checked })
          }
          disabled={toggleMutation.isPending}
          managed={managedKeys.enableConferenceRoomChat}
          ariaLabel="Toggle conference room chat experimental setting"
        />
      ) : null}

      <ExperimentalToggleCard
        title={t("instanceExperimentalSettings.planDecompositionTitle")}
        description={t(
          "instanceExperimentalSettings.planDecompositionDescription",
        )}
        checked={enableIssuePlanDecompositions}
        onCheckedChange={(checked) =>
          toggleMutation.mutate({ enableIssuePlanDecompositions: checked })
        }
        disabled={toggleMutation.isPending}
        managed={managedKeys.enableIssuePlanDecompositions}
        ariaLabel="Toggle task plan decomposition panel experimental setting"
      />

      <ExperimentalToggleCard
        title={t("instanceExperimentalSettings.taskWatchdogsTitle")}
        description={t("instanceExperimentalSettings.taskWatchdogsDescription")}
        checked={enableTaskWatchdogs}
        onCheckedChange={(checked) =>
          toggleMutation.mutate({ enableTaskWatchdogs: checked })
        }
        disabled={toggleMutation.isPending}
        managed={managedKeys.enableTaskWatchdogs}
        ariaLabel="Toggle task watchdogs experimental setting"
      />

      <ExperimentalToggleCard
        title={t("instanceExperimentalSettings.serverInfoDebugViewTitle")}
        description={t(
          "instanceExperimentalSettings.serverInfoDebugViewDescription",
        )}
        checked={enableServerInfoDebugView}
        onCheckedChange={(checked) =>
          toggleMutation.mutate({ enableServerInfoDebugView: checked })
        }
        disabled={toggleMutation.isPending}
        managed={managedKeys.enableServerInfoDebugView}
        ariaLabel="Toggle server info debug view experimental setting"
      />

      <ExperimentalToggleCard
        title={t("instanceExperimentalSettings.smokeLabTitle")}
        description={t("instanceExperimentalSettings.smokeLabDescription")}
        checked={enableSmokeLab}
        onCheckedChange={(checked) =>
          toggleMutation.mutate({ enableSmokeLab: checked })
        }
        disabled={toggleMutation.isPending}
        managed={managedKeys.enableSmokeLab}
        ariaLabel="Toggle smoke lab experimental setting"
      />

      <ExperimentalToggleCard
        title={t("Auto-Restart Dev Server When Idle")}
        description={t(
          "In `pnpm dev:once`, wait for all queued and running local agent runs to finish, then restart the server automatically when backend changes or migrations make the current boot stale.",
        )}
        checked={autoRestartDevServerWhenIdle}
        onCheckedChange={(checked) =>
          toggleMutation.mutate({ autoRestartDevServerWhenIdle: checked })
        }
        disabled={toggleMutation.isPending}
        managed={managedKeys.autoRestartDevServerWhenIdle}
        ariaLabel="Toggle guarded dev-server auto-restart"
      />

      <Card className="block p-5">
        <div className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">
                  {t("instanceExperimentalSettings.autoRecoveryTitle")}
                </h2>
                {autoRecoveryManaged ? <ManagedByCloudBadge /> : null}
              </div>
              <p className="max-w-2xl text-sm text-muted-foreground">
                {t("instanceExperimentalSettings.autoRecoveryDescription")}
              </p>
            </div>
            <ToggleSwitch
              data-testid="issue-graph-liveness-auto-recovery-toggle"
              checked={enableIssueGraphLivenessAutoRecovery}
              onCheckedChange={() => {
                if (autoRecoveryManaged) return;
                if (enableIssueGraphLivenessAutoRecovery) {
                  toggleMutation.mutate({
                    enableIssueGraphLivenessAutoRecovery: false,
                  });
                  return;
                }
                previewForEnable();
              }}
              disabled={recoveryActionPending || autoRecoveryManaged}
              aria-label={t("instanceExperimentalSettings.autoRecoveryAria")}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-(--gtc-35) sm:items-end">
            <label className="space-y-1.5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {t("instanceExperimentalSettings.lookbackHours")}
              </span>
              <Input
                type="number"
                min={1}
                max={720}
                step={1}
                value={lookbackHoursDraft}
                onChange={(event) => setLookbackHoursDraft(event.target.value)}
                aria-invalid={!lookbackHoursIsValid}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (!lookbackHoursIsValid) {
                    setActionError(
                      "Lookback hours must be a whole number from 1 to 720.",
                    );
                    return;
                  }
                  toggleMutation.mutate({
                    issueGraphLivenessAutoRecoveryLookbackHours:
                      parsedLookbackHours,
                  });
                }}
                disabled={
                  recoveryActionPending || parsedLookbackHours === lookbackHours
                }
              >
                {t("instanceExperimentalSettings.saveHours")}
              </Button>
              <Button
                variant="outline"
                onClick={previewForEnable}
                disabled={recoveryActionPending}
              >
                <Search className="h-4 w-4" />
                {t("Preview")}
              </Button>
              <Button
                onClick={() => {
                  if (!lookbackHoursIsValid) {
                    setActionError(
                      "Lookback hours must be a whole number from 1 to 720.",
                    );
                    return;
                  }
                  runRecoveryMutation.mutate(parsedLookbackHours);
                }}
                disabled={
                  recoveryActionPending || !enableIssueGraphLivenessAutoRecovery
                }
              >
                <Play className="h-4 w-4" />
                {t("instanceExperimentalSettings.runNow")}
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {t("instanceExperimentalSettings.currentWindow")} {lookbackHours}{" "}
            {lookbackHours === 1 ? "hour" : "hours"}.
          </p>
        </div>
      </Card>

      {previewDialogOpen && !autoRecoveryManaged ? (
        <RecoveryPreviewDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              closeRecoveryPreview();
            }
          }}
          preview={pendingPreview}
          onEnableOnly={enableOnly}
          onEnableAndRun={enableAndRun}
          isPending={recoveryActionPending}
        />
      ) : null}
    </div>
  );
}

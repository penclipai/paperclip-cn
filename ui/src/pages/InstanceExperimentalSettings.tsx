import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FlaskConical, Lock, Play } from "lucide-react";
import type {
  InstanceExperimentalSettings,
  InstanceExperimentalSettingsWithManaged,
  InstanceFeatureKey,
  ManagedSettingMetadata,
  PatchInstanceExperimentalSettings,
} from "@penclipai/shared";
import { experimentalSettingKey } from "@penclipai/shared";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { useHiddenSettings } from "@/hooks/useHiddenSettings";
import { getWorktreeInstanceId, isWorktreeRuntime } from "../lib/worktree-branding";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/lib/router";

type WorktreeRunExecutionDisplayState =
  | { kind: "off" }
  | { kind: "armed"; activatedAt: string }
  | { kind: "fail_closed"; reason: "missing_cutoff" | "missing_instance_id" | "instance_mismatch" };

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
  if (!settings.worktreeRunExecutionActivatedAt) return { kind: "fail_closed", reason: "missing_cutoff" };
  if (!currentInstanceId) return { kind: "fail_closed", reason: "missing_instance_id" };
  if (settings.worktreeRunExecutionActivationInstanceId !== currentInstanceId) {
    return { kind: "fail_closed", reason: "instance_mismatch" };
  }
  return { kind: "armed", activatedAt: settings.worktreeRunExecutionActivatedAt };
}

function formatActivationTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// PAP-11233: keep Conference Room code intact, but hide the user-facing opt-in for now.
const SHOW_CONFERENCE_ROOM_EXPERIMENTAL_SETTING = false;

function ManagedByCloudBadge() {
  useTranslation();
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <Lock aria-hidden="true" />
      {translateInstant("instanceExperimentalSettings.managedByCloud")}</Badge>
  );
}

function ExperimentalToggleCard({
  title,
  description,
  footnote,
  checked,
  onCheckedChange,
  disabled,
  settingKey,
  managed,
  ariaLabel,
}: {
  title: string;
  description: string;
  footnote?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled: boolean;
  /** Flag key backing this card; operator-hidden keys render nothing. */
  settingKey: InstanceFeatureKey;
  managed?: ManagedSettingMetadata;
  ariaLabel: string;
}) {
  const { hidden: hiddenSettings } = useHiddenSettings();
  const isManaged = managed?.managed === true;
  if (hiddenSettings.has(experimentalSettingKey(settingKey))) return null;
  return (
    <Card className="block bg-transparent p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            {isManaged ? <ManagedByCloudBadge /> : null}
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
          {footnote ? <p className="max-w-2xl text-xs text-muted-foreground">{footnote}</p> : null}
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

export function InstanceExperimentalSettings() {
  useTranslation();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const { hidden: hiddenSettings } = useHiddenSettings();
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: translateInstant("Settings"), href: "/company/settings" },
      { label: translateInstant("Experimental") },
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
      await queryClient.cancelQueries({ queryKey: queryKeys.instance.experimentalSettings });
      const previousSettings = queryClient.getQueryData<InstanceExperimentalSettingsWithManaged>(
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
      queryClient.setQueryData(queryKeys.instance.experimentalSettings, updatedSettings);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.instance.experimentalSettings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.adapters.all }),
        queryClient.invalidateQueries({ queryKey: ["built-in-agents"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.health }),
        queryClient.invalidateQueries({ queryKey: ["apps"] }),
      ]);
    },
    onError: (error, _patch, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(queryKeys.instance.experimentalSettings, context.previousSettings);
      }
      setActionError(error instanceof Error ? error.message : "Failed to update experimental settings.");
    },
  });

  if (experimentalQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">{translateInstant("instanceExperimentalSettings.loading")}</div>;
  }

  if (experimentalQuery.error) {
    return (
      <div className="text-sm text-destructive">
        {experimentalQuery.error instanceof Error
          ? experimentalQuery.error.message
          : translateInstant("Failed to load experimental settings.")}
      </div>
    );
  }

  const inWorktree = isWorktreeRuntime();
  // Present only on cloud-managed instances: keys the managed overlay controls
  // render locked with the "Managed by Paperclip Cloud" badge. Self-hosted
  // responses carry no `managedKeys`, so every card stays editable.
  const managedKeys = experimentalQuery.data?.managedKeys ?? {};
  const enableWorktreeRunExecution = experimentalQuery.data?.enableWorktreeRunExecution === true;
  const worktreeRunExecutionManaged = managedKeys.enableWorktreeRunExecution?.managed === true;
  const worktreeRunExecutionState = resolveWorktreeRunExecutionDisplayState(
    experimentalQuery.data,
    getWorktreeInstanceId(),
  );
  const enableEnvironments = experimentalQuery.data?.enableEnvironments === true;
  const enableNativeRunner = experimentalQuery.data?.enableNativeRunner === true;
  const enableChatConnectors = experimentalQuery.data?.enableChatConnectors === true;
  const enableManagedSandboxOnly = experimentalQuery.data?.enableManagedSandboxOnly === true;
  const enableIsolatedWorkspaces = experimentalQuery.data?.enableIsolatedWorkspaces === true;
  const enableIsolatedWorkspacesByDefault =
    experimentalQuery.data?.enableIsolatedWorkspacesByDefault === true;
  // Streamlined left navigation is now the standard sidebar (PAP-12472); the
  // experimental opt-out was retired, so it no longer surfaces a toggle here.
  const enableStreamlinedUi = experimentalQuery.data?.enableStreamlinedUi !== false;
  const enableConferenceRoomChat = experimentalQuery.data?.enableConferenceRoomChat === true;
  const enableClassicTaskInterface = experimentalQuery.data?.enableClassicTaskInterface === true;
  const enableIssuePlanDecompositions =
    experimentalQuery.data?.enableIssuePlanDecompositions === true;
  const enableExperimentalFileViewer =
    experimentalQuery.data?.enableExperimentalFileViewer === true;
  const enableExternalObjects = experimentalQuery.data?.enableExternalObjects === true;
  const enableBuiltInAgents = experimentalQuery.data?.enableBuiltInAgents === true;
  const enableBetaSkills = experimentalQuery.data?.enableBetaSkills === true;
  const enableSummaries = experimentalQuery.data?.enableSummaries === true;
  const enableStatusCards = experimentalQuery.data?.enableStatusCards === true;
  const summariesManaged = managedKeys.enableSummaries?.managed === true;
  const statusCardsManaged = managedKeys.enableStatusCards?.managed === true;
  const statusCardsBlockedByManagedSummaries = summariesManaged && !enableSummaries;
  const summariesRequiredByManagedStatusCards = statusCardsManaged && enableStatusCards;
  const enableDecisions = experimentalQuery.data?.enableDecisions === true;
  const enableGoalsSidebarLink = experimentalQuery.data?.enableGoalsSidebarLink === true;
  const enableCases = experimentalQuery.data?.enableCases === true;
  const enableServerInfoDebugView = experimentalQuery.data?.enableServerInfoDebugView === true;
  const enablePaperclipDeveloperMode =
    experimentalQuery.data?.enablePaperclipDeveloperMode === true;
  const enableSimplifiedEnglishInteractions =
    experimentalQuery.data?.enableSimplifiedEnglishInteractions === true;
  const enableFirstTaskPlanProposal =
    experimentalQuery.data?.enableFirstTaskPlanProposal === true;
  const enableSmokeLab = experimentalQuery.data?.enableSmokeLab === true;
  const autoRestartDevServerWhenIdle = experimentalQuery.data?.autoRestartDevServerWhenIdle === true;
  const isVisible = (key: InstanceFeatureKey) => !hiddenSettings.has(experimentalSettingKey(key));
  const showWorktreeRunExecution = inWorktree && isVisible("enableWorktreeRunExecution");
  const showDeveloperSection = showWorktreeRunExecution || ([
    "autoRestartDevServerWhenIdle",
    "enableManagedSandboxOnly",
    "enablePaperclipDeveloperMode",
    "enableServerInfoDebugView",
    "enableSmokeLab",
    "enableIssuePlanDecompositions",
  ] satisfies InstanceFeatureKey[]).some(isVisible);
  const showLegacySection = isVisible("enableClassicTaskInterface") || isVisible("enableGoalsSidebarLink");
  return (
    <div className="max-w-6xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{translateInstant("Experimental")}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {translateInstant("Opt into features that are still being evaluated before they become default behavior.")}</p>
      </div>

      <div
        role="alert"
        className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">{translateInstant("instanceExperimentalSettings.warningTitle")}</p>
            <p className="text-muted-foreground">
              {translateInstant("instanceExperimentalSettings.warningBody")}</p>
          </div>
        </div>
      </div>

      {actionError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      <section className="space-y-3" aria-labelledby="experimental-features-heading">
        <div className="space-y-1">
          <h2 id="experimental-features-heading" className="text-sm font-semibold">
            {translateInstant("Experimental features")}</h2>
          <p className="text-sm text-muted-foreground">
            {translateInstant("Optional product features that are still being evaluated.")}</p>
        </div>

        <ExperimentalToggleCard
          title={translateInstant("Agent Chat")}
          description={translateInstant("Talk to each agent in one ongoing conversation. Clarify goals and create tasks for execution. Chat leads the Work group and opens an agent rail beside the nav, and each chat's side panel shows the agent's tasks and artifacts as cards.")}
          footnote={translateInstant("Turning this off preserves conversations and lets active runs finish, but prevents new messages.")}
          checked={experimentalQuery.data?.enableAgentChat ?? false}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableAgentChat: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableAgentChat"
          managed={managedKeys.enableAgentChat}
          ariaLabel={translateInstant("Toggle agent chat experimental setting")}
        />

        <ExperimentalToggleCard
          title="Artifacts V1"
          description="Show artifacts the way the artifact directions lab settled: paper stacks and tiles on the Artifacts page, compact rows in the panel's Artifacts tab, and grouped rows in the task thread."
          footnote="Presentation only. Turning this off restores the current cards; no data changes."
          checked={experimentalQuery.data?.enableArtifactsV1 ?? false}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableArtifactsV1: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableArtifactsV1"
          managed={managedKeys.enableArtifactsV1}
          ariaLabel="Toggle artifacts V1 experimental setting"
        />

        <ExperimentalToggleCard
          title={translateInstant("Assistant connections (MCP)")}
          description={translateInstant("Connect Codex, Claude, and other assistants to your Paperclip organization. People sign in, select an organization once, and approve access to review work, delegate tasks, and add feedback.")}
          footnote={<>{translateInstant("Requires an authenticated instance with a configured public URL. Takes effect immediately. Turning this off blocks assistant calls and event delivery; work already delegated continues.")}{experimentalQuery.data?.enablePublicMcp && <> <Link className="underline" to="/apps/assistant-connection">{translateInstant("Set up an assistant connection")}</Link></>}</>}
          checked={experimentalQuery.data?.enablePublicMcp === true}
          onCheckedChange={(checked) => toggleMutation.mutate({ enablePublicMcp: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enablePublicMcp"
          managed={managedKeys.enablePublicMcp}
          ariaLabel={translateInstant("Toggle assistant connections experimental setting")}
        />

        <ExperimentalToggleCard
          title={translateInstant("instanceExperimentalSettings.betaSkillsTitle")}
          description={translateInstant("instanceExperimentalSettings.betaSkillsDescription")}
          checked={enableBetaSkills}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableBetaSkills: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableBetaSkills"
          managed={managedKeys.enableBetaSkills}
          ariaLabel={translateInstant("instanceExperimentalSettings.betaSkillsToggle")}
        />

        <ExperimentalToggleCard
          title={translateInstant("instanceExperimentalSettings.builtInAgentsTitle")}
          description={translateInstant("Show Paperclip-managed built-in agent surfaces, including built-in roster badges, the Built-in agents tab, and built-in agent setup controls.")}
          checked={enableBuiltInAgents}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableBuiltInAgents: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableBuiltInAgents"
          managed={managedKeys.enableBuiltInAgents}
          ariaLabel={translateInstant("instanceExperimentalSettings.builtInAgentsToggle")}
        />

        <ExperimentalToggleCard
          title={translateInstant("Cases")}
          description={translateInstant("Durable work products (blog posts, tweet storms…) that tasks create and iterate on. Adds the Cases tab and the agent case API.")}
          footnote={translateInstant("instanceExperimentalSettings.casesDisabledDescription")}
          checked={enableCases}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableCases: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableCases"
          managed={managedKeys.enableCases}
          ariaLabel={translateInstant("instanceExperimentalSettings.casesToggle")}
        />

        <ExperimentalToggleCard
          title={translateInstant("Chat connectors")}
          description={translateInstant("Connect agents to Slack, Discord, Microsoft Teams, and Telegram conversations.")}
          footnote={translateInstant("Turning this off hides experimental chat setup and connected-task controls. Existing chat connections keep running. AgentMail, GitHub review bots, and tool connectors are controlled separately.")}
          checked={enableChatConnectors}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableChatConnectors: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableChatConnectors"
          managed={managedKeys.enableChatConnectors}
          ariaLabel={translateInstant("Toggle chat connectors experimental setting")}
        />

        <ExperimentalToggleCard
          title={translateInstant("Combined Inbox + Task List")}
          description={translateInstant("Fold Inbox into Tasks. One Tasks row carries the unread badge, and a Views menu reaches every inbox view (Mine, Unread, Blocked, Recent, Everything) and every task view.")}
          footnote={translateInstant("Old Inbox links redirect to the matching view. Turning this off restores the separate Inbox; no data changes.")}
          checked={experimentalQuery.data?.enableCombinedInboxTasks ?? false}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableCombinedInboxTasks: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableCombinedInboxTasks"
          managed={managedKeys.enableCombinedInboxTasks}
          ariaLabel={translateInstant("Toggle combined inbox and task list experimental setting")}
        />

        {SHOW_CONFERENCE_ROOM_EXPERIMENTAL_SETTING ? (
          <ExperimentalToggleCard
            title={translateInstant("instanceExperimentalSettings.conferenceChatTitle")}
            description={translateInstant("instanceExperimentalSettings.conferenceChatDescription")}
            checked={enableConferenceRoomChat}
            onCheckedChange={(checked) => toggleMutation.mutate({ enableConferenceRoomChat: checked })}
            disabled={toggleMutation.isPending}
            settingKey="enableConferenceRoomChat"
            managed={managedKeys.enableConferenceRoomChat}
            ariaLabel={translateInstant("instanceExperimentalSettings.conferenceChatToggle")}
          />
        ) : null}

        <ExperimentalToggleCard
          title={translateInstant("instanceExperimentalSettings.decisionsTitle")}
          description={translateInstant("Show the Decisions item in the main sidebar — the attention home that surfaces the tasks awaiting your input — while the surface is still being evaluated.")}
          checked={enableDecisions}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableDecisions: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableDecisions"
          managed={managedKeys.enableDecisions}
          ariaLabel={translateInstant("instanceExperimentalSettings.decisionsToggle")}
        />

        <ExperimentalToggleCard
          title={translateInstant("Enable Environments")}
          description={translateInstant("Show environment management in company settings and allow project and agent environment assignment controls.")}
          checked={enableEnvironments}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableEnvironments: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableEnvironments"
          managed={managedKeys.enableEnvironments}
          ariaLabel={translateInstant("Toggle environments experimental setting")}
        />

        <ExperimentalToggleCard
          title={translateInstant("instanceExperimentalSettings.externalObjectsTitle")}
          description={translateInstant("Detect external URLs in issues and show resolved status for pull requests, tickets, and other referenced work objects.")}
          checked={enableExternalObjects}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableExternalObjects: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableExternalObjects"
          managed={managedKeys.enableExternalObjects}
          ariaLabel={translateInstant("instanceExperimentalSettings.externalObjectsToggle")}
        />

        <ExperimentalToggleCard
          title={translateInstant("Enable Isolated Workspaces")}
          description={translateInstant("instanceExperimentalSettings.workspacesDescription")}
          checked={enableIsolatedWorkspaces}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableIsolatedWorkspaces: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableIsolatedWorkspaces"
          managed={managedKeys.enableIsolatedWorkspaces}
          ariaLabel={translateInstant("Toggle isolated workspaces experimental setting")}
        />

        <ExperimentalToggleCard
          title={translateInstant("Experimental fast responses")}
          description={translateInstant("Show Connections in company settings and allow short acknowledgements while agents begin work.")}
          checked={experimentalQuery.data?.enableFastResponses ?? false}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableFastResponses: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableFastResponses"
          managed={managedKeys.enableFastResponses}
          ariaLabel={translateInstant("Toggle fast responses experimental setting")}
        />

        <ExperimentalToggleCard
          title={translateInstant("Experimental File Viewer")}
          description={translateInstant("Show task detail controls for browsing and previewing workspace files relative to a task.")}
          checked={enableExperimentalFileViewer}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableExperimentalFileViewer: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableExperimentalFileViewer"
          managed={managedKeys.enableExperimentalFileViewer}
          ariaLabel={translateInstant("Toggle experimental file viewer setting")}
        />

        <ExperimentalToggleCard
          title={translateInstant("First task: propose with a plan document")}
          description={translateInstant("When the user's first request is a single task, the chief of staff writes a short plan document and a checkbox card instead of a one-card confirmation. Applies to organizations created after the toggle is flipped.")}
          checked={enableFirstTaskPlanProposal}
          onCheckedChange={(checked) =>
            toggleMutation.mutate({ enableFirstTaskPlanProposal: checked })
          }
          disabled={toggleMutation.isPending}
          settingKey="enableFirstTaskPlanProposal"
          managed={managedKeys.enableFirstTaskPlanProposal}
          ariaLabel={translateInstant("Toggle first task plan proposal experimental setting")}
        />

        <ExperimentalToggleCard
          title={translateInstant("GitHub review bots")}
          description={translateInstant("Connect agents to GitHub with their own App identity to review pull requests and respond to issues.")}
          footnote={translateInstant("Independent of Chat connectors. Turning this off hides setup and management; existing bots keep running. GitHub tool connections stay available.")}
          checked={experimentalQuery.data?.enableGitHubReviewBots === true}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableGitHubReviewBots: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableGitHubReviewBots"
          managed={managedKeys.enableGitHubReviewBots}
          ariaLabel={translateInstant("Toggle GitHub review bots experimental setting")}
        />

        <ExperimentalToggleCard
          title="Grok Bot"
          description="Connect an existing Grok Bot as an agent. Verify routine delivery and an authenticated reply before assigning work."
          footnote={translateInstant("experimental.grokBotRequirements")}
          checked={experimentalQuery.data?.enableGrokBot === true}
          onCheckedChange={checked => toggleMutation.mutate({ enableGrokBot: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableGrokBot" managed={managedKeys.enableGrokBot}
          ariaLabel="Toggle Grok Bot experimental setting"
        />


        <ExperimentalToggleCard
          title={translateInstant("Memory connectors")}
          description={translateInstant("Connect Mem0, Zep, Supermemory, Cognee, and Honcho for long-term memory and context.")}
          footnote={translateInstant("Turning this off hides setup for these connectors. Existing connections keep running.")}
          checked={experimentalQuery.data?.enableMemoryConnectors === true}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableMemoryConnectors: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableMemoryConnectors"
          managed={managedKeys.enableMemoryConnectors}
          ariaLabel={translateInstant("Toggle memory connectors experimental setting")}
        />

        <ExperimentalToggleCard
          title="Muse — Personal agent"
          description="Connect your personal Meta Muse. Pair it, detect its receiver, and verify an independent background reply before assigning tasks."
          footnote="Requires Paperclip Runner and an authenticated instance with a public HTTPS URL. Turning this off blocks new work; cleanup and stop evidence remain available. Provider usage and cost are unavailable."
          checked={experimentalQuery.data?.enableMuse === true}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableMuse: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableMuse"
          managed={managedKeys.enableMuse}
          ariaLabel="Toggle Muse experimental setting"
        />

        <ExperimentalToggleCard
          title="OpenAI Dot"
          description={translateInstant("Add OpenAI Dot as a standalone agent choice. Pair your Dot and verify event delivery before assigning work.")}
          footnote={translateInstant("Requires Assistant connections (MCP) and an authenticated instance with a public HTTPS URL. Turning this off blocks Dot calls and new work; saved connections are kept.")}
          checked={experimentalQuery.data?.enableOpenAiDot === true}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableOpenAiDot: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableOpenAiDot"
          managed={managedKeys.enableOpenAiDot}
          ariaLabel={translateInstant("Toggle OpenAI Dot experimental setting")}
        />


        <ExperimentalToggleCard
          title="Paperclip Runner"
          description={translateInstant("instanceExperimentalSettings.paperclipRunnerDescription")}
          checked={enableNativeRunner}
          onCheckedChange={(checked) =>
            toggleMutation.mutate({ enableNativeRunner: checked })
          }
          disabled={toggleMutation.isPending}
          settingKey="enableNativeRunner"
          managed={managedKeys.enableNativeRunner}
          ariaLabel={translateInstant("Toggle Paperclip Runner experimental setting")}
        />

        <ExperimentalToggleCard
          title={translateInstant("instanceExperimentalSettings.simplifiedEnglishInteractionsTitle")}
          description={translateInstant("Instruct agents to write user interactions (plan confirmations, questions, suggested tasks, checkbox prompts) in ASD-STE100 Simplified Technical English, with brief context on what information the decision needs and what happens for each choice.")}
          checked={enableSimplifiedEnglishInteractions}
          onCheckedChange={(checked) =>
            toggleMutation.mutate({ enableSimplifiedEnglishInteractions: checked })
          }
          disabled={toggleMutation.isPending}
          settingKey="enableSimplifiedEnglishInteractions"
          managed={managedKeys.enableSimplifiedEnglishInteractions}
          ariaLabel={translateInstant("instanceExperimentalSettings.simplifiedEnglishInteractionsToggle")}
        />

        <ExperimentalToggleCard
          title={translateInstant("instanceExperimentalSettings.statusCardsTitle")}
          description={translateInstant("instanceExperimentalSettings.statusCardsDescription")}
          footnote={translateInstant("Enabling Status Cards also enables Summaries.")}
          checked={enableStatusCards}
          onCheckedChange={(checked) =>
            toggleMutation.mutate(
              checked
                ? { enableSummaries: true, enableStatusCards: true }
                : { enableStatusCards: false },
            )
          }
          disabled={toggleMutation.isPending || statusCardsBlockedByManagedSummaries}
          settingKey="enableStatusCards"
          managed={managedKeys.enableStatusCards}
          ariaLabel={translateInstant("instanceExperimentalSettings.statusCardsToggle")}
        />

        <ExperimentalToggleCard
          title={translateInstant("Streamlined UI")}
          description={translateInstant("Use the simplified main sidebar, shared Tasks and Inbox presentation, focused task detail layout, and contextual navigation across Agents, Routines, Skills, and Settings.")}
          footnote={translateInstant("Turning this off restores the legacy shell and navigation. Task and page data are unchanged.")}
          checked={enableStreamlinedUi}
          onCheckedChange={(checked) => toggleMutation.mutate({ enableStreamlinedUi: checked })}
          disabled={toggleMutation.isPending}
          settingKey="enableStreamlinedUi"
          managed={managedKeys.enableStreamlinedUi}
          ariaLabel={translateInstant("Toggle Streamlined UI experimental setting")}
        />

        <ExperimentalToggleCard
          title={translateInstant("instanceExperimentalSettings.summariesTitle")}
          description={translateInstant("instanceExperimentalSettings.summariesDescription")}
          footnote={translateInstant("Status Cards requires Summaries. Disabling Summaries also disables Status Cards.")}
          checked={enableSummaries}
          onCheckedChange={(checked) =>
            toggleMutation.mutate(
              checked || !enableStatusCards
                ? { enableSummaries: checked }
                : { enableSummaries: false, enableStatusCards: false },
            )
          }
          disabled={toggleMutation.isPending || summariesRequiredByManagedStatusCards}
          settingKey="enableSummaries"
          managed={managedKeys.enableSummaries}
          ariaLabel={translateInstant("instanceExperimentalSettings.summariesToggle")}
        />

        {enableIsolatedWorkspaces && (
          <ExperimentalToggleCard
            title={translateInstant("Use Isolated Workspaces By Default")}
            description={translateInstant("Treat a project that has no execution workspace policy of its own as if it selected isolated workspaces, so its tasks get a per-task worktree instead of sharing the project checkout. A project that carries its own policy keeps it.")}
            checked={enableIsolatedWorkspacesByDefault}
            onCheckedChange={(checked) =>
              toggleMutation.mutate({ enableIsolatedWorkspacesByDefault: checked })
            }
            disabled={toggleMutation.isPending}
            settingKey="enableIsolatedWorkspacesByDefault"
            managed={managedKeys.enableIsolatedWorkspacesByDefault}
            ariaLabel={translateInstant("Toggle isolated workspaces by default experimental setting")}
          />
        )}
      </section>

      {showDeveloperSection ? (
        <section className="space-y-3" aria-labelledby="developer-mode-heading">
          <div className="space-y-1">
            <h2 id="developer-mode-heading" className="text-sm font-semibold">
              {translateInstant("Paperclip Developer Mode")}</h2>
            <p className="text-sm text-muted-foreground">
              {translateInstant("Internal tools for developing, testing, and debugging Paperclip.")}</p>
          </div>

          <ExperimentalToggleCard
            title={translateInstant("Auto-Restart Dev Server When Idle")}
            description={translateInstant("In `pnpm dev:once`, wait for all queued and running local agent runs to finish, then restart the server automatically when backend changes or migrations make the current boot stale.")}
            checked={autoRestartDevServerWhenIdle}
            onCheckedChange={(checked) =>
              toggleMutation.mutate({ autoRestartDevServerWhenIdle: checked })
            }
            disabled={toggleMutation.isPending}
            settingKey="autoRestartDevServerWhenIdle"
            managed={managedKeys.autoRestartDevServerWhenIdle}
            ariaLabel={translateInstant("Toggle guarded dev-server auto-restart")}
          />

          <ExperimentalToggleCard
            title={translateInstant("Managed Environment Only")}
            description={translateInstant("Hide the local environment and run all agents in the platform-managed environment.")}
            checked={enableManagedSandboxOnly}
            onCheckedChange={(checked) =>
              toggleMutation.mutate({ enableManagedSandboxOnly: checked })
            }
            disabled={toggleMutation.isPending}
            settingKey="enableManagedSandboxOnly"
            managed={managedKeys.enableManagedSandboxOnly}
            ariaLabel={translateInstant("instanceExperimentalSettings.managedSandboxOnlyToggle")}
          />

          <ExperimentalToggleCard
            title={translateInstant("Paperclip Developer Mode")}
            description={translateInstant("Show internal Paperclip maintainer tools and observability links, including Honeycomb trace queries on run pages.")}
            checked={enablePaperclipDeveloperMode}
            onCheckedChange={(checked) =>
              toggleMutation.mutate({ enablePaperclipDeveloperMode: checked })
            }
            disabled={toggleMutation.isPending}
            settingKey="enablePaperclipDeveloperMode"
            managed={managedKeys.enablePaperclipDeveloperMode}
            ariaLabel={translateInstant("Toggle Paperclip developer mode experimental setting")}
          />

          {showWorktreeRunExecution ? (
            <Card className="block bg-transparent p-5">
              <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">{translateInstant("instanceExperimentalSettings.worktreeRunExecutionTitle")}</h3>
                      {worktreeRunExecutionManaged ? <ManagedByCloudBadge /> : null}
                    </div>
                    <p className="max-w-2xl text-sm text-muted-foreground">
                      {translateInstant("instanceExperimentalSettings.previewExecutionHint")}</p>
                  </div>
                  <ToggleSwitch
                    checked={enableWorktreeRunExecution}
                    onCheckedChange={(checked) => {
                      if (worktreeRunExecutionManaged) return;
                      toggleMutation.mutate({ enableWorktreeRunExecution: checked });
                    }}
                    disabled={toggleMutation.isPending || worktreeRunExecutionManaged}
                    aria-label={translateInstant("instanceExperimentalSettings.worktreeRunExecutionToggle")}
                  />
                </div>

                {worktreeRunExecutionState.kind === "armed" ? (
                  <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-foreground">
                    <Play className="h-4 w-4 shrink-0 text-emerald-600" />
                    <span>
                      {translateInstant("instanceExperimentalSettings.runningAfter")}{" "}
                      <span className="font-medium">
                        {formatActivationTimestamp(worktreeRunExecutionState.activatedAt)}
                      </span>
                      {translateInstant(".")}</span>
                  </div>
                ) : null}

                {worktreeRunExecutionState.kind === "fail_closed" ? (
                  <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                    <div className="space-y-0.5">
                      <p className="font-medium text-foreground">{translateInstant("instanceExperimentalSettings.executionSuppressed")}</p>
                      <p className="text-muted-foreground">
                        {worktreeRunExecutionState.reason === "instance_mismatch"
                          ? translateInstant("instanceExperimentalSettings.worktreeRunExecutionInstanceMismatch")
                          : translateInstant("instanceExperimentalSettings.worktreeRunExecutionMissingCutoff")}{" "}
                        {translateInstant("instanceExperimentalSettings.worktreeRunExecutionRearm")}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}

          <ExperimentalToggleCard
            title={translateInstant("instanceExperimentalSettings.serverInfoDebugViewTitle")}
            description={translateInstant("instanceExperimentalSettings.serverInfoDebugViewDescription")}
            checked={enableServerInfoDebugView}
            onCheckedChange={(checked) =>
              toggleMutation.mutate({ enableServerInfoDebugView: checked })
            }
            disabled={toggleMutation.isPending}
            settingKey="enableServerInfoDebugView"
            managed={managedKeys.enableServerInfoDebugView}
            ariaLabel={translateInstant("instanceExperimentalSettings.serverInfoDebugViewToggle")}
          />

          <ExperimentalToggleCard
            title={translateInstant("instanceExperimentalSettings.smokeLabTitle")}
            description={translateInstant("instanceExperimentalSettings.smokeLabDescription")}
            checked={enableSmokeLab}
            onCheckedChange={(checked) => toggleMutation.mutate({ enableSmokeLab: checked })}
            disabled={toggleMutation.isPending}
            settingKey="enableSmokeLab"
            managed={managedKeys.enableSmokeLab}
            ariaLabel={translateInstant("instanceExperimentalSettings.smokeLabToggle")}
          />

          <ExperimentalToggleCard
            title={translateInstant("Task Plan Decomposition")}
            description={translateInstant("instanceExperimentalSettings.planDecompositionDescription")}
            checked={enableIssuePlanDecompositions}
            onCheckedChange={(checked) =>
              toggleMutation.mutate({ enableIssuePlanDecompositions: checked })
            }
            disabled={toggleMutation.isPending}
            settingKey="enableIssuePlanDecompositions"
            managed={managedKeys.enableIssuePlanDecompositions}
            ariaLabel={translateInstant("instanceExperimentalSettings.planDecompositionToggle")}
          />
        </section>
      ) : null}

      {showLegacySection ? (
        <section className="space-y-3" aria-labelledby="legacy-heading">
          <div className="space-y-1">
            <h2 id="legacy-heading" className="text-sm font-semibold">
              {translateInstant("Legacy")}</h2>
            <p className="text-sm text-muted-foreground">{translateInstant("These features are going to be removed.")}</p>
          </div>

          <ExperimentalToggleCard
            title={translateInstant("instanceExperimentalSettings.classicTaskInterfaceTitle")}
            description={translateInstant("Restores the previous task detail page: the page-level header with inline description editing, the plain comment thread, and the fixed Properties sidebar. Chat-only features — streaming activity folding, inline plan and question cards, the three-mode composer — are unavailable in the classic view.")}
            footnote={translateInstant("instanceExperimentalSettings.classicTaskInterfaceFootnote")}
            checked={enableClassicTaskInterface}
            onCheckedChange={(checked) =>
              toggleMutation.mutate({ enableClassicTaskInterface: checked })
            }
            disabled={toggleMutation.isPending}
            settingKey="enableClassicTaskInterface"
            managed={managedKeys.enableClassicTaskInterface}
            ariaLabel={translateInstant("instanceExperimentalSettings.classicTaskInterfaceToggle")}
          />

          <ExperimentalToggleCard
            title={translateInstant("instanceExperimentalSettings.goalsSidebarLinkTitle")}
            description={translateInstant("instanceExperimentalSettings.goalsSidebarLinkDescription")}
            checked={enableGoalsSidebarLink}
            onCheckedChange={(checked) =>
              toggleMutation.mutate({ enableGoalsSidebarLink: checked })
            }
            disabled={toggleMutation.isPending}
            settingKey="enableGoalsSidebarLink"
            managed={managedKeys.enableGoalsSidebarLink}
            ariaLabel={translateInstant("instanceExperimentalSettings.goalsSidebarLinkToggle")}
          />
        </section>
      ) : null}
    </div>
  );
}

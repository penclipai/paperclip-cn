import { KeyRound, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CompanySecret, RoutineEnvConfig } from "@penclipai/shared";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./EmptyState";
import { EnvironmentVariablesEditor } from "./environment-variables-editor";
import { AgentAvatar, type AvatarAgent } from "./AgentAvatar";

export interface StageSecretsPanelProps {
  /** Whether the stage has a backing automation routine with an assignee. */
  hasAutomation: boolean;
  /** Display name + icon of the agent that runs this step (when automation exists). */
  agentName?: string | null;
  agentIcon?: string | null;
  agent?: AvatarAgent;
  /** Company secret inventory (shared, not stage-scoped). */
  secrets: CompanySecret[];
  secretsLoading: boolean;
  value: RoutineEnvConfig;
  onChange: (env: RoutineEnvConfig) => void;
  onCreateSecret: (name: string, value: string) => Promise<CompanySecret>;
  /** Jump to the Automation section so the user can pick an agent. */
  onSetupAutomation: () => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
}

/**
 * Stage Secrets tab body. Stage secrets are env bindings on the step's backing
 * automation routine — the same company-secret backbone used by routines,
 * agents, and projects. This panel is intentionally dense and reuses
 * `EnvironmentVariablesEditor` for secret refs, inline secret creation, version
 * selection, and missing/disabled-secret warnings.
 */
export function StageSecretsPanel({
  hasAutomation,
  agentName,
  agentIcon,
  agent,
  secrets,
  secretsLoading,
  value,
  onChange,
  onCreateSecret,
  onSetupAutomation,
  onSave,
  saving,
  dirty,
}: StageSecretsPanelProps) {
  const { t } = useTranslation(undefined, { useSuspense: false });
  // No backing automation/assignee → nothing can receive secrets at runtime.
  // Point the user at Automation instead of creating a hidden routine just
  // because the Secrets tab was opened.
  if (!hasAutomation) {
    return (
      <EmptyState
        icon={KeyRound}
        message={t("stageSecrets.requiresAutomation", { defaultValue: "Secrets are available only to step automation. Pick an agent to run this step, then add the secrets it needs." })}
        action={t("stageSecrets.setUpAutomation", { defaultValue: "Set up automation" })}
        onAction={onSetupAutomation}
      />
    );
  }

  const displayName = agentName?.trim() || t("stageSecrets.assignedAgentFallback", { defaultValue: "the responsible agent" });

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        {agentName ? (
          <AgentAvatar agent={agent} name={displayName} size={16} />
        ) : (
          <KeyRound className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        )}
        <p>
          {t("stageSecrets.injectedPrefix", { defaultValue: "These env vars are injected when" })}{" "}
          <span className="font-medium text-foreground">{displayName}</span>{" "}
          {" "}{t("stageSecrets.injectedSuffix", { defaultValue: "runs this step. They override matching project and agent env on collisions." })}{" "}
          <span className="font-mono">PAPERCLIP_*</span>{" "}
          {" "}{t("stageSecrets.reservedSuffix", { defaultValue: "names are reserved." })}
        </p>
      </div>

      {secretsLoading ? (
        <p className="text-sm text-muted-foreground">{t("stageSecrets.loadingSecrets", { defaultValue: "Loading secrets..." })}</p>
      ) : (
        <EnvironmentVariablesEditor
          value={value}
          secrets={secrets}
          onCreateSecret={onCreateSecret}
          onChange={(env) => onChange((env ?? {}) as RoutineEnvConfig)}
        />
      )}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={onSave} disabled={!dirty || saving}>
          <Save className="h-4 w-4 mr-1.5" />
          {saving
            ? t("common.saving", { defaultValue: "Saving..." })
            : t("stageSecrets.saveSecrets", { defaultValue: "Save secrets" })}
        </Button>
        {dirty && !saving ? <span className="text-xs text-muted-foreground">{t("common.unsavedChanges", { defaultValue: "Unsaved changes" })}</span> : null}
      </div>
    </div>
  );
}

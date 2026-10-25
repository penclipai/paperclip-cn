import { ShieldCheck, ShieldX, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

export interface ProjectAccessNoticeProps {
  agentName?: string;
  projectName?: string;
  ready: boolean;
  canManage: boolean;
  canRetry: boolean;
  onManage: () => void;
  onRetry: () => void;
  error?: Error | null;
  className?: string;
}

export function ProjectAccessNotice({ agentName, projectName, ready, canManage, canRetry, onManage, onRetry, error, className }: ProjectAccessNoticeProps) {
  const { t } = useTranslation();
  const resolvedAgentName = agentName ?? t("projectAccess.defaultAgentName", { defaultValue: "This agent" });
  return <section role={ready ? "status" : "alert"} aria-label={t("projectAccess.ariaLabel", { defaultValue: "Project access" })} className={cn("space-y-4 rounded-lg border border-border p-4", className)}>
    <div className="flex items-start gap-3">
      {ready ? <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden /> : <ShieldX className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />}
      <div className="min-w-0 space-y-2">
        <h3 className="text-sm font-semibold">{ready ? t("projectAccess.readyTitle", { defaultValue: "Project access is ready" }) : t("projectAccess.blockedTitle", { agentName: resolvedAgentName, defaultValue: "{{agentName}} can’t access this project" })}</h3>
        <p className="text-sm text-muted-foreground">{ready
          ? t("projectAccess.readyDescription", { defaultValue: "The agent can now access the required project. Retry to continue with your saved message." })
          : t("projectAccess.blockedDescription", { projectName: projectName ?? t("projectAccess.aProject", { defaultValue: "a project" }), defaultValue: "This task needs {{projectName}} outside the agent’s allowed projects. The agent hasn’t started. Your message is saved." })}</p>
        {!ready && !canManage && <p className="text-sm text-muted-foreground">{t("projectAccess.noManageDescription", { defaultValue: "A person with agent-management permission can add this project in the agent’s Permissions / Trust settings." })}</p>}
      </div>
    </div>
    <div className="flex flex-wrap gap-2 pl-8">
      {ready ? canRetry && <Button size="sm" onClick={onRetry}>{t("projectAccess.retryTask", { defaultValue: "Retry task" })}<ArrowRight className="size-4" aria-hidden /></Button>
        : <Button size="sm" variant="outline" onClick={onManage}>{canManage ? t("projectAccess.manage", { defaultValue: "Manage project access" }) : t("projectAccess.view", { defaultValue: "View agent access" })}<ArrowRight className="size-4" aria-hidden /></Button>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
    {!ready && <details className="pl-8 text-xs text-muted-foreground"><summary className="cursor-pointer">{t("projectAccess.runDetails", { defaultValue: "Run details" })}</summary>
      <dl className="mt-3 grid grid-cols-2 gap-2"><dt>{t("projectAccess.stoppedDuring", { defaultValue: "Stopped during" })}</dt><dd>{t("projectAccess.workspaceSetup", { defaultValue: "Workspace setup" })}</dd><dt>{t("projectAccess.reason", { defaultValue: "Reason" })}</dt><dd>{t("projectAccess.outsideAllowedScope", { defaultValue: "Project outside allowed scope" })}</dd><dt>{t("projectAccess.providerStarted", { defaultValue: "Provider started" })}</dt><dd>{t("projectAccess.no", { defaultValue: "No" })}</dd></dl>
    </details>}
  </section>;
}

import { auditSectionHref, type AuditSection } from "./audit/audit-navigation";

export type AgentDetailView =
  | "overview"
  | "instructions"
  | "skills"
  | "runtime"
  | "secrets"
  | "tools"
  | "channels"
  | "permissions"
  | "api-keys"
  | "revisions"
  | "run-detail";

export type AgentLocalDetailView = Exclude<AgentDetailView, "run-detail">;

export const AGENT_DETAIL_NAVIGATION: ReadonlyArray<{
  labelKey: string;
  items: ReadonlyArray<{ value: AgentLocalDetailView; labelKey: string }>;
}> = [
  {
    labelKey: "entityType.agent",
    items: [
      { value: "overview", labelKey: "caseDetail.tabs.overview" },
      { value: "instructions", labelKey: "agentDetail.instructions" },
      { value: "skills", labelKey: "agentDetail.skills" },
    ],
  },
  {
    labelKey: "agentDetail.runtime",
    items: [
      { value: "runtime", labelKey: "agentDetail.harnessRuntime" },
      { value: "secrets", labelKey: "agentDetail.secretsAndVariables" },
      { value: "tools", labelKey: "agentDetail.tools" },
      { value: "channels", labelKey: "agentDetail.channels" },
    ],
  },
  {
    labelKey: "agentDetail.governance",
    items: [
      { value: "permissions", labelKey: "agentDetail.permissionsTrust" },
      { value: "api-keys", labelKey: "agentDetail.apiKeys" },
      { value: "revisions", labelKey: "caseComponents.revisions.title" },
    ],
  },
] as const;

export function parseAgentDetailView(value: string | null): AgentLocalDetailView {
  if (value === "instructions" || value === "prompts") return "instructions";
  if (value === "skills") return "skills";
  if (value === "runtime" || value === "configure" || value === "configuration") return "runtime";
  if (value === "secrets") return "secrets";
  if (value === "tools") return "tools";
  if (value === "channels") return "channels";
  if (value === "permissions" || value === "trust") return "permissions";
  if (value === "api-keys" || value === "keys") return "api-keys";
  if (value === "revisions" || value === "history") return "revisions";
  return "overview";
}

export function agentDetailHref(agentRef: string, view: AgentLocalDetailView = "overview") {
  return `/agents/${agentRef}/${view}`;
}

export function agentLegacyAuditSection(value: string | null): AuditSection | null {
  if (value === "runs") return "runs";
  if (value === "audit" || value === "activity") return "activity";
  if (value === "cost" || value === "costs") return "costs";
  if (value === "budget" || value === "budgets") return "budgets";
  return null;
}

export function agentScopedAuditHref(agentId: string, section: AuditSection) {
  return auditSectionHref(section, {
    mode: section === "activity" ? "agents" : undefined,
    agentId,
  });
}

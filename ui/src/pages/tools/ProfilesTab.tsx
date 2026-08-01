import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Layers, Plus, Pencil, Trash2, Link2, ShieldCheck } from "lucide-react";
import type {
  ToolCatalogEntry,
  ToolProfileBinding,
  ToolProfileBindingTargetType,
  ToolProfileDefaultAction,
  ToolProfileEntry,
  ToolProfileEntryEffect,
  ToolProfileEntrySelectorType,
  ToolProfileStatus,
  ToolProfileWithDetails,
  ToolRiskLevel,
} from "@penclipai/shared";
import { agentsApi } from "@/api/agents";
import { projectsApi } from "@/api/projects";
import { routinesApi } from "@/api/routines";
import {
  toolsApi,
  type CreateToolProfileInput,
  type ToolProfileBindingInput,
  type ToolProfileEntryInput,
  type UpdateToolProfileInput,
} from "@/api/tools";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/context/ToastContext";
import { EmptyState } from "@/components/EmptyState";
import {
  CapabilityBadges,
  ErrorState,
  LoadingState,
  RelativeTime,
  RiskBadge,
  ToolsPageHeader,
} from "./shared";
import { translateInstant } from "@/i18n";

const SELECTOR_TYPES: Array<{ value: ToolProfileEntrySelectorType; labelKey: string; defaultLabel: string }> = [
  { value: "tool_name", labelKey: "tools.profiles.selector.toolName", defaultLabel: "Tool name" },
  { value: "risk_level", labelKey: "tools.profiles.selector.riskLevel", defaultLabel: "Risk level" },
  { value: "application", labelKey: "tools.profiles.selector.application", defaultLabel: "Application" },
  { value: "connection", labelKey: "tools.profiles.selector.connection", defaultLabel: "Connection" },
  { value: "catalog_entry", labelKey: "tools.profiles.selector.catalogEntryId", defaultLabel: "Catalog entry ID" },
];

const TARGET_TYPES: Array<{ value: ToolProfileBindingTargetType; labelKey: string; defaultLabel: string }> = [
  { value: "company", labelKey: "tools.common.company", defaultLabel: "Company" },
  { value: "agent", labelKey: "tools.common.agent", defaultLabel: "Agent" },
  { value: "project", labelKey: "tools.common.project", defaultLabel: "Project" },
  { value: "routine", labelKey: "tools.common.routine", defaultLabel: "Routine" },
  { value: "issue", labelKey: "tools.common.issueId", defaultLabel: "Issue ID" },
];

const RISK_LEVELS: ToolRiskLevel[] = ["read", "write", "destructive", "low", "medium", "high", "critical"];

function slugifyProfileKey(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

function statusVariant(status: ToolProfileStatus): "default" | "secondary" | "outline" | "destructive" {
  if (status === "active") return "default";
  if (status === "archived") return "outline";
  return "secondary";
}

function targetIdForType(input: {
  companyId: string;
  targetType: ToolProfileBindingTargetType;
  agentId: string;
  projectId: string;
  routineId: string;
  issueId: string;
}) {
  if (input.targetType === "company") return input.companyId;
  if (input.targetType === "agent") return input.agentId;
  if (input.targetType === "project") return input.projectId;
  if (input.targetType === "routine") return input.routineId;
  return input.issueId.trim();
}

function buildEntryInput(input: {
  selectorType: ToolProfileEntrySelectorType;
  effect: ToolProfileEntryEffect;
  applicationId: string;
  connectionId: string;
  catalogEntryId: string;
  toolName: string;
  riskLevel: ToolRiskLevel;
}): ToolProfileEntryInput | null {
  const base = { selectorType: input.selectorType, effect: input.effect };
  if (input.selectorType === "application") {
    return input.applicationId ? { ...base, applicationId: input.applicationId } : null;
  }
  if (input.selectorType === "connection") {
    return input.connectionId ? { ...base, connectionId: input.connectionId } : null;
  }
  if (input.selectorType === "catalog_entry") {
    const catalogEntryId = input.catalogEntryId.trim();
    return catalogEntryId ? { ...base, catalogEntryId } : null;
  }
  if (input.selectorType === "tool_name") {
    const toolName = input.toolName.trim();
    return toolName ? { ...base, toolName } : null;
  }
  return { ...base, riskLevel: input.riskLevel };
}

function entryLabel(
  entry: ToolProfileEntry,
  applicationsById: Map<string, string>,
  connectionsById: Map<string, string>,
) {
  if (entry.selectorType === "application") return applicationsById.get(entry.applicationId ?? "") ?? entry.applicationId ?? translateInstant("tools.profiles.selector.applicationLower", { defaultValue: "application" });
  if (entry.selectorType === "connection") return connectionsById.get(entry.connectionId ?? "") ?? entry.connectionId ?? translateInstant("tools.profiles.selector.connectionLower", { defaultValue: "connection" });
  if (entry.selectorType === "catalog_entry") return entry.catalogEntryId ?? translateInstant("tools.profiles.selector.catalogEntryLower", { defaultValue: "catalog entry" });
  if (entry.selectorType === "risk_level") return entry.riskLevel ?? translateInstant("tools.profiles.selector.riskLevelLower", { defaultValue: "risk level" });
  return entry.toolName ?? translateInstant("tools.common.toolLower", { defaultValue: "tool" });
}

function bindingLabel(
  targetType: ToolProfileBindingTargetType,
  targetId: string,
  labels: {
    companyId: string;
    agentsById: Map<string, string>;
    projectsById: Map<string, string>;
    routinesById: Map<string, string>;
  },
) {
  if (targetType === "company") return targetId === labels.companyId ? translateInstant("tools.common.company", { defaultValue: "Company" }) : targetId;
  if (targetType === "agent") return labels.agentsById.get(targetId) ?? targetId;
  if (targetType === "project") return labels.projectsById.get(targetId) ?? targetId;
  if (targetType === "routine") return labels.routinesById.get(targetId) ?? targetId;
  return targetId;
}

/** Short, human subtitle for the master rail: prefers the agent count the spec calls for. */
function bindingsSubtitle(bindings: ToolProfileBinding[]): string {
  if (bindings.length === 0) return translateInstant("tools.profiles.unbound", { defaultValue: "unbound" });
  const agents = bindings.filter((b) => b.targetType === "agent").length;
  if (agents === bindings.length) {
    return translateInstant(agents === 1 ? "tools.profiles.boundToOneAgent" : "tools.profiles.boundToAgents", {
      defaultValue: agents === 1 ? "bound to 1 agent" : "bound to {{count}} agents",
      count: agents,
    });
  }
  return translateInstant(bindings.length === 1 ? "tools.profiles.oneBinding" : "tools.profiles.manyBindings", {
    defaultValue: bindings.length === 1 ? "1 binding" : "{{count}} bindings",
    count: bindings.length,
  });
}

// --- Allow-list resolution ------------------------------------------------
//
// The v2 Profiles surface resolves a profile's selector entries against the
// known tool catalog so reviewers see *concrete tools* and, crucially, *why*
// each one is allowed (the Source column). A pattern selector (wildcard tool
// name, application, connection, or risk level) is a foot-gun precisely
// because the tool it pulls in is invisible without this resolution.

export type AllowSource =
  | { kind: "explicit" }
  | { kind: "pattern"; label: string }
  | { kind: "default" };

export interface AllowListRow {
  key: string;
  toolName: string;
  applicationName: string | null;
  isReadOnly: boolean;
  isWrite: boolean;
  isDestructive: boolean;
  risk: ToolRiskLevel | null;
  source: AllowSource;
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function entryMatchesTool(entry: ToolProfileEntry, tool: ToolCatalogEntry): boolean {
  switch (entry.selectorType) {
    case "tool_name":
      if (!entry.toolName) return false;
      return entry.toolName.includes("*")
        ? wildcardToRegExp(entry.toolName).test(tool.toolName)
        : entry.toolName === tool.toolName;
    case "catalog_entry":
      return entry.catalogEntryId != null && entry.catalogEntryId === tool.id;
    case "application":
      return entry.applicationId != null && entry.applicationId === tool.applicationId;
    case "connection":
      return entry.connectionId != null && entry.connectionId === tool.connectionId;
    case "risk_level":
      return entry.riskLevel != null && entry.riskLevel === tool.riskLevel;
    default:
      return false;
  }
}

/** Higher = more specific. Explicit grants win over patterns when both match a tool. */
function entrySpecificity(entry: ToolProfileEntry): number {
  if (entry.selectorType === "catalog_entry") return 5;
  if (entry.selectorType === "tool_name") return entry.toolName?.includes("*") ? 3 : 4;
  if (entry.selectorType === "application" || entry.selectorType === "connection") return 2;
  return 1; // risk_level
}

function sourceFromEntry(
  entry: ToolProfileEntry,
  applicationsById: Map<string, string>,
  connectionsById: Map<string, string>,
): AllowSource {
  if (entry.selectorType === "catalog_entry") return { kind: "explicit" };
  if (entry.selectorType === "tool_name") {
    return entry.toolName?.includes("*")
      ? { kind: "pattern", label: entry.toolName }
      : { kind: "explicit" };
  }
  if (entry.selectorType === "application") {
    return { kind: "pattern", label: `app:${applicationsById.get(entry.applicationId ?? "") ?? entry.applicationId ?? "?"}` };
  }
  if (entry.selectorType === "connection") {
    return { kind: "pattern", label: `conn:${connectionsById.get(entry.connectionId ?? "") ?? entry.connectionId ?? "?"}` };
  }
  return { kind: "pattern", label: `risk:${entry.riskLevel ?? "?"}` };
}

export function resolveAllowList(
  profile: ToolProfileWithDetails,
  catalog: ToolCatalogEntry[],
  applicationsById: Map<string, string>,
  connectionsById: Map<string, string>,
): AllowListRow[] {
  const includes = profile.entries.filter((e) => e.effect === "include");
  const excludes = profile.entries.filter((e) => e.effect === "exclude");
  const rows: AllowListRow[] = [];

  for (const tool of catalog) {
    if (excludes.some((e) => entryMatchesTool(e, tool))) continue;
    const matchingIncludes = includes.filter((e) => entryMatchesTool(e, tool));
    let source: AllowSource;
    if (matchingIncludes.length > 0) {
      const best = matchingIncludes.reduce((a, b) =>
        entrySpecificity(b) > entrySpecificity(a) ? b : a,
      );
      source = sourceFromEntry(best, applicationsById, connectionsById);
    } else if (profile.defaultAction === "allow") {
      source = { kind: "default" };
    } else {
      continue;
    }
    rows.push({
      key: tool.id,
      toolName: tool.toolName,
      applicationName: applicationsById.get(tool.applicationId ?? "") ?? null,
      isReadOnly: tool.isReadOnly,
      isWrite: tool.isWrite,
      isDestructive: tool.isDestructive,
      risk: tool.riskLevel,
      source,
    });
  }

  // Surface explicit grants that don't resolve to a known catalog tool yet
  // (stale/empty catalog) so they aren't silently dropped from the allow list.
  const resolvedNames = new Set(rows.map((r) => r.toolName));
  for (const entry of includes) {
    if (entry.selectorType !== "tool_name" || !entry.toolName || entry.toolName.includes("*")) continue;
    if (resolvedNames.has(entry.toolName)) continue;
    if (excludes.some((e) => e.selectorType === "tool_name" && e.toolName === entry.toolName)) continue;
    rows.push({
      key: `entry-${entry.id}`,
      toolName: entry.toolName,
      applicationName: null,
      isReadOnly: false,
      isWrite: false,
      isDestructive: false,
      risk: null,
      source: { kind: "explicit" },
    });
    resolvedNames.add(entry.toolName);
  }

  return rows.sort((a, b) => a.toolName.localeCompare(b.toolName));
}

function useLookupData(companyId: string) {
  const agents = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
  });
  const projects = useQuery({
    queryKey: queryKeys.projects.list(companyId, { includeArchived: true }),
    queryFn: () => projectsApi.list(companyId, { includeArchived: true }),
  });
  const routines = useQuery({
    queryKey: queryKeys.routines.list(companyId),
    queryFn: () => routinesApi.list(companyId),
  });
  const applications = useQuery({
    queryKey: queryKeys.tools.applications(companyId),
    queryFn: () => toolsApi.listApplications(companyId),
  });
  const connections = useQuery({
    queryKey: queryKeys.tools.connections(companyId),
    queryFn: () => toolsApi.listConnections(companyId),
  });

  const maps = useMemo(() => ({
    agentsById: new Map((agents.data ?? []).map((agent) => [agent.id, agent.name])),
    projectsById: new Map((projects.data ?? []).map((project) => [project.id, project.name])),
    routinesById: new Map((routines.data ?? []).map((routine) => [routine.id, routine.title])),
    applicationsById: new Map((applications.data?.applications ?? []).map((app) => [app.id, app.name])),
    connectionsById: new Map((connections.data?.connections ?? []).map((conn) => [conn.id, conn.name])),
  }), [agents.data, applications.data, connections.data, projects.data, routines.data]);

  return { agents, projects, routines, applications, connections, maps };
}

function EntryFields({
  selectorType,
  setSelectorType,
  effect,
  setEffect,
  applicationId,
  setApplicationId,
  connectionId,
  setConnectionId,
  catalogEntryId,
  setCatalogEntryId,
  toolName,
  setToolName,
  riskLevel,
  setRiskLevel,
  applications,
  connections,
}: {
  selectorType: ToolProfileEntrySelectorType;
  setSelectorType: (value: ToolProfileEntrySelectorType) => void;
  effect: ToolProfileEntryEffect;
  setEffect: (value: ToolProfileEntryEffect) => void;
  applicationId: string;
  setApplicationId: (value: string) => void;
  connectionId: string;
  setConnectionId: (value: string) => void;
  catalogEntryId: string;
  setCatalogEntryId: (value: string) => void;
  toolName: string;
  setToolName: (value: string) => void;
  riskLevel: ToolRiskLevel;
  setRiskLevel: (value: ToolRiskLevel) => void;
  applications: Array<{ id: string; name: string }>;
  connections: Array<{ id: string; name: string }>;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-(--gtc-60)">
      <div className="space-y-1.5">
        <Label>{t("tools.profiles.selector.label", { defaultValue: "Selector" })}</Label>
        <Select value={selectorType} onValueChange={(value) => setSelectorType(value as ToolProfileEntrySelectorType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SELECTOR_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {t(type.labelKey, { defaultValue: type.defaultLabel })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>{t("tools.profiles.effect.label", { defaultValue: "Effect" })}</Label>
        <Select value={effect} onValueChange={(value) => setEffect(value as ToolProfileEntryEffect)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="include">{t("tools.profiles.effect.include", { defaultValue: "Include" })}</SelectItem>
            <SelectItem value="exclude">{t("tools.profiles.effect.exclude", { defaultValue: "Exclude" })}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {selectorType === "application" ? (
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{t("tools.profiles.selector.application", { defaultValue: "Application" })}</Label>
          <Select value={applicationId} onValueChange={setApplicationId}>
            <SelectTrigger>
              <SelectValue placeholder={t("tools.profiles.selectApplication", { defaultValue: "Select an application" })} />
            </SelectTrigger>
            <SelectContent>
              {applications.map((app) => (
                <SelectItem key={app.id} value={app.id}>
                  {app.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {selectorType === "connection" ? (
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{t("tools.profiles.selector.connection", { defaultValue: "Connection" })}</Label>
          <Select value={connectionId} onValueChange={setConnectionId}>
            <SelectTrigger>
              <SelectValue placeholder={t("tools.profiles.selectConnection", { defaultValue: "Select a connection" })} />
            </SelectTrigger>
            <SelectContent>
              {connections.map((conn) => (
                <SelectItem key={conn.id} value={conn.id}>
                  {conn.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {selectorType === "catalog_entry" ? (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="catalog-entry-id">{t("tools.profiles.selector.catalogEntryId", { defaultValue: "Catalog entry ID" })}</Label>
          <Input id="catalog-entry-id" value={catalogEntryId} onChange={(event) => setCatalogEntryId(event.target.value)} />
        </div>
      ) : null}
      {selectorType === "tool_name" ? (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="tool-name">{t("tools.profiles.selector.toolName", { defaultValue: "Tool name" })}</Label>
          <Input id="tool-name" value={toolName} onChange={(event) => setToolName(event.target.value)} placeholder="e.g. send_email or slack.list_*" />
        </div>
      ) : null}
      {selectorType === "risk_level" ? (
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{t("tools.profiles.selector.riskLevel", { defaultValue: "Risk level" })}</Label>
          <Select value={riskLevel} onValueChange={(value) => setRiskLevel(value as ToolRiskLevel)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RISK_LEVELS.map((risk) => (
                <SelectItem key={risk} value={risk}>
                  {t(`tools.shared.risk.${risk}`, { defaultValue: risk })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}

export function EffectiveAgentPanel({ companyId, agentOptions }: { companyId: string; agentOptions: Array<{ id: string; name: string }> }) {
  const { t } = useTranslation();
  const [agentId, setAgentId] = useState("");
  const effective = useQuery({
    queryKey: agentId
      ? queryKeys.tools.effectiveProfilesForAgent(companyId, agentId)
      : ["tools", companyId, "profiles", "effective", "agent", "__none__"],
    queryFn: () => toolsApi.getEffectiveProfilesForAgent(companyId, agentId),
    enabled: Boolean(agentId),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="space-y-1.5">
        <Label>{t("tools.common.agent", { defaultValue: "Agent" })}</Label>
        <Select value={agentId} onValueChange={setAgentId}>
          <SelectTrigger>
            <SelectValue placeholder={t("tools.profiles.selectAgent", { defaultValue: "Select an agent" })} />
          </SelectTrigger>
          <SelectContent>
            {agentOptions.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {!agentId ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
          {t("tools.profiles.effective.pickAgent", { defaultValue: "Pick an agent to see what it can use right now." })}
        </div>
      ) : effective.isLoading ? (
        <LoadingState label={t("tools.profiles.effective.checking", { defaultValue: "Checking access..." })} />
      ) : effective.error ? (
        <ErrorState error={effective.error} onRetry={() => effective.refetch()} />
      ) : (
        <div className="min-h-0 space-y-5 overflow-y-auto pr-1">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">{t("tools.profiles.effective.canUse", { defaultValue: "Can use" })}</h3>
              <span className="text-xs text-muted-foreground tabular-nums">
                {t("tools.profiles.effective.toolCount", { defaultValue: "{{count}} tools", count: (effective.data?.allowedToolNames ?? []).length })}
              </span>
            </div>
            {(effective.data?.allowedToolNames ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                {t("tools.profiles.effective.noTools", { defaultValue: "This agent cannot use any app tools right now." })}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(effective.data?.allowedToolNames ?? []).slice(0, 80).map((tool) => (
                  <Badge key={tool} variant="outline">{tool}</Badge>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">{t("tools.profiles.title", { defaultValue: "Access profiles" })}</h3>
            {(effective.data?.profiles ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                {t("tools.profiles.effective.noProfile", { defaultValue: "No active profile applies to this agent." })}
              </div>
            ) : (
              <div className="divide-y divide-border rounded-lg border border-border">
                {(effective.data?.profiles ?? []).map((profile) => (
                  <div key={profile.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">{profile.name}</span>
                    {profile.summary.isCompanyDefault ? (
                      <Badge variant="secondary">{t("tools.profiles.effective.companyDefault", { defaultValue: "Company default" })}</Badge>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The Source column — the key v2 addition. Patterns are flagged as a foot-gun. */
function SourceBadge({ source }: { source: AllowSource }) {
  const { t } = useTranslation();
  if (source.kind === "explicit") {
    return <Badge variant="secondary">{t("tools.profiles.source.explicit", { defaultValue: "explicit" })}</Badge>;
  }
  if (source.kind === "default") {
    return <Badge variant="outline">{t("tools.profiles.source.defaultAllow", { defaultValue: "default allow" })}</Badge>;
  }
  return (
    <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400">
      <AlertTriangle className="h-3 w-3" />
      <span className="font-mono text-(length:--text-micro)">{t("tools.profiles.source.pattern", { defaultValue: "pattern {{pattern}}", pattern: source.label })}</span>
    </Badge>
  );
}

function AllowList({ rows, catalogLoading }: { rows: AllowListRow[]; catalogLoading: boolean }) {
  const { t } = useTranslation();
  const patternCount = rows.filter((r) => r.source.kind === "pattern").length;
  const explicitCount = rows.filter((r) => r.source.kind === "explicit").length;
  const defaultCount = rows.filter((r) => r.source.kind === "default").length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">{t("tools.profiles.allowList.title", { defaultValue: "Allow list" })}</h4>
        <p className="text-xs text-muted-foreground">
          {t("tools.profiles.allowList.toolCount", { defaultValue: "{{count}} tools", count: rows.length })}
          {explicitCount > 0 ? t("tools.profiles.allowList.explicitCount", { defaultValue: " · {{count}} explicit", count: explicitCount }) : ""}
          {patternCount > 0 ? t("tools.profiles.allowList.patternCount", { defaultValue: " · {{count}} via pattern", count: patternCount }) : ""}
          {defaultCount > 0 ? t("tools.profiles.allowList.defaultCount", { defaultValue: " · {{count}} via default", count: defaultCount }) : ""}
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          {catalogLoading
            ? t("tools.profiles.allowList.resolving", { defaultValue: "Resolving allowed tools…" })
            : t("tools.profiles.allowList.legacyEmpty", { defaultValue: "No tools resolved for this profile. Add an include selector or refresh the tool catalog." })}
        </div>
      ) : (
        <Card>
          <CardContent className="px-0 py-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">{t("tools.common.tool", { defaultValue: "Tool" })}</th>
                  <th className="px-3 py-2.5 font-medium">{t("tools.profiles.selector.application", { defaultValue: "Application" })}</th>
                  <th className="px-3 py-2.5 font-medium">{t("tools.profiles.allowList.capabilities", { defaultValue: "Capabilities" })}</th>
                  <th className="px-3 py-2.5 font-medium">{t("tools.profiles.allowList.risk", { defaultValue: "Risk" })}</th>
                  <th className="px-3 py-2.5 font-medium">{t("tools.profiles.allowList.source", { defaultValue: "Source" })}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.key} className="align-top">
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-xs text-foreground">{row.toolName}</span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {row.applicationName ?? <span className="text-muted-foreground/60">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {row.isReadOnly || row.isWrite || row.isDestructive ? (
                        <CapabilityBadges
                          isReadOnly={row.isReadOnly}
                          isWrite={row.isWrite}
                          isDestructive={row.isDestructive}
                        />
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {row.risk ? <RiskBadge risk={row.risk} /> : <span className="text-muted-foreground/60">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <SourceBadge source={row.source} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {patternCount > 0 ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
          {t("tools.profiles.allowList.patternWarning", {
            defaultValue: "Tools marked pattern were pulled in by a wildcard, application, connection, or risk selector rather than named explicitly — review them when the catalog changes.",
          })}
        </p>
      ) : null}
    </div>
  );
}

export function ProfilesTab({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { pushToast } = useToast();
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [editProfile, setEditProfile] = useState<ToolProfileWithDetails | null>(null);
  const [entryProfile, setEntryProfile] = useState<ToolProfileWithDetails | null>(null);
  const [bindProfileFor, setBindProfileFor] = useState<ToolProfileWithDetails | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [profileKey, setProfileKey] = useState("");
  const [description, setDescription] = useState("");
  const [defaultAction, setDefaultAction] = useState<ToolProfileDefaultAction>("deny");
  const [status, setStatus] = useState<ToolProfileStatus>("active");

  const [selectorType, setSelectorType] = useState<ToolProfileEntrySelectorType>("tool_name");
  const [effect, setEffect] = useState<ToolProfileEntryEffect>("include");
  const [applicationId, setApplicationId] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [catalogEntryId, setCatalogEntryId] = useState("");
  const [toolName, setToolName] = useState("");
  const [riskLevel, setRiskLevel] = useState<ToolRiskLevel>("read");

  const [targetType, setTargetType] = useState<ToolProfileBindingTargetType>("agent");
  const [targetAgentId, setTargetAgentId] = useState("");
  const [targetProjectId, setTargetProjectId] = useState("");
  const [targetRoutineId, setTargetRoutineId] = useState("");
  const [targetIssueId, setTargetIssueId] = useState("");
  const [priority, setPriority] = useState("100");

  const lookups = useLookupData(companyId);
  const profiles = useQuery({
    queryKey: queryKeys.tools.profiles(companyId),
    queryFn: () => toolsApi.listProfiles(companyId),
  });

  const connectionList = lookups.connections.data?.connections ?? [];
  // Company-wide catalog, assembled per connection (there is no aggregate
  // endpoint). It powers allow-list resolution: concrete tool + capabilities +
  // risk + which selector pulled it in.
  const catalogQueries = useQueries({
    queries: connectionList.map((c) => ({
      queryKey: queryKeys.tools.catalog(c.id),
      queryFn: () => toolsApi.listCatalog(c.id),
      staleTime: 60_000,
    })),
  });
  const catalog = useMemo(
    () => catalogQueries.flatMap((q) => q.data?.catalog ?? []),
    [catalogQueries],
  );
  const catalogLoading = catalogQueries.some((q) => q.isLoading);

  const applicationOptions = lookups.applications.data?.applications ?? [];
  const connectionOptions = lookups.connections.data?.connections ?? [];
  const agentOptions = lookups.agents.data ?? [];
  const projectOptions = (lookups.projects.data ?? []).filter((project) => !project.archivedAt);
  const routineOptions = lookups.routines.data ?? [];

  const invalidateProfiles = () => {
    qc.invalidateQueries({ queryKey: queryKeys.tools.profiles(companyId) });
    qc.invalidateQueries({ queryKey: ["tools", companyId, "profiles", "effective"] });
  };

  const resetProfileForm = () => {
    setName("");
    setProfileKey("");
    setDescription("");
    setDefaultAction("deny");
    setStatus("active");
  };

  const resetEntryForm = () => {
    setSelectorType("tool_name");
    setEffect("include");
    setApplicationId("");
    setConnectionId("");
    setCatalogEntryId("");
    setToolName("");
    setRiskLevel("read");
  };

  const createProfile = useMutation({
    mutationFn: (input: CreateToolProfileInput) => toolsApi.createProfile(companyId, input),
    onSuccess: (created) => {
      invalidateProfiles();
      setCreateOpen(false);
      setSelectedId(created.id);
      resetProfileForm();
      resetEntryForm();
      pushToast({ title: t("tools.profiles.toast.created", { defaultValue: "Profile created" }), tone: "success" });
    },
    onError: (error) => pushToast({
      title: t("tools.profiles.toast.createFailed", { defaultValue: "Could not create profile" }),
      body: error instanceof ApiError ? error.message : String(error),
      tone: "error",
    }),
  });

  const updateProfile = useMutation({
    mutationFn: ({ profileId, input }: { profileId: string; input: UpdateToolProfileInput }) =>
      toolsApi.updateProfile(profileId, input),
    onSuccess: () => {
      invalidateProfiles();
      setEditProfile(null);
      resetProfileForm();
      pushToast({ title: t("tools.profiles.toast.updated", { defaultValue: "Profile updated" }), tone: "success" });
    },
    onError: (error) => pushToast({
      title: t("tools.profiles.toast.updateFailed", { defaultValue: "Could not update profile" }),
      body: error instanceof ApiError ? error.message : String(error),
      tone: "error",
    }),
  });

  const addEntry = useMutation({
    mutationFn: ({ profileId, input }: { profileId: string; input: ToolProfileEntryInput }) =>
      toolsApi.addProfileEntry(profileId, input),
    onSuccess: () => {
      invalidateProfiles();
      setEntryProfile(null);
      resetEntryForm();
      pushToast({ title: t("tools.profiles.toast.entryAdded", { defaultValue: "Entry added" }), tone: "success" });
    },
    onError: (error) => pushToast({
      title: t("tools.profiles.toast.entryAddFailed", { defaultValue: "Could not add entry" }),
      body: error instanceof ApiError ? error.message : String(error),
      tone: "error",
    }),
  });

  const deleteEntry = useMutation({
    mutationFn: (entryId: string) => toolsApi.deleteProfileEntry(entryId),
    onSuccess: () => {
      invalidateProfiles();
      pushToast({ title: t("tools.profiles.toast.entryRemoved", { defaultValue: "Entry removed" }), tone: "success" });
    },
    onError: (error) => pushToast({
      title: t("tools.profiles.toast.entryRemoveFailed", { defaultValue: "Could not remove entry" }),
      body: error instanceof ApiError ? error.message : String(error),
      tone: "error",
    }),
  });

  const bind = useMutation({
    mutationFn: ({ profileId, input }: { profileId: string; input: ToolProfileBindingInput }) =>
      toolsApi.bindProfile(companyId, profileId, input),
    onSuccess: () => {
      invalidateProfiles();
      setBindProfileFor(null);
      setTargetType("agent");
      setPriority("100");
      pushToast({ title: t("tools.profiles.toast.bound", { defaultValue: "Profile bound" }), tone: "success" });
    },
    onError: (error) => pushToast({
      title: t("tools.profiles.toast.bindFailed", { defaultValue: "Could not bind profile" }),
      body: error instanceof ApiError ? error.message : String(error),
      tone: "error",
    }),
  });

  const unbind = useMutation({
    mutationFn: ({ profileId, targetType, targetId }: {
      profileId: string;
      targetType: ToolProfileBindingTargetType;
      targetId: string;
    }) => toolsApi.unbindProfile(companyId, profileId, { targetType, targetId }),
    onSuccess: () => {
      invalidateProfiles();
      pushToast({ title: t("tools.profiles.toast.bindingRemoved", { defaultValue: "Binding removed" }), tone: "success" });
    },
    onError: (error) => pushToast({
      title: t("tools.profiles.toast.bindingRemoveFailed", { defaultValue: "Could not remove binding" }),
      body: error instanceof ApiError ? error.message : String(error),
      tone: "error",
    }),
  });

  if (profiles.isLoading) return <LoadingState />;
  if (profiles.error) return <ErrorState error={profiles.error} onRetry={() => profiles.refetch()} />;

  const list = profiles.data?.profiles ?? [];
  const selected = list.find((p) => p.id === selectedId) ?? list[0] ?? null;

  const openEdit = (profile: ToolProfileWithDetails) => {
    setEditProfile(profile);
    setName(profile.name);
    setProfileKey(profile.profileKey);
    setDescription(profile.description ?? "");
    setDefaultAction(profile.defaultAction);
    setStatus(profile.status);
  };

  const saveProfile = () => {
    const key = profileKey.trim() || slugifyProfileKey(name);
    if (!name.trim() || !key) return;
    if (editProfile) {
      updateProfile.mutate({
        profileId: editProfile.id,
        input: {
          name: name.trim(),
          profileKey: key,
          description: description.trim() || null,
          defaultAction,
          status,
        },
      });
      return;
    }
    const entry = buildEntryInput({
      selectorType,
      effect,
      applicationId,
      connectionId,
      catalogEntryId,
      toolName,
      riskLevel,
    });
    createProfile.mutate({
      name: name.trim(),
      profileKey: key,
      description: description.trim() || null,
      defaultAction,
      status,
      entries: entry ? [entry] : [],
    });
  };

  const saveEntry = () => {
    if (!entryProfile) return;
    const entry = buildEntryInput({
      selectorType,
      effect,
      applicationId,
      connectionId,
      catalogEntryId,
      toolName,
      riskLevel,
    });
    if (!entry) {
      pushToast({ title: t("tools.profiles.toast.entryTargetRequired", { defaultValue: "Entry target required" }), tone: "error" });
      return;
    }
    addEntry.mutate({ profileId: entryProfile.id, input: entry });
  };

  const saveBinding = () => {
    if (!bindProfileFor) return;
    const targetId = targetIdForType({
      companyId,
      targetType,
      agentId: targetAgentId,
      projectId: targetProjectId,
      routineId: targetRoutineId,
      issueId: targetIssueId,
    });
    if (!targetId) {
      pushToast({ title: t("tools.profiles.toast.bindingTargetRequired", { defaultValue: "Binding target required" }), tone: "error" });
      return;
    }
    bind.mutate({
      profileId: bindProfileFor.id,
      input: {
        targetType,
        targetId,
        priority: Number(priority) || 100,
      },
    });
  };

  return (
    <div className="space-y-4">
      <ToolsPageHeader
        title={t("tools.profiles.title", { defaultValue: "Access profiles" })}
        description={t("tools.profiles.legacyDescription", {
          defaultValue: "Reusable bundles of allowed applications, connections, and tools, assignable to agents, projects, routines, or issues.",
        })}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t("tools.profiles.newProfile", { defaultValue: "New profile" })}
          </Button>
        }
      />

      <EffectiveAgentPanel companyId={companyId} agentOptions={agentOptions} />

      {list.length === 0 ? (
        <EmptyState
          icon={Layers}
          message={t("tools.profiles.emptyLegacy.title", { defaultValue: "No access profiles yet" })}
          description={t("tools.profiles.emptyLegacy.description", { defaultValue: "Create a profile to group tool selectors, then bind it to the company or a specific agent." })}
          action={t("tools.profiles.newProfile", { defaultValue: "New profile" })}
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-(--gtc-63)">
          {/* Master rail */}
          <Card className="h-fit">
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {list.map((profile) => {
                  const toolCount = resolveAllowList(
                    profile,
                    catalog,
                    lookups.maps.applicationsById,
                    lookups.maps.connectionsById,
                  ).length;
                  const isActive = selected?.id === profile.id;
                  return (
                    <li key={profile.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(profile.id)}
                        className={cn(
                          "flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-accent/50",
                          isActive && "bg-accent/70",
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium text-foreground">{profile.name}</span>
                          {profile.status !== "active" ? (
                            <Badge variant={statusVariant(profile.status)} className="text-(length:--text-nano)">
                              {t(`tools.profiles.status.${profile.status}`, { defaultValue: profile.status })}
                            </Badge>
                          ) : null}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t("tools.profiles.allowList.toolCount", { defaultValue: "{{count}} tools", count: toolCount })} · {bindingsSubtitle(profile.bindings)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          {/* Detail pane */}
          {selected ? (
            <ProfileDetail
              profile={selected}
              catalog={catalog}
              catalogLoading={catalogLoading}
              maps={lookups.maps}
              companyId={companyId}
              onEdit={() => openEdit(selected)}
              onAddEntry={() => {
                setEntryProfile(selected);
                resetEntryForm();
              }}
              onBind={() => setBindProfileFor(selected)}
              onDeleteEntry={(entryId) => deleteEntry.mutate(entryId)}
              onUnbind={(binding) =>
                unbind.mutate({
                  profileId: selected.id,
                  targetType: binding.targetType,
                  targetId: binding.targetId,
                })
              }
            />
          ) : null}
        </div>
      )}

      <Dialog open={createOpen || Boolean(editProfile)} onOpenChange={(open) => {
        if (!open) {
          setCreateOpen(false);
          setEditProfile(null);
          resetProfileForm();
          resetEntryForm();
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editProfile
              ? t("tools.profiles.dialog.editTitle", { defaultValue: "Edit profile" })
              : t("tools.profiles.newProfile", { defaultValue: "New profile" })}</DialogTitle>
            <DialogDescription>
              {t("tools.profiles.dialog.legacyDescription", { defaultValue: "Profile rules are enforced by the tool gateway policy service." })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="profile-name">{t("tools.common.name", { defaultValue: "Name" })}</Label>
                <Input
                  id="profile-name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (!editProfile && !profileKey.trim()) setProfileKey(slugifyProfileKey(event.target.value));
                  }}
                  placeholder={t("tools.profiles.dialog.namePlaceholder", { defaultValue: "Engineering write tools" })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-key">{t("tools.pasteConfig.key", { defaultValue: "Key" })}</Label>
                <Input id="profile-key" value={profileKey} onChange={(event) => setProfileKey(event.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-description">{t("tools.common.description", { defaultValue: "Description" })}</Label>
              <Textarea
                id="profile-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("tools.profiles.dialog.descriptionPlaceholder", { defaultValue: "Optional context for reviewers." })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("tools.profiles.dialog.defaultAction", { defaultValue: "Default action" })}</Label>
                <Select value={defaultAction} onValueChange={(value) => setDefaultAction(value as ToolProfileDefaultAction)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deny">{t("tools.profiles.dialog.denyUnlessIncluded", { defaultValue: "Deny unless included" })}</SelectItem>
                    <SelectItem value="allow">{t("tools.profiles.dialog.allowUnlessExcluded", { defaultValue: "Allow unless excluded" })}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("tools.common.status", { defaultValue: "Status" })}</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as ToolProfileStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t("tools.profiles.status.active", { defaultValue: "Active" })}</SelectItem>
                    <SelectItem value="disabled">{t("tools.profiles.status.disabled", { defaultValue: "Disabled" })}</SelectItem>
                    <SelectItem value="archived">{t("tools.profiles.status.archived", { defaultValue: "Archived" })}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {!editProfile ? (
              <EntryFields
                selectorType={selectorType}
                setSelectorType={setSelectorType}
                effect={effect}
                setEffect={setEffect}
                applicationId={applicationId}
                setApplicationId={setApplicationId}
                connectionId={connectionId}
                setConnectionId={setConnectionId}
                catalogEntryId={catalogEntryId}
                setCatalogEntryId={setCatalogEntryId}
                toolName={toolName}
                setToolName={setToolName}
                riskLevel={riskLevel}
                setRiskLevel={setRiskLevel}
                applications={applicationOptions}
                connections={connectionOptions}
              />
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setCreateOpen(false);
              setEditProfile(null);
              resetProfileForm();
              resetEntryForm();
            }}>
              {t("tools.common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button disabled={!name.trim() || createProfile.isPending || updateProfile.isPending} onClick={saveProfile}>
              {editProfile
                ? t("tools.common.save", { defaultValue: "Save" })
                : createProfile.isPending
                  ? t("tools.common.creating", { defaultValue: "Creating..." })
                  : t("tools.common.create", { defaultValue: "Create" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(entryProfile)} onOpenChange={(open) => {
        if (!open) {
          setEntryProfile(null);
          resetEntryForm();
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("tools.profiles.dialog.addEntry", { defaultValue: "Add entry" })}</DialogTitle>
            <DialogDescription>{entryProfile?.name}</DialogDescription>
          </DialogHeader>
          <EntryFields
            selectorType={selectorType}
            setSelectorType={setSelectorType}
            effect={effect}
            setEffect={setEffect}
            applicationId={applicationId}
            setApplicationId={setApplicationId}
            connectionId={connectionId}
            setConnectionId={setConnectionId}
            catalogEntryId={catalogEntryId}
            setCatalogEntryId={setCatalogEntryId}
            toolName={toolName}
            setToolName={setToolName}
            riskLevel={riskLevel}
            setRiskLevel={setRiskLevel}
            applications={applicationOptions}
            connections={connectionOptions}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEntryProfile(null)}>{t("tools.common.cancel", { defaultValue: "Cancel" })}</Button>
            <Button disabled={addEntry.isPending} onClick={saveEntry}>
              {t("tools.profiles.dialog.addEntry", { defaultValue: "Add entry" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(bindProfileFor)} onOpenChange={(open) => {
        if (!open) setBindProfileFor(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("tools.profiles.dialog.bindProfile", { defaultValue: "Bind profile" })}</DialogTitle>
            <DialogDescription>{bindProfileFor?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("tools.profiles.dialog.targetType", { defaultValue: "Target type" })}</Label>
              <Select value={targetType} onValueChange={(value) => setTargetType(value as ToolProfileBindingTargetType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_TYPES.map((target) => (
                    <SelectItem key={target.value} value={target.value}>
                      {t(target.labelKey, { defaultValue: target.defaultLabel })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {targetType === "agent" ? (
              <div className="space-y-1.5">
                <Label>{t("tools.common.agent", { defaultValue: "Agent" })}</Label>
                <Select value={targetAgentId} onValueChange={setTargetAgentId}>
                  <SelectTrigger><SelectValue placeholder={t("tools.profiles.selectAgent", { defaultValue: "Select an agent" })} /></SelectTrigger>
                  <SelectContent>
                    {agentOptions.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {targetType === "project" ? (
              <div className="space-y-1.5">
                <Label>{t("tools.common.project", { defaultValue: "Project" })}</Label>
                <Select value={targetProjectId} onValueChange={setTargetProjectId}>
                  <SelectTrigger><SelectValue placeholder={t("tools.profiles.selectProject", { defaultValue: "Select a project" })} /></SelectTrigger>
                  <SelectContent>
                    {projectOptions.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {targetType === "routine" ? (
              <div className="space-y-1.5">
                <Label>{t("tools.common.routine", { defaultValue: "Routine" })}</Label>
                <Select value={targetRoutineId} onValueChange={setTargetRoutineId}>
                  <SelectTrigger><SelectValue placeholder={t("tools.profiles.selectRoutine", { defaultValue: "Select a routine" })} /></SelectTrigger>
                  <SelectContent>
                    {routineOptions.map((routine) => <SelectItem key={routine.id} value={routine.id}>{routine.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {targetType === "issue" ? (
              <div className="space-y-1.5">
                <Label htmlFor="target-issue-id">{t("tools.common.issueId", { defaultValue: "Issue ID" })}</Label>
                <Input id="target-issue-id" value={targetIssueId} onChange={(event) => setTargetIssueId(event.target.value)} />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="profile-priority">{t("tools.common.priority", { defaultValue: "Priority" })}</Label>
              <Input id="profile-priority" type="number" min={0} max={10000} value={priority} onChange={(event) => setPriority(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBindProfileFor(null)}>{t("tools.common.cancel", { defaultValue: "Cancel" })}</Button>
            <Button disabled={bind.isPending} onClick={saveBinding}>
              {t("tools.profiles.dialog.bind", { defaultValue: "Bind" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProfileDetail({
  profile,
  catalog,
  catalogLoading,
  maps,
  companyId,
  onEdit,
  onAddEntry,
  onBind,
  onDeleteEntry,
  onUnbind,
}: {
  profile: ToolProfileWithDetails;
  catalog: ToolCatalogEntry[];
  catalogLoading: boolean;
  maps: {
    companyId?: string;
    agentsById: Map<string, string>;
    projectsById: Map<string, string>;
    routinesById: Map<string, string>;
    applicationsById: Map<string, string>;
    connectionsById: Map<string, string>;
  };
  companyId: string;
  onEdit: () => void;
  onAddEntry: () => void;
  onBind: () => void;
  onDeleteEntry: (entryId: string) => void;
  onUnbind: (binding: ToolProfileBinding) => void;
}) {
  const { t } = useTranslation();
  const rows = useMemo(
    () => resolveAllowList(profile, catalog, maps.applicationsById, maps.connectionsById),
    [profile, catalog, maps.applicationsById, maps.connectionsById],
  );
  const includeCount = profile.entries.filter((e) => e.effect === "include").length;
  const excludeCount = profile.entries.filter((e) => e.effect === "exclude").length;

  return (
    <Card>
      <CardContent className="space-y-5 py-4">
        {/* Header */}
        <div className="flex flex-wrap items-start gap-3">
          <Layers className="mt-0.5 h-5 w-5 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{profile.name}</span>
              <Badge variant="outline">{profile.profileKey}</Badge>
              <Badge variant={statusVariant(profile.status)}>{t(`tools.profiles.status.${profile.status}`, { defaultValue: profile.status })}</Badge>
              <Badge variant={profile.defaultAction === "allow" ? "secondary" : "outline"}>
                {t("tools.profiles.detail.defaultAction", {
                  defaultValue: "default {{action}}",
                  action: t(`tools.profiles.defaultAction.${profile.defaultAction}`, { defaultValue: profile.defaultAction }),
                })}
              </Badge>
            </div>
            {profile.description ? (
              <p className="mt-1 text-sm text-muted-foreground">{profile.description}</p>
            ) : null}
            <p className="mt-1 text-xs text-muted-foreground">
              {t("tools.common.updated", { defaultValue: "updated" })} <RelativeTime value={profile.updatedAt} />
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              {t("tools.common.edit", { defaultValue: "Edit" })}
            </Button>
            <Button size="sm" variant="outline" onClick={onAddEntry}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t("tools.profiles.detail.entry", { defaultValue: "Entry" })}
            </Button>
            <Button size="sm" variant="outline" onClick={onBind}>
              <Link2 className="mr-1 h-3.5 w-3.5" />
              {t("tools.profiles.dialog.bind", { defaultValue: "Bind" })}
            </Button>
          </div>
        </div>

        {/* Targets */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-foreground">{t("tools.profiles.detail.targets", { defaultValue: "Targets" })}</h4>
          <div className="flex flex-wrap gap-2">
            {profile.bindings.length === 0 ? (
              <span className="text-sm text-muted-foreground">{t("tools.profiles.detail.noTargets", { defaultValue: "No targets bound." })}</span>
            ) : profile.bindings.map((binding) => (
              <span key={binding.id} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs">
                <Badge variant="outline">{t(`tools.profiles.target.${binding.targetType}`, { defaultValue: binding.targetType })}</Badge>
                <span>{bindingLabel(binding.targetType, binding.targetId, { companyId, ...maps })}</span>
                <span className="text-muted-foreground">p{binding.priority}</span>
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                  onClick={() => onUnbind(binding)}
                  aria-label={t("tools.profiles.detail.removeBindingAria", {
                    defaultValue: "Remove {{type}} binding",
                    type: t(`tools.profiles.target.${binding.targetType}`, { defaultValue: binding.targetType }),
                  })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Effective scope summary */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-foreground">{t("tools.profiles.detail.effectiveScope", { defaultValue: "Effective scope" })}</h4>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-md border border-border px-2 py-1 text-muted-foreground">
              {t("tools.profiles.detail.default", { defaultValue: "Default" })}{" "}
              <span className="font-medium text-foreground">{t(`tools.profiles.defaultAction.${profile.defaultAction}`, { defaultValue: profile.defaultAction })}</span>
            </span>
            <span className="rounded-md border border-border px-2 py-1 text-muted-foreground">
              {t("tools.profiles.detail.toolsAllowed", { defaultValue: "{{count}} tools allowed", count: rows.length })}
            </span>
            <span className="rounded-md border border-border px-2 py-1 text-muted-foreground">
              {t("tools.profiles.detail.includeExclude", {
                defaultValue: "{{include}} include / {{exclude}} exclude",
                include: includeCount,
                exclude: excludeCount,
              })}
            </span>
          </div>
        </div>

        {/* Selectors (entry management) */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-foreground">{t("tools.profiles.detail.selectors", { defaultValue: "Selectors" })}</h4>
          <div className="flex flex-wrap gap-2">
            {profile.entries.length === 0 ? (
              <span className="text-sm text-muted-foreground">{t("tools.profiles.detail.noSelectors", { defaultValue: "No selectors." })}</span>
            ) : profile.entries.map((entry) => (
              <span key={entry.id} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs">
                <Badge variant={entry.effect === "include" ? "secondary" : "destructive"}>{t(`tools.profiles.effect.${entry.effect}`, { defaultValue: entry.effect })}</Badge>
                <span className="font-mono">{t(`tools.profiles.selectorType.${entry.selectorType}`, { defaultValue: entry.selectorType })}</span>
                {entry.selectorType === "risk_level" ? <RiskBadge risk={entry.riskLevel} /> : (
                  <span className="max-w-64 truncate">{entryLabel(entry, maps.applicationsById, maps.connectionsById)}</span>
                )}
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                  onClick={() => onDeleteEntry(entry.id)}
                  aria-label={t("tools.profiles.detail.deleteEntryAria", {
                    defaultValue: "Delete {{type}} entry",
                    type: t(`tools.profiles.selectorType.${entry.selectorType}`, { defaultValue: entry.selectorType }),
                  })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Allow list */}
        <AllowList rows={rows} catalogLoading={catalogLoading} />
      </CardContent>
    </Card>
  );
}

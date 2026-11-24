import type { Agent, AiConnectionList } from "@penclipai/shared";
import { getAdapterLabel } from "@/adapters/adapter-display-registry";
import { pendingAgentSetupDisplayAdapter } from "./agent-setup-choice";
import { agentConnection, agentDefaultModel, bulkAgentHarness } from "./bulk-agent-settings";

export const agentRosterFilterFields = ["model", "status", "harness", "connection"] as const;
export type AgentRosterFilterField = (typeof agentRosterFilterFields)[number];
export type AgentRosterFilters = Record<AgentRosterFilterField, string>;
export type AgentRosterOption = { value: string; label: string };
type Translate = (key: string, options?: { defaultValue?: string }) => string;
export const emptyAgentRosterFilters: AgentRosterFilters = { model: "", status: "", harness: "", connection: "" };

/** Use the same metadata for filter choices and roster cells. Index account names once. */
export function buildAgentRosterIndex(
  agents: readonly Agent[],
  accounts?: AiConnectionList,
  translate?: Translate,
) {
  const label = (key: string, defaultValue: string) =>
    translate?.(key, { defaultValue }) ?? defaultValue;
  const connectionNames = new Map(accounts?.connections.map(c => [JSON.stringify([c.id, c.grantId]), c.name]));
  const poolNames = new Map(accounts?.pools?.map(pool => [pool.id, pool.name]));
  const byAgentId = new Map<string, Record<AgentRosterFilterField, AgentRosterOption>>();
  const choices = Object.fromEntries(agentRosterFilterFields.map(field => [field, new Map<string, AgentRosterOption>()])) as Record<AgentRosterFilterField, Map<string, AgentRosterOption>>;

  for (const agent of agents) {
    if (["terminated", "pending_approval"].includes(agent.status)) continue;
    const pending = pendingAgentSetupDisplayAdapter(agent);
    const harness = pending ?? bulkAgentHarness(agent);
    const model = agentDefaultModel(agent);
    const binding = agentConnection(agent);
    let connection: AgentRosterOption;
    if (pending) connection = { value: "unconfigured", label: label("agents.filters.unconfigured", "Not configured") };
    else if (["http", "process"].includes(agent.adapterType)) connection = { value: "external", label: label("agents.filters.external", "Managed externally") };
    else if (!binding) connection = { value: "local", label: label("agents.filters.localCredentials", "Local credentials") };
    else if (binding.mode === "responsible_user") connection = { value: "responsible_user", label: label("agents.filters.responsibleUserDefault", "Responsible user's default") };
    else if (binding.mode === "router") connection = { value: `pool:${binding.connectionId}`, label: poolNames.get(binding.connectionId) ?? label("agents.filters.connectionPool", "Connection pool") };
    else connection = { value: `connection:${binding.connectionId}`, label: connectionNames.get(JSON.stringify([binding.connectionId, binding.grantId])) ?? label("agents.filters.assignedConnection", "Assigned connection") };
    const values: Record<AgentRosterFilterField, AgentRosterOption> = {
      harness: { value: harness, label: getAdapterLabel(harness) },
      model: pending ? { value: "unconfigured", label: label("agents.filters.notAvailableYet", "Not available yet") }
        : model ? { value: `model:${model}`, label: model } : { value: "default", label: label("agents.filters.harnessDefault", "Harness default") },
      status: { value: agent.status, label: label(`status.${agent.status.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())}`, agent.status.charAt(0).toUpperCase() + agent.status.slice(1)) },
      connection,
    };
    byAgentId.set(agent.id, values);
    for (const field of agentRosterFilterFields) {
      values[field] = choices[field].get(values[field].value) ?? values[field];
      choices[field].set(values[field].value, values[field]);
    }
  }
  const options = Object.fromEntries(agentRosterFilterFields.map(field => [field,
    [...choices[field].values()].sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value)),
  ])) as Record<AgentRosterFilterField, AgentRosterOption[]>;
  // Names can be equal or unavailable. Keep distinct saved connections selectable
  // without exposing their internal IDs. Roster cells use the same suffixes.
  const labelCounts = new Map<string, number>();
  for (const option of options.connection) labelCounts.set(option.label, (labelCounts.get(option.label) ?? 0) + 1);
  const occurrences = new Map<string, number>();
  for (const option of options.connection) {
    const label = option.label;
    if (labelCounts.get(label)! < 2) continue;
    const occurrence = (occurrences.get(label) ?? 0) + 1;
    occurrences.set(label, occurrence);
    option.label = `${label} (${occurrence})`;
  }
  return { byAgentId, options };
}

export function matchesAgentRosterFilters(
  values: Record<AgentRosterFilterField, AgentRosterOption> | undefined,
  filters: AgentRosterFilters,
) {
  return agentRosterFilterFields.every(field => !filters[field] || values?.[field].value === filters[field]);
}

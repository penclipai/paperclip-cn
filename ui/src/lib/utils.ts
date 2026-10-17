import { getCurrentLocale, translateInstant } from "../i18n";
const DISPLAY_CURRENCY = "USD";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { deriveAgentUrlKey, deriveProjectUrlKey, normalizeProjectUrlKey, hasNonAsciiContent } from "@penclipai/shared";
import type { BillingType, FinanceDirection, FinanceEventKind } from "@penclipai/shared";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Classes for a sidebar row label when the sidebar is collapsed to the icon rail
 * (PAP-10676). Unlike `sr-only` (which is `position: absolute` and therefore
 * removes the label from flow), this keeps the label in flow so it still
 * contributes its line-height to the row. That guarantees a row is the *exact*
 * same height collapsed as expanded, so the icons never shift vertically between
 * states. The label is clipped to zero visible width and rendered transparent,
 * but stays in the DOM and the a11y tree as the link's accessible name.
 */
export const SIDEBAR_RAIL_HIDDEN_LABEL =
  "block w-0 min-w-0 overflow-hidden whitespace-nowrap text-transparent select-none";

export function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function asFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function formatCents(cents: number, currency = "USD"): string {
  // Older finance writes accepted arbitrary three-character codes. Keep those
  // amounts readable without passing an invalid currency to Intl.
  if (!/^[a-z]{3}$/i.test(currency)) {
    return `${currency} ${(cents / 100).toLocaleString(getCurrentLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return (cents / 100).toLocaleString(getCurrentLocale(), { style: "currency", currency, ...(currency.toUpperCase() === "USD" ? { currencyDisplay: "narrowSymbol" as const } : {}), minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(getCurrentLocale(), options);
}

/**
 * Format a project's budget for the projects list view (IA Phase 4 — PAP-60).
 * Monthly budgets render a `/mo` suffix; lifetime budgets show the bare amount.
 */
export function formatProjectBudget(budget: { amountCents: number; windowKind: string }): string {
  const amount = formatCents(budget.amountCents);
  return budget.windowKind === "calendar_month_utc" ? translateInstant("projectBudget.amountPerMonth", { amount }) : amount;
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString(getCurrentLocale(), {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(
  date: Date | string,
  options: { includeSeconds?: boolean; includeYear?: boolean } = {},
): string {
  return new Date(date).toLocaleString(getCurrentLocale(), {
    month: "short",
    day: "numeric",
    ...(options.includeYear === false ? {} : { year: "numeric" as const }),
    hour: "numeric",
    minute: "2-digit",
    ...(options.includeSeconds ? { second: "2-digit" as const } : {}),
  });
}

export function formatShortDate(date: Date | string): string {
  return new Date(date).toLocaleString(getCurrentLocale(), {
    month: "short",
    day: "numeric",
  });
}

export function relativeTime(date: Date | string): string {
  const deltaSeconds = Math.round((new Date(date).getTime() - Date.now()) / 1000);
  const absoluteSeconds = Math.abs(deltaSeconds);

  if (absoluteSeconds < 45) return translateInstant("common.justNow");

  const formatter = new Intl.RelativeTimeFormat(getCurrentLocale(), { numeric: "auto" });

  if (absoluteSeconds < 3_600) {
    return formatter.format(Math.round(deltaSeconds / 60), "minute");
  }
  if (absoluteSeconds < 86_400) {
    return formatter.format(Math.round(deltaSeconds / 3_600), "hour");
  }
  if (absoluteSeconds < 2_592_000) {
    return formatter.format(Math.round(deltaSeconds / 86_400), "day");
  }
  return formatDate(date);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Humanize a millisecond duration into a compact `1h 2m`, `45m 12s`, `12s` string. */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

/** Map a raw provider slug to a display-friendly name. */
export function providerDisplayName(provider: string): string {
  const map: Record<string, string> = {
    anthropic: "Anthropic",
    aws_bedrock: "AWS Bedrock",
    openai: "OpenAI",
    openrouter: "OpenRouter",
    chatgpt: "ChatGPT",
    google: "Google",
    cursor: "Cursor",
    jetbrains: "JetBrains AI",
  };
  return map[provider.toLowerCase()] ?? provider;
}

export function billingTypeDisplayName(billingType: BillingType): string {
  const map: Record<BillingType, string> = {
    metered_api: translateInstant("billingType.meteredApi"),
    subscription_included: translateInstant("billingType.subscription"),
    subscription_overage: translateInstant("billingType.subscriptionOverage"),
    credits: translateInstant("billingType.credits"),
    fixed: translateInstant("billingType.fixed"),
    unknown: translateInstant("billingType.unknown"),
  };
  return map[billingType];
}

export function quotaSourceDisplayName(source: string): string {
  const map: Record<string, string> = {
    "anthropic-oauth": "Anthropic OAuth",
    "claude-cli": "Claude CLI",
    "bedrock": "AWS Bedrock",
    "codex-rpc": "Codex app server",
    "codex-wham": "ChatGPT WHAM",
  };
  return map[source] ?? source;
}

function coerceBillingType(value: unknown): BillingType | null {
  if (
    value === "metered_api" ||
    value === "subscription_included" ||
    value === "subscription_overage" ||
    value === "credits" ||
    value === "fixed" ||
    value === "unknown"
  ) {
    return value;
  }
  return null;
}

function readRunCostUsd(payload: Record<string, unknown> | null): number | null {
  if (!payload) return null;
  for (const key of ["cacheAdjustedCostUsd", "costUsdExact", "costUsd", "cost_usd", "total_cost_usd"] as const) {
    const value = payload[key];
    if (key === "costUsdExact" && typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value))) return Number(value);
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

/** Receipt-backed runs and legacy Claude/Gemini snapshots store uncached input
 * separately. OpenCode/Pi persist their provider-qualified model IDs and also
 * separate cache reads. Older Codex input already includes cached tokens.
 * Unknown legacy formats retain their input-plus-output interpretation. */
export function visibleRunTokenTotal(usage: Record<string, unknown> | null | undefined): number {
  const count = (...keys: string[]) => {
    for (const key of keys) {
      const value = usage?.[key];
      if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
    }
    return 0;
  };
  const input = count("inputTokens", "input_tokens");
  const output = count("outputTokens", "output_tokens");
  const cached = count("cachedInputTokens", "cached_input_tokens", "cache_read_input_tokens");
  const provider = typeof usage?.provider === "string" ? usage.provider : "";
  const model = typeof usage?.model === "string" ? usage.model : "";
  // Use the saved model convention, not the agent's current adapter: an agent
  // can change adapters after a historical run. Codex saves an unqualified ID.
  const qualifiedModel = provider !== "" && provider !== "unknown"
    && model.startsWith(`${provider}/`) && model.length > provider.length + 1;
  const inputExcludesCached = usage?.provider === "anthropic"
    || usage?.provider === "google"
    || qualifiedModel
    || (typeof usage?.accountingReceiptId === "string" && usage.accountingReceiptId.length > 0);
  return input + output + (inputExcludesCached ? cached : 0);
}

export function visibleRunCostUsd(
  usage: Record<string, unknown> | null,
  result: Record<string, unknown> | null = null,
): number {
  const billingType = coerceBillingType(usage?.billingType) ?? coerceBillingType(result?.billingType);
  if (billingType === "subscription_included") return 0;
  return readRunCostUsd(usage) ?? readRunCostUsd(result) ?? 0;
}

export function financeEventKindDisplayName(eventKind: FinanceEventKind): string {
  const map: Record<FinanceEventKind, string> = {
    inference_charge: translateInstant("financeEventKind.inferenceCharge"),
    platform_fee: translateInstant("financeEventKind.platformFee"),
    credit_purchase: translateInstant("financeEventKind.creditPurchase"),
    credit_refund: translateInstant("financeEventKind.creditRefund"),
    credit_expiry: translateInstant("financeEventKind.creditExpiry"),
    byok_fee: translateInstant("financeEventKind.byokFee"),
    gateway_overhead: translateInstant("financeEventKind.gatewayOverhead"),
    log_storage_charge: translateInstant("financeEventKind.logStorage"),
    logpush_charge: translateInstant("financeEventKind.logpush"),
    provisioned_capacity_charge: translateInstant("financeEventKind.provisionedCapacity"),
    training_charge: translateInstant("financeEventKind.training"),
    custom_model_import_charge: translateInstant("financeEventKind.customModelImport"),
    custom_model_storage_charge: translateInstant("financeEventKind.customModelStorage"),
    manual_adjustment: translateInstant("financeEventKind.manualAdjustment"),
  };
  return map[eventKind];
}

export function financeDirectionDisplayName(direction: FinanceDirection): string {
  return direction === "credit"
    ? translateInstant("financeDirection.credit")
    : translateInstant("financeDirection.debit");
}

/** Build an issue URL using the human-readable identifier when available. */
export function issueUrl(issue: { id: string; identifier?: string | null }): string {
  return `/issues/${issue.identifier ?? issue.id}`;
}

/** Build an agent route URL using the short URL key when available. */
export function agentRouteRef(agent: { id: string; urlKey?: string | null; name?: string | null }): string {
  return agent.urlKey ?? deriveAgentUrlKey(agent.name, agent.id);
}

/** Build an agent URL using the short URL key when available. */
export function agentUrl(agent: { id: string; urlKey?: string | null; name?: string | null }): string {
  return `/agents/${agentRouteRef(agent)}`;
}

/** Build a project route reference, falling back to UUID when the derived key is ambiguous. */
export function projectRouteRef(project: { id: string; urlKey?: string | null; name?: string | null }): string {
  const key = project.urlKey ?? deriveProjectUrlKey(project.name, project.id);
  // Guard for rolling deploys or legacy data where the server returned a bare slug without UUID suffix.
  if (key === normalizeProjectUrlKey(project.name) && hasNonAsciiContent(project.name)) return project.id;
  return key;
}

/** Build a project URL using the short URL key when available. */
export function projectUrl(project: { id: string; urlKey?: string | null; name?: string | null }): string {
  return `/projects/${projectRouteRef(project)}`;
}

/** Build a project workspace URL scoped under its project. */
export function projectWorkspaceUrl(
  project: { id: string; urlKey?: string | null; name?: string | null },
  workspaceId: string,
): string {
  return `${projectUrl(project)}/workspaces/${workspaceId}`;
}

/** Preserve sub-cent inference charges instead of showing a misleading $0.00. */
export function formatDetailedCents(cents: string | number): string {
  return (Number(cents) / 100).toLocaleString(getCurrentLocale(), { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", minimumFractionDigits: 2, maximumFractionDigits: 9 });
}

export function formatUsdAmount(
  amount: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(getCurrentLocale(), {
    style: "currency",
    currency: DISPLAY_CURRENCY,
    currencyDisplay: "narrowSymbol",
    ...options,
  }).format(amount);
}

export function formatBudgetInputValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function parseBudgetInputValue(value: string): number | null {
  const normalized = value.trim();
  if (normalized.length === 0) return 0;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export function formatTime(
  date: Date | string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(getCurrentLocale(), options).format(new Date(date));
}

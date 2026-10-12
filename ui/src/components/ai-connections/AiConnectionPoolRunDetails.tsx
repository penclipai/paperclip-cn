import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import type { AiConnectionRouterSelection } from "@penclipai/shared";

export function AiConnectionPoolRunDetails({ context }: { context: Record<string, unknown> | null }) {
  useTranslation();
  const selection = context?.aiRouterSelection as AiConnectionRouterSelection | undefined;
  if (!selection) return null;
  const account = context?.aiConnection as { accountName?: string; connectionId?: string } | undefined;
  const config = selection.runtimeConfig;
  const effort = config.modelReasoningEffort ?? config.reasoningEffort ?? config.effort ?? config.variant;
  return <div className="rounded-lg border p-4 text-sm space-y-1">
    <p className="font-medium">{translateInstant("Task-pinned pool account ·")}{" "}{account?.accountName ?? account?.connectionId ?? "Selected account"}</p>
    <p>{[selection.binding.provider, config.provider, config.acpxAgent, config.model, effort].filter(Boolean).map(String).join(" · ")}</p>
    {selection.notes.length > 0 && <p className="text-muted-foreground">{selection.notes.join(" ")}</p>}
  </div>;
}

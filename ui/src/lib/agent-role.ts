import { AGENT_ROLE_LABELS } from "@penclipai/shared";
import { translateInstant } from "@/i18n";

const ROLE_LABELS = AGENT_ROLE_LABELS as Record<string, string>;

/** Returns the localized display label for an agent role code while keeping unknown roles intact. */
export function displayAgentRole(
  role: string,
  t: (key: string, options?: { defaultValue?: string }) => string = translateInstant,
): string {
  return t(`agentRole.${role}`, { defaultValue: ROLE_LABELS[role] ?? role });
}

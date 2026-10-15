import { translateInstant } from "@/i18n";

/**
 * Translates application-owned adapter diagnostics while preserving unknown,
 * plugin-provided, and user-provided messages exactly as received.
 */
export function translateAdapterDiagnosticMessage(code: string, message: string): string {
  return code === "grok_auth_copyback_failed"
    ? translateInstant("adapter.diagnostic.grokAuthCopybackFailed", {
        defaultValue: "Grok authentication refresh could not be saved locally.",
      })
    : message;
}

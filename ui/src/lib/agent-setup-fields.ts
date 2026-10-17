import { DEFAULT_CODEX_LOCAL_MODEL } from "@penclipai/adapter-codex-local";
import { claudeLocalReasoningEffortsForModel, DEFAULT_CLAUDE_LOCAL_MODEL } from "@penclipai/adapter-claude-local";
import { grokLocalReasoningEffortsForModel } from "@penclipai/adapter-grok-local";
import { codexReasoningEffortOptions } from "./codex-reasoning-effort";

/** Only controls consumed by each adapter's config builder and runtime belong here. */
export const SETUP_CREDENTIAL_KEYS: Record<string, string> = {
  cursor: "CURSOR_API_KEY",
  cursor_cloud: "CURSOR_API_KEY",
  gemini_local: "GEMINI_API_KEY",
  kimi_local: "KIMI_MODEL_API_KEY",
};

export function setupEfforts(adapter: string, model = ""): string[] {
  switch (adapter) {
    case "claude_local":
      return [...claudeLocalReasoningEffortsForModel(model || DEFAULT_CLAUDE_LOCAL_MODEL)];
    case "codex_local":
      return codexReasoningEffortOptions(model || DEFAULT_CODEX_LOCAL_MODEL)
        .map((option) => option.value)
        .filter(Boolean);
    case "pi_local":
      return ["off", "minimal", "low", "medium", "high", "xhigh"];
    case "grok_local":
      return [...grokLocalReasoningEffortsForModel(model)];
    default:
      return [];
  }
}

export const SETUP_LOGIN_HINTS: Record<string, string> = {
  cursor:
    "Use a Cursor API key, or run agent login on the selected environment's host.",
  gemini_local:
    "Use a Gemini API key, or an existing supported Gemini CLI login on the selected environment's host.",
  kimi_local:
    "Use a Kimi API key and model settings below, or run kimi login on the selected environment's host.",
  grok_local:
    "Grok Build uses its CLI sign-in. Run grok login on the selected environment's host, then test the connection here.",
};

/**
 * Adapter types shipped with Paperclip. External plugins may temporarily
 * override these, but the registry retains the built-in fallback.
 */
export const BUILTIN_ADAPTER_TYPES = new Set([
  "acpx_local",
  "claude_local",
  "codebuddy_local",
  "codex_local",
  "cursor_cloud",
  "cursor",
  "gemini_local",
  "grok_local",
  "hermes_gateway",
  "hermes_local",
  "openclaw_gateway",
  "opencode_local",
  "pi_local",
  "qwen_local",
  "process",
  "http",
]);

import type { CLIAdapterModule } from "@penclipai/adapter-utils";
import { printClaudeStreamEvent } from "@penclipai/adapter-claude-local/cli";
import { printCodeBuddyStreamEvent } from "@penclipai/adapter-codebuddy-local/cli";
import { printCodexStreamEvent } from "@penclipai/adapter-codex-local/cli";
import { printCursorStreamEvent } from "@penclipai/adapter-cursor-local/cli";
import { printCursorCloudEvent } from "@penclipai/adapter-cursor-cloud/cli";
import { printGeminiStreamEvent } from "@penclipai/adapter-gemini-local/cli";
import { printGrokStreamEvent } from "@penclipai/adapter-grok-local/cli";
import { printKimiStreamEvent } from "@penclipai/adapter-kimi-local/cli";
import { formatStdoutEvent as printHermesGatewayStreamEvent } from "@penclipai/hermes-paperclip-adapter/gateway/cli";
import { printHermesStreamEvent } from "@penclipai/hermes-paperclip-adapter/cli";
import { printOpenCodeStreamEvent } from "@penclipai/adapter-opencode-local/cli";
import { printPiStreamEvent } from "@penclipai/adapter-pi-local/cli";
import { printQwenStreamEvent } from "@penclipai/adapter-qwen-local/cli";
import { printOpenClawGatewayStreamEvent } from "@penclipai/adapter-openclaw-gateway/cli";
import { processCLIAdapter } from "./process/index.js";
import { httpCLIAdapter } from "./http/index.js";

const claudeLocalCLIAdapter: CLIAdapterModule = {
  type: "claude_local",
  formatStdoutEvent: printClaudeStreamEvent,
};

const codexLocalCLIAdapter: CLIAdapterModule = {
  type: "codex_local",
  formatStdoutEvent: printCodexStreamEvent,
};

const codeBuddyLocalCLIAdapter: CLIAdapterModule = {
  type: "codebuddy_local",
  formatStdoutEvent: printCodeBuddyStreamEvent,
};

const openCodeLocalCLIAdapter: CLIAdapterModule = {
  type: "opencode_local",
  formatStdoutEvent: printOpenCodeStreamEvent,
};

const piLocalCLIAdapter: CLIAdapterModule = {
  type: "pi_local",
  formatStdoutEvent: printPiStreamEvent,
};

const qwenLocalCLIAdapter: CLIAdapterModule = {
  type: "qwen_local",
  formatStdoutEvent: printQwenStreamEvent,
};

const cursorLocalCLIAdapter: CLIAdapterModule = {
  type: "cursor",
  formatStdoutEvent: printCursorStreamEvent,
};

const cursorCloudCLIAdapter: CLIAdapterModule = {
  type: "cursor_cloud",
  formatStdoutEvent: printCursorCloudEvent,
};

const geminiLocalCLIAdapter: CLIAdapterModule = {
  type: "gemini_local",
  formatStdoutEvent: printGeminiStreamEvent,
};

const grokLocalCLIAdapter: CLIAdapterModule = {
  type: "grok_local",
  formatStdoutEvent: printGrokStreamEvent,
};

const kimiLocalCLIAdapter: CLIAdapterModule = {
  type: "kimi_local",
  formatStdoutEvent: printKimiStreamEvent,
};

const hermesGatewayCLIAdapter: CLIAdapterModule = {
  type: "hermes_gateway",
  formatStdoutEvent: printHermesGatewayStreamEvent,
};

const hermesLocalCLIAdapter: CLIAdapterModule = {
  type: "hermes_local",
  formatStdoutEvent: printHermesStreamEvent,
};

const openclawGatewayCLIAdapter: CLIAdapterModule = {
  type: "openclaw_gateway",
  formatStdoutEvent: printOpenClawGatewayStreamEvent,
};

const adaptersByType = new Map<string, CLIAdapterModule>(
  [
    claudeLocalCLIAdapter,
    codeBuddyLocalCLIAdapter,
    codexLocalCLIAdapter,
    openCodeLocalCLIAdapter,
    piLocalCLIAdapter,
    qwenLocalCLIAdapter,
    cursorLocalCLIAdapter,
    cursorCloudCLIAdapter,
    geminiLocalCLIAdapter,
    grokLocalCLIAdapter,
    kimiLocalCLIAdapter,
    hermesGatewayCLIAdapter,
    hermesLocalCLIAdapter,
    openclawGatewayCLIAdapter,
    processCLIAdapter,
    httpCLIAdapter,
  ].map((a) => [a.type, a]),
);

export function getCLIAdapter(type: string): CLIAdapterModule {
  return adaptersByType.get(type) ?? processCLIAdapter;
}

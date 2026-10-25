import { beforeEach, describe, expect, it, vi } from "vitest";

const translateInstantMock = vi.hoisted(() => vi.fn());
vi.mock("../i18n", () => ({ translateInstant: translateInstantMock }));

import { agentDisplayAdapterType, getAdapterDisplay, getAdapterLabel, getAdapterLabels } from "./adapter-display-registry";

describe("adapter display registry", () => {
  beforeEach(() => {
    translateInstantMock.mockReset();
    translateInstantMock.mockImplementation((key: string) => `zh:${key}`);
  });

  it("uses localized user-facing labels without the legacy local qualifier for built-in adapters", () => {
    expect(getAdapterLabel("codex_local")).toBe("zh:Codex");
    expect(getAdapterLabel("claude_local")).toBe("zh:Claude Code");
    expect(getAdapterLabel("acpx_local")).toBe("zh:ACPX (retired)");
    expect(getAdapterLabel("cursor")).toBe("zh:Cursor");
    expect(getAdapterLabel("gemini_local")).toBe("zh:Gemini CLI");
    expect(getAdapterLabel("grok_local")).toBe("zh:Grok Build");
    expect(getAdapterLabel("kimi_local")).toBe("zh:Kimi Code");
    expect(getAdapterLabel("opencode_local")).toBe("zh:OpenCode");
    expect(getAdapterLabel("pi_local")).toBe("zh:Pi");
    expect(agentDisplayAdapterType({ adapterType: "paperclip_runner", adapterConfig: { provider: "opencode" } })).toBe("opencode_local");
    expect(agentDisplayAdapterType({ adapterType: "paperclip_runner", adapterConfig: { provider: "acpx", acpxAgent: "pi" } })).toBe("pi_local");
    expect(getAdapterLabels()).toMatchObject({ codex_local: "zh:Codex", claude_local: "zh:Claude Code", acpx_local: "zh:ACPX (retired)", cursor: "zh:Cursor", gemini_local: "zh:Gemini CLI", grok_local: "zh:Grok Build", kimi_local: "zh:Kimi Code", opencode_local: "zh:OpenCode", pi_local: "zh:Pi" });
  });
  it.each([
    ["openai_dot", "zh:OpenAI Dot"],
    ["grok_bot", "zh:Grok Bot"],
    ["muse", "zh:Muse — Personal agent"],
  ])("keeps saved %s external runners branded by provider", (provider, label) => {
    const type = agentDisplayAdapterType({ adapterType: "paperclip_runner", adapterConfig: { provider } });
    expect(getAdapterDisplay(type).label).toBe(label);
  });
  it("brands saved Codex runners as Codex without guessing managed or unknown providers", () => {
    expect(agentDisplayAdapterType({ adapterType: "paperclip_runner", adapterConfig: { provider: "codex" } })).toBe("codex_local");
    expect(agentDisplayAdapterType({ adapterType: "paperclip_runner", adapterConfig: {} })).toBe("codex_local");
    for (const provider of ["claude_managed", "aws_agentcore", "unknown"]) {
      expect(agentDisplayAdapterType({ adapterType: "paperclip_runner", adapterConfig: { provider } })).toBe("paperclip_runner");
    }
  });
  it("drops local suffixes for unknown plugin adapter labels", () => {
    expect(getAdapterLabel("droid_local")).toBe("Droid");
    expect(getAdapterDisplay("droid_local")).toMatchObject({
      label: "Droid",
      description: "zh:External adapter",
    });
  });

  it("keeps a gateway suffix for unknown plugin adapter labels", () => {
    expect(getAdapterLabel("droid_gateway")).toBe("Droid (gateway)");
    expect(getAdapterDisplay("droid_gateway")).toMatchObject({
      label: "Droid (gateway)",
      description: "zh:External gateway adapter",
    });
  });
});

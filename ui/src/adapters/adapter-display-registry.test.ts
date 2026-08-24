import { beforeEach, describe, expect, it, vi } from "vitest";

const { translateInstantMock } = vi.hoisted(() => ({
  translateInstantMock: vi.fn((key: string) => key),
}));

vi.mock("../i18n", () => ({
  translateInstant: translateInstantMock,
}));

import { adapterLabels } from "../components/agent-config-primitives";
import { getAdapterDisplay, getAdapterLabel, getAdapterLabels } from "./adapter-display-registry";

describe("adapter display registry", () => {
  beforeEach(() => {
    translateInstantMock.mockReset();
    translateInstantMock.mockImplementation((key: string) => `zh:${key}`);
  });

  it("translates built-in adapter labels without the legacy local qualifier", () => {
    expect(getAdapterLabel("codex_local")).toBe("zh:Codex");
    expect(getAdapterLabel("claude_local")).toBe("zh:Claude Code");
    expect(getAdapterLabel("acpx_local")).toBe("zh:ACPX (retired)");
    expect(getAdapterLabel("cursor")).toBe("zh:Cursor");
    expect(getAdapterLabel("gemini_local")).toBe("zh:Gemini CLI");
    expect(getAdapterLabel("grok_local")).toBe("zh:Grok Build");
    expect(getAdapterLabel("hermes_local")).toBe("zh:Hermes");
    expect(getAdapterLabel("hermes_gateway")).toBe("zh:Hermes Gateway");
    expect(getAdapterLabel("opencode_local")).toBe("zh:OpenCode");
    expect(getAdapterLabel("pi_local")).toBe("zh:Pi");
    expect(getAdapterLabel("codebuddy_local")).toBe("zh:CodeBuddy");
    expect(getAdapterLabel("qwen_local")).toBe("zh:Qwen");

    expect(getAdapterLabels()).toMatchObject({
      codex_local: "zh:Codex",
      claude_local: "zh:Claude Code",
      acpx_local: "zh:ACPX (retired)",
      cursor: "zh:Cursor",
      gemini_local: "zh:Gemini CLI",
      grok_local: "zh:Grok Build",
      hermes_local: "zh:Hermes",
      hermes_gateway: "zh:Hermes Gateway",
      opencode_local: "zh:OpenCode",
      pi_local: "zh:Pi",
      codebuddy_local: "zh:CodeBuddy",
      qwen_local: "zh:Qwen",
    });
    expect(getAdapterDisplay("qwen_local")).toMatchObject({
      label: "zh:Qwen",
      description: "zh:Local Qwen agent",
    });
  });

  it("keeps external adapter labels generic while translating fallback descriptions", () => {
    expect(getAdapterLabel("droid_local")).toBe("Droid");
    expect(getAdapterDisplay("droid_local")).toMatchObject({
      label: "Droid",
      description: "zh:External adapter",
    });
    expect(getAdapterLabel("droid_gateway")).toBe("Droid (gateway)");
    expect(getAdapterDisplay("droid_gateway")).toMatchObject({
      label: "Droid (gateway)",
      description: "zh:External gateway adapter",
    });
  });

  it("keeps adapterLabels reactive to translation changes", () => {
    expect(adapterLabels.codex_local).toBe("zh:Codex");

    translateInstantMock.mockImplementation((key: string) => `en:${key}`);

    expect(adapterLabels.codex_local).toBe("en:Codex");
  });
});

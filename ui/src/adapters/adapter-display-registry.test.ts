import { beforeEach, describe, expect, it, vi } from "vitest";

const translateInstantMock = vi.hoisted(() => vi.fn());
vi.mock("../i18n", () => ({ translateInstant: translateInstantMock }));

import { getAdapterDisplay, getAdapterLabel, getAdapterLabels } from "./adapter-display-registry";

describe("adapter display registry", () => {
  beforeEach(() => {
    translateInstantMock.mockReset();
    translateInstantMock.mockImplementation((key: string) => `zh:${key}`);
  });

  it("uses user-facing labels without the legacy local qualifier for built-in adapters", () => {
    expect(getAdapterLabel("codex_local")).toBe("zh:Codex");
    expect(getAdapterLabel("claude_local")).toBe("zh:Claude Code");
    expect(getAdapterLabel("acpx_local")).toBe("zh:ACPX (retired)");
    expect(getAdapterLabel("cursor")).toBe("zh:Cursor");
    expect(getAdapterLabel("gemini_local")).toBe("zh:Gemini CLI");
    expect(getAdapterLabel("grok_local")).toBe("zh:Grok Build");
    expect(getAdapterLabel("kimi_local")).toBe("zh:Kimi Code");
    expect(getAdapterLabel("hermes_local")).toBe("zh:Hermes");
    expect(getAdapterLabel("hermes_gateway")).toBe("zh:Hermes Gateway");
    expect(getAdapterLabel("opencode_local")).toBe("zh:OpenCode");
    expect(getAdapterLabel("pi_local")).toBe("zh:Pi");

    expect(getAdapterLabels()).toMatchObject({
      codex_local: "zh:Codex",
      claude_local: "zh:Claude Code",
      acpx_local: "zh:ACPX (retired)",
      cursor: "zh:Cursor",
      gemini_local: "zh:Gemini CLI",
      grok_local: "zh:Grok Build",
      kimi_local: "zh:Kimi Code",
      hermes_local: "zh:Hermes",
      hermes_gateway: "zh:Hermes Gateway",
      opencode_local: "zh:OpenCode",
      pi_local: "zh:Pi",
    });
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

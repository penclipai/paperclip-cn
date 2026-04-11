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

  it("translates built-in adapter labels and descriptions at read time", () => {
    expect(getAdapterLabel("codebuddy_local")).toBe("zh:CodeBuddy (local)");
    expect(getAdapterDisplay("qwen_local")).toMatchObject({
      label: "zh:Qwen",
      description: "zh:Local Qwen agent",
    });
    expect(getAdapterLabels().codex_local).toBe("zh:Codex (local)");
  });

  it("translates fallback descriptions for unknown external adapters", () => {
    expect(getAdapterDisplay("custom_gateway")).toMatchObject({
      label: "Custom (gateway)",
      description: "zh:External gateway adapter",
    });
  });

  it("keeps adapterLabels reactive to translation changes", () => {
    expect(adapterLabels.codex_local).toBe("zh:Codex (local)");

    translateInstantMock.mockImplementation((key: string) => `en:${key}`);

    expect(adapterLabels.codex_local).toBe("en:Codex (local)");
  });
});

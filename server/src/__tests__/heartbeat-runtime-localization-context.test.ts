import { describe, expect, it } from "vitest";
import { resolveRuntimeLocalizationPromptForContextSnapshot } from "../services/heartbeat.js";

describe("resolveRuntimeLocalizationPromptForContextSnapshot", () => {
  it("uses zh-CN runtime guidance when the run context requested zh-CN", () => {
    const note = resolveRuntimeLocalizationPromptForContextSnapshot(
      { requestedUiLocale: "zh-CN" },
      {
        platform: "win32",
        shell: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      },
    );

    expect(note).toContain("运行环境补充：");
    expect(note).toContain("默认用简体中文进行自然语言回复");
  });

  it("uses English runtime guidance when the run context requested English", () => {
    const note = resolveRuntimeLocalizationPromptForContextSnapshot(
      { requestedUiLocale: "en" },
      {
        platform: "darwin",
        shell: "/bin/zsh",
      },
    );

    expect(note).toContain("Runtime note:");
    expect(note).toContain("use English for natural-language output");
  });

  it("keeps the neutral runtime note when the run context did not request a locale", () => {
    const note = resolveRuntimeLocalizationPromptForContextSnapshot(
      {},
      {
        platform: "linux",
        shell: "/bin/bash",
      },
    );

    expect(note).toContain("Runtime note:");
    expect(note).not.toContain("默认用简体中文进行自然语言回复");
    expect(note).not.toContain("use English for natural-language output");
  });
});

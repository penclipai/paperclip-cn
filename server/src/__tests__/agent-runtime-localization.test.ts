import { describe, expect, it } from "vitest";
import { resolveRuntimeLocalizationPrompt } from "../services/agent-runtime-localization.js";

describe("resolveRuntimeLocalizationPrompt", () => {
  it("returns a concise zh-CN note for Windows PowerShell", () => {
    const note = resolveRuntimeLocalizationPrompt({
      locale: "zh-CN",
      platform: "win32",
      shell: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    });

    expect(note).toContain("运行环境补充：");
    expect(note).toContain("默认用简体中文进行自然语言回复");
    expect(note).toContain("检测到的宿主环境：Windows PowerShell。");
    expect(note).toContain("curl --data-binary @payload.json");
    expect(note).not.toContain("Python / Node");
  });

  it("describes WSL precisely when the runtime is WSL", () => {
    const note = resolveRuntimeLocalizationPrompt({
      locale: "zh-CN",
      platform: "linux",
      shell: "/bin/bash",
      env: { WSL_DISTRO_NAME: "Ubuntu" },
      osRelease: "6.6.87.2-microsoft-standard-WSL2",
    });

    expect(note).toContain("检测到的宿主环境：WSL bash。");
    expect(note).toContain("不要把中文或其他非 ASCII JSON 直接内联到命令参数");
  });

  it("returns an English note with a detected POSIX shell label", () => {
    const note = resolveRuntimeLocalizationPrompt({
      locale: "en",
      platform: "darwin",
      shell: "/bin/zsh",
    });

    expect(note).toContain("Runtime note:");
    expect(note).toContain("use English for natural-language output");
    expect(note).toContain("Detected host runtime: zsh on darwin.");
    expect(note).toContain("curl --data-binary @payload.json");
    expect(note).not.toContain("Python / Node");
  });

  it("uses a neutral runtime note when no locale is provided", () => {
    const note = resolveRuntimeLocalizationPrompt({
      platform: "linux",
      shell: "/bin/bash",
    });

    expect(note).toContain("Runtime note:");
    expect(note).toContain("Detected host runtime: bash on linux.");
    expect(note).not.toContain("默认用简体中文进行自然语言回复");
    expect(note).not.toContain("use English for natural-language output");
  });
});

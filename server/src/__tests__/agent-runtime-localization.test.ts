import { describe, expect, it } from "vitest";
import {
  readRuntimeUiLocaleFromContextSnapshot,
  resolveEffectiveRuntimeUiLocale,
  resolveEffectiveRuntimeUiLocaleForContextSnapshot,
  resolveRuntimeLocalizationPrompt,
} from "../services/agent-runtime-localization.js";

describe("resolveEffectiveRuntimeUiLocale", () => {
  it("prefers the explicit request locale over the instance default", () => {
    expect(resolveEffectiveRuntimeUiLocale({
      requestedUiLocale: "en-US",
      runtimeDefaultLocale: "zh-CN",
    })).toBe("en");
  });

  it("falls back to the stored runtime locale when no explicit request locale was provided", () => {
    expect(resolveEffectiveRuntimeUiLocale({
      runtimeUiLocale: "en",
      runtimeDefaultLocale: "zh-CN",
    })).toBe("en");
  });

  it("uses the instance default locale when no request-scoped locale was provided", () => {
    expect(resolveEffectiveRuntimeUiLocale({
      runtimeDefaultLocale: "en",
    })).toBe("en");
  });

  it("keeps zh-CN as the final fallback", () => {
    expect(resolveEffectiveRuntimeUiLocale({})).toBe("zh-CN");
  });
});

describe("resolveEffectiveRuntimeUiLocaleForContextSnapshot", () => {
  it("reads runtimeUiLocale from the run context when present", () => {
    expect(
      resolveEffectiveRuntimeUiLocaleForContextSnapshot(
        { runtimeUiLocale: "en" },
        "zh-CN",
      ),
    ).toBe("en");
  });

  it("falls back to the instance default locale for contexts without a stored runtimeUiLocale", () => {
    expect(
      resolveEffectiveRuntimeUiLocaleForContextSnapshot(
        {},
        "en",
      ),
    ).toBe("en");
  });

  it("reads only the persisted runtime locale from the helper accessor", () => {
    expect(readRuntimeUiLocaleFromContextSnapshot({ runtimeUiLocale: "zh-CN" })).toBe("zh-CN");
    expect(readRuntimeUiLocaleFromContextSnapshot({ requestedUiLocale: "en" })).toBeNull();
  });
});

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
    expect(note).toContain("`penclip` 是当前唯一受支持的 Paperclip CLI 命令");
    expect(note).toContain("`paperclipai ...`");
    expect(note).toContain("POST / PATCH / PUT");
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
    expect(note).toContain("`penclip` is the only current Paperclip CLI command.");
    expect(note).toContain("`paperclipai ...`");
    expect(note).toContain("for any POST, PATCH, PUT");
    expect(note).toContain("curl --data-binary @payload.json");
    expect(note).not.toContain("Python / Node");
  });
});

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

    expect(note).toContain("## 语言与运行时契约");
    expect(note).toContain("所有面向用户的自然语言输出必须使用简体中文");
    expect(note).toContain("宿主环境：Windows PowerShell。");
    expect(note).toContain("CLI 契约：执行 Paperclip 命令一律使用 `penclip ...`");
    expect(note).toContain("`paperclipai ...`");
    expect(note).toContain("API 契约：任何带请求体的 Paperclip API 调用");
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

    expect(note).toContain("宿主环境：WSL bash。");
    expect(note).toContain("不要内联非 ASCII JSON");
  });

  it("returns an English note with a detected POSIX shell label", () => {
    const note = resolveRuntimeLocalizationPrompt({
      locale: "en",
      platform: "darwin",
      shell: "/bin/zsh",
    });

    expect(note).toContain("## Language and Runtime Contract");
    expect(note).toContain("all user-facing natural-language output must be in English");
    expect(note).toContain("Host runtime: zsh on darwin.");
    expect(note).toContain("CLI contract: use `penclip ...` for Paperclip commands");
    expect(note).toContain("`paperclipai ...`");
    expect(note).toContain("API contract: for any Paperclip API call with a request body");
    expect(note).toContain("curl --data-binary @payload.json");
    expect(note).not.toContain("Python / Node");
  });
});

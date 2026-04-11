import os from "node:os";
import {
  DEFAULT_UI_LOCALE,
  type UiLocale,
} from "@penclipai/shared";

type ResolveRuntimeLocalizationPromptInput = {
  locale: UiLocale;
  platform?: NodeJS.Platform;
  shell?: string | null;
  env?: NodeJS.ProcessEnv;
  osRelease?: string | null;
};

type RuntimeEnvironmentDescriptor = {
  labelZh: string;
  labelEn: string;
};

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseSupportedUiLocale(value: unknown): UiLocale | null {
  const candidate = readNonEmptyString(value);
  if (!candidate) return null;
  const normalized = candidate.trim().toLowerCase();
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("en")) return "en";
  return null;
}

function stripExecutableName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[\\/]/g);
  return parts[parts.length - 1] || trimmed;
}

function isPowerShellShell(shell: string | null, env: NodeJS.ProcessEnv): boolean {
  if (shell && /(^|[\\/])(pwsh|powershell)(\.exe)?$/i.test(shell)) {
    return true;
  }
  return Boolean(env.POWERSHELL_DISTRIBUTION_CHANNEL || env.PSExecutionPolicyPreference);
}

function isCmdShell(shell: string | null): boolean {
  return Boolean(shell && /(^|[\\/])cmd(\.exe)?$/i.test(shell));
}

function isWslRuntime(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, osRelease: string | null): boolean {
  if (platform !== "linux") return false;
  return Boolean(
    env.WSL_DISTRO_NAME
    || env.WSL_INTEROP
    || (osRelease && /microsoft/i.test(osRelease)),
  );
}

function resolveRuntimeEnvironment(
  input: ResolveRuntimeLocalizationPromptInput,
): RuntimeEnvironmentDescriptor {
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  const shell = input.shell?.trim()
    || env.SHELL?.trim()
    || env.ComSpec?.trim()
    || env.COMSPEC?.trim()
    || null;
  const shellName = stripExecutableName(shell);
  const osRelease = input.osRelease ?? (platform === "linux" ? os.release() : null);

  if (isWslRuntime(platform, env, osRelease)) {
    const wslShell = shellName ?? "sh";
    return {
      labelZh: `WSL ${wslShell}`,
      labelEn: `WSL ${wslShell}`,
    };
  }

  if (platform === "win32") {
    if (isPowerShellShell(shell, env)) {
      return {
        labelZh: "Windows PowerShell",
        labelEn: "Windows PowerShell",
      };
    }

    if (isCmdShell(shell)) {
      return {
        labelZh: "Windows cmd.exe",
        labelEn: "Windows cmd.exe",
      };
    }

    if (shellName) {
      return {
        labelZh: `Windows shell (${shellName})`,
        labelEn: `Windows shell (${shellName})`,
      };
    }

    return {
      labelZh: "Windows",
      labelEn: "Windows",
    };
  }

  if (shellName) {
    return {
      labelZh: `${shellName} on ${platform}`,
      labelEn: `${shellName} on ${platform}`,
    };
  }

  return {
    labelZh: platform,
    labelEn: platform,
  };
}

function buildZhCnRuntimeLocalizationPrompt(environment: RuntimeEnvironmentDescriptor): string {
  return [
    "## 语言与运行时契约",
    "- 输出契约：除非用户本轮明确要求其他语言，所有面向用户的自然语言输出必须使用简体中文；代码、命令、路径、API 字段名和日志原文保持原样。",
    `- 宿主环境：${environment.labelZh}。`,
    "- CLI 契约：执行 Paperclip 命令一律使用 `penclip ...`；仅在逐字引用用户文本、日志或历史文档时保留 `paperclipai ...`。",
    "- API 契约：任何带请求体的 Paperclip API 调用，必须先将 UTF-8 JSON 写入文件，再用 curl --data-binary @payload.json 发送；不要内联非 ASCII JSON。",
  ].join("\n");
}

function buildEnRuntimeLocalizationPrompt(environment: RuntimeEnvironmentDescriptor): string {
  return [
    "## Language and Runtime Contract",
    "- Output contract: unless the current user request explicitly asks for another language, all user-facing natural-language output must be in English. Keep code, commands, file paths, API field names, and raw logs verbatim.",
    `- Host runtime: ${environment.labelEn}.`,
    "- CLI contract: use `penclip ...` for Paperclip commands; keep `paperclipai ...` only in verbatim quotes from user text, logs, or historical docs.",
    "- API contract: for any Paperclip API call with a request body, write UTF-8 JSON to a file and send it with curl --data-binary @payload.json; do not inline non-ASCII JSON.",
  ].join("\n");
}

export function readRuntimeUiLocaleFromContextSnapshot(
  contextSnapshot: Record<string, unknown> | null | undefined,
): UiLocale | null {
  return parseSupportedUiLocale(contextSnapshot?.runtimeUiLocale);
}

export function resolveEffectiveRuntimeUiLocale(input: {
  requestedUiLocale?: unknown;
  runtimeUiLocale?: unknown;
  runtimeDefaultLocale?: unknown;
}): UiLocale {
  return (
    parseSupportedUiLocale(input.requestedUiLocale) ??
    parseSupportedUiLocale(input.runtimeUiLocale) ??
    parseSupportedUiLocale(input.runtimeDefaultLocale) ??
    DEFAULT_UI_LOCALE
  );
}

export function resolveEffectiveRuntimeUiLocaleForContextSnapshot(
  contextSnapshot: Record<string, unknown> | null | undefined,
  runtimeDefaultLocale?: unknown,
): UiLocale {
  return resolveEffectiveRuntimeUiLocale({
    requestedUiLocale: contextSnapshot?.requestedUiLocale,
    runtimeUiLocale: contextSnapshot?.runtimeUiLocale,
    runtimeDefaultLocale,
  });
}

export function resolveRuntimeLocalizationPrompt(
  input: ResolveRuntimeLocalizationPromptInput,
): string {
  const environment = resolveRuntimeEnvironment(input);
  return input.locale === "en"
    ? buildEnRuntimeLocalizationPrompt(environment)
    : buildZhCnRuntimeLocalizationPrompt(environment);
}

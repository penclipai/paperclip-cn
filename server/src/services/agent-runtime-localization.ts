import os from "node:os";
import {
  normalizeUiLocale,
  type UiLocale,
} from "@penclipai/shared";

type ResolveRuntimeLocalizationPromptInput = {
  locale?: string | null;
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
    "运行环境补充：",
    "- 除非用户明确要求其他语言，否则默认用简体中文进行自然语言回复；代码、命令、路径、API 字段名和日志原文保持原样。",
    `- 检测到的宿主环境：${environment.labelZh}。`,
    "- `penclip` 是当前唯一受支持的 Paperclip CLI 命令；如果提示词、示例或历史说明里出现 `paperclipai ...`，请改用等价的 `penclip ...` 命令。只有在逐字引用用户文本、日志或历史文档时，才保留 `paperclipai` 原文。",
    "- 如果通过 shell 调用 Paperclip API，只要是 POST / PATCH / PUT 或任何带请求体的命令，不要把中文或其他非 ASCII JSON 直接内联到命令参数；必须先把请求体写入 UTF-8 文件，再用 curl --data-binary @payload.json 发送。",
  ].join("\n");
}

function buildEnRuntimeLocalizationPrompt(environment: RuntimeEnvironmentDescriptor): string {
  return [
    "Runtime note:",
    "- Unless the user explicitly asks for another language, use English for natural-language output. Keep code, commands, file paths, API field names, and raw logs verbatim.",
    `- Detected host runtime: ${environment.labelEn}.`,
    "- `penclip` is the only current Paperclip CLI command. If a prompt, example, or historical instruction mentions `paperclipai ...`, execute the equivalent `penclip ...` command instead. Keep `paperclipai` only when quoting user text, logs, or historical docs verbatim.",
    "- If you call the Paperclip API from a shell, then for any POST, PATCH, PUT, or other request that sends a body, do not inline Chinese or other non-ASCII JSON into command arguments. Write the payload as UTF-8 and send it with curl --data-binary @payload.json.",
  ].join("\n");
}

function buildNeutralRuntimeLocalizationPrompt(environment: RuntimeEnvironmentDescriptor): string {
  return [
    "Runtime note:",
    `- Detected host runtime: ${environment.labelEn}.`,
    "- `penclip` is the only current Paperclip CLI command. If a prompt, example, or historical instruction mentions `paperclipai ...`, execute the equivalent `penclip ...` command instead. Keep `paperclipai` only when quoting user text, logs, or historical docs verbatim.",
    "- If you call the Paperclip API from a shell, then for any POST, PATCH, PUT, or other request that sends a body, do not inline Chinese or other non-ASCII JSON into command arguments. Write the payload as UTF-8 and send it with curl --data-binary @payload.json.",
  ].join("\n");
}

export function resolveRuntimeLocalizationPrompt(
  input: ResolveRuntimeLocalizationPromptInput = {},
): string {
  const locale = input.locale ? normalizeUiLocale(input.locale) as UiLocale : null;
  const environment = resolveRuntimeEnvironment(input);
  if (!locale) {
    return buildNeutralRuntimeLocalizationPrompt(environment);
  }
  return locale === "en"
    ? buildEnRuntimeLocalizationPrompt(environment)
    : buildZhCnRuntimeLocalizationPrompt(environment);
}

export function resolveRuntimeLocalizationPromptForContextSnapshot(
  contextSnapshot: Record<string, unknown> | null | undefined,
  runtimeInput: Omit<ResolveRuntimeLocalizationPromptInput, "locale"> = {},
): string {
  const requestedUiLocale = readNonEmptyString(contextSnapshot?.requestedUiLocale);
  return resolveRuntimeLocalizationPrompt({
    ...runtimeInput,
    ...(requestedUiLocale ? { locale: requestedUiLocale } : {}),
  });
}

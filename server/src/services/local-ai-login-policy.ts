import type { DeploymentMode, DeploymentExposure } from "@penclipai/shared";

export type LocalAiLoginPolicyOptions = {
  deploymentMode?: DeploymentMode;
  deploymentExposure?: DeploymentExposure;
  trustedLocalStdioRuntimeHost?: string | null;
  /** Test-only platform override; production uses the running process platform. */
  platform?: NodeJS.Platform;
};

const WINDOWS_LOCAL_AI_LOGIN_UNSUPPORTED = "Server-host subscription sign-in is unavailable on Windows because Paperclip cannot safely read isolated credential files on this platform. Choose a supported sign-in environment or use an API key.";
const HOSTED_LOCAL_AI_LOGIN_UNSUPPORTED = "Server-host subscription sign-in is unavailable on this hosted instance. Choose a supported sign-in environment or use an API key.";

/** Same server-host boundary as local stdio runtimes. */
export function localAiLoginUnavailableReason(options: LocalAiLoginPolicyOptions): string | null {
  if ((options.platform ?? process.platform) === "win32") return WINDOWS_LOCAL_AI_LOGIN_UNSUPPORTED;
  if (options.deploymentMode !== "authenticated" || options.deploymentExposure !== "public" || Boolean(
    options.trustedLocalStdioRuntimeHost ?? process.env.PAPERCLIP_TRUSTED_MCP_RUNTIME_HOST ?? process.env.PAPERCLIP_TOOL_RUNTIME_TRUSTED_HOST,
  )) return null;
  return HOSTED_LOCAL_AI_LOGIN_UNSUPPORTED;
}

export function supportsLocalAiLogin(options: LocalAiLoginPolicyOptions) {
  return localAiLoginUnavailableReason(options) === null;
}

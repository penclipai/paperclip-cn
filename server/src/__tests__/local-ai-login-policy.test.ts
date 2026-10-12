import { describe, expect, it } from "vitest";
import { localAiLoginUnavailableReason, supportsLocalAiLogin } from "../services/local-ai-login-policy.js";
describe("server-host subscription login policy", () => {
  it("permits private self-hosted instances and explicit trusted hosts", () => {
    expect(supportsLocalAiLogin({ platform: "linux", deploymentMode: "local_trusted", deploymentExposure: "private" })).toBe(true);
    expect(supportsLocalAiLogin({ platform: "darwin", deploymentMode: "authenticated", deploymentExposure: "private" })).toBe(true);
    expect(supportsLocalAiLogin({ platform: "linux", deploymentMode: "authenticated", deploymentExposure: "public", trustedLocalStdioRuntimeHost: "trusted-host" })).toBe(true);
    expect(supportsLocalAiLogin({ platform: "linux", deploymentMode: "authenticated", deploymentExposure: "public", trustedLocalStdioRuntimeHost: "" })).toBe(false);
  });
  it("rejects Windows before local credential login can be advertised", () => {
    const options = { platform: "win32" as const, deploymentMode: "local_trusted" as const, deploymentExposure: "private" as const, trustedLocalStdioRuntimeHost: "trusted-host" };
    expect(supportsLocalAiLogin(options)).toBe(false);
    expect(localAiLoginUnavailableReason(options)).toBe("Server-host subscription sign-in is unavailable on Windows because Paperclip cannot safely read isolated credential files on this platform. Choose a supported sign-in environment or use an API key.");
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";

const ensureDirectoryMock = vi.hoisted(() => vi.fn(async () => {}));
const ensureCommandMock = vi.hoisted(() => vi.fn(async () => {}));
const runProcessMock = vi.hoisted(() => vi.fn());
const prepareRuntimeMock = vi.hoisted(() => vi.fn());
const stageGrokHomeMock = vi.hoisted(() => vi.fn(async () => "/tmp/staged-grok-home"));
const resolveManagedGrokHomeMock = vi.hoisted(() => vi.fn(() => "/managed/company-1/grok-home"));
const grokHomeHasUsableAuthMock = vi.hoisted(() => vi.fn(async () => false));
const copyBackGrokAuthMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@penclipai/adapter-utils/execution-target", () => ({
  describeAdapterExecutionTarget: () => "local",
  ensureAdapterExecutionTargetCommandResolvable: ensureCommandMock,
  ensureAdapterExecutionTargetDirectory: ensureDirectoryMock,
  prepareAdapterExecutionTargetRuntime: prepareRuntimeMock,
  resolveAdapterExecutionTargetCwd: (_target: unknown, configuredCwd: string, fallbackCwd: string) =>
    configuredCwd || fallbackCwd,
  runAdapterExecutionTargetProcess: runProcessMock,
}));

vi.mock("./grok-home.js", () => ({
  stageGrokHomeForSync: stageGrokHomeMock,
  resolveManagedGrokHomeDir: resolveManagedGrokHomeMock,
  grokHomeHasUsableAuth: grokHomeHasUsableAuthMock,
}));
vi.mock("./grok-auth-copyback.js", () => ({ copyBackGrokAuth: copyBackGrokAuthMock }));

import { existsSync } from "node:fs";
import { parseGrokModelsOutput, testEnvironment } from "./test.js";

describe("parseGrokModelsOutput", () => {
  it("extracts auth state and models from `grok models` output", () => {
    expect(parseGrokModelsOutput([
      "You are logged in with grok.com.",
      "",
      "Default model: grok-build",
      "",
      "Available models:",
      "  * grok-build (default)",
      "  * grok-code",
    ].join("\n"))).toEqual({
      authenticated: true,
      defaultModel: "grok-build",
      models: ["grok-build", "grok-code"],
    });
  });
});

describe("grok_local testEnvironment", () => {
  beforeEach(() => {
    ensureDirectoryMock.mockClear();
    ensureCommandMock.mockClear();
    runProcessMock.mockReset();
    prepareRuntimeMock.mockReset();
    prepareRuntimeMock.mockResolvedValue({
      assetDirs: { home: "/sandbox/assets/home" },
      restoreWorkspace: async () => {},
    });
    stageGrokHomeMock.mockClear();
    resolveManagedGrokHomeMock.mockClear();
    grokHomeHasUsableAuthMock.mockReset();
    grokHomeHasUsableAuthMock.mockResolvedValue(false);
    copyBackGrokAuthMock.mockReset();
    copyBackGrokAuthMock.mockResolvedValue(undefined);
  });

  it("reports a healthy authenticated host with a working hello probe", async () => {
    runProcessMock
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: [
          "You are logged in with grok.com.",
          "",
          "Default model: grok-build",
          "",
          "Available models:",
          "  * grok-build (default)",
        ].join("\n"),
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: [
          JSON.stringify({ type: "text", data: "hello" }),
          JSON.stringify({ type: "end", stopReason: "EndTurn", sessionId: "sess-1", requestId: "req-1" }),
        ].join("\n"),
        stderr: "",
      });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: {
        command: "grok",
        cwd: "/tmp/project",
        model: "grok-build",
      },
    });

    expect(result.status).toBe("pass");
    expect(result.checks.map((check: { code: string }) => check.code)).toEqual(
      expect.arrayContaining([
        "grok_command_resolvable",
        "grok_models_probe_passed",
        "grok_model_configured",
        "grok_hello_probe_passed",
      ]),
    );
    expect(runProcessMock).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      null,
      "grok",
      expect.arrayContaining([
        "--output-format",
        "streaming-json",
        "--always-approve",
        "--permission-mode",
        "dontAsk",
        "--disable-web-search",
        "--single",
        "Respond with exactly hello.",
      ]),
      expect.any(Object),
    );
  });

  it("does not warn when the default-sentinel model is absent from the real model list", async () => {
    // Real grok never lists the "grok-build" sentinel; execute.ts never sends
    // it. The probe must treat the default as valid (info), not warn.
    runProcessMock
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: [
          "You are logged in with grok.com.",
          "",
          "Default model: grok-4.20-0309-non-reasoning",
          "",
          "Available models:",
          "  * grok-4.20-0309-non-reasoning (default)",
          "  * grok-4",
        ].join("\n"),
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: [
          JSON.stringify({ type: "text", data: "hello" }),
          JSON.stringify({ type: "end", stopReason: "EndTurn", sessionId: "s", requestId: "r" }),
        ].join("\n"),
        stderr: "",
      });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: { command: "grok", cwd: "/tmp/project" }, // no model → default sentinel
    });

    const codes = result.checks.map((check: { code: string }) => check.code);
    expect(codes).toContain("grok_model_configured");
    expect(codes).not.toContain("grok_model_not_found");
    expect(result.status).toBe("pass");
  });

  it("warns when an explicitly configured real model is not available", async () => {
    runProcessMock
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: [
          "You are logged in with grok.com.",
          "",
          "Default model: grok-4",
          "",
          "Available models:",
          "  * grok-4",
        ].join("\n"),
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: [
          JSON.stringify({ type: "text", data: "hello" }),
          JSON.stringify({ type: "end", stopReason: "EndTurn", sessionId: "s", requestId: "r" }),
        ].join("\n"),
        stderr: "",
      });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: { command: "grok", cwd: "/tmp/project", model: "grok-nonexistent" },
    });

    expect(result.checks.map((check: { code: string }) => check.code)).toContain("grok_model_not_found");
  });

  it("downgrades auth failures to warnings", async () => {
    runProcessMock
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "Not logged in. Run `grok login`.",
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "Not logged in. Run `grok login`.",
      });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: {
        command: "grok",
        cwd: "/tmp/project",
      },
    });

    expect(result.status).toBe("warn");
    expect(result.checks.map((check: { code: string }) => check.code)).toEqual(
      expect.arrayContaining([
        "grok_auth_required",
        "grok_hello_probe_auth_required",
      ]),
    );
  });

  it("emits the canonical adapter_auth_missing check for a sandbox target with missing authentication", async () => {
    // The user interface reads this neutral canonical code to decide login
    // eligibility for the sandbox; it does not parse the message text.
    runProcessMock
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "Not logged in. Run `grok login`.",
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "Not logged in. Run `grok login`.",
      });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: { command: "grok", cwd: "/tmp/project" },
      executionTarget: { kind: "remote", transport: "sandbox" } as never,
    });

    expect(result.checks.some((check: { code: string }) => check.code === "adapter_auth_missing")).toBe(
      true,
    );
  });

  it("stages the managed account through a host temp workspace, never the remote cwd", async () => {
    // The remote cwd is a path inside the sandbox. Handing it to the runtime
    // as `workspaceLocalDir` made the host-side ignore scan fail on a
    // directory that does not exist (git-ignore-scan-failed in production).
    let workspaceLocalDirAtCall: string | undefined;
    let workspaceExistedAtCall: boolean | undefined;
    prepareRuntimeMock.mockImplementationOnce(async (input: { workspaceLocalDir: string }) => {
      workspaceLocalDirAtCall = input.workspaceLocalDir;
      workspaceExistedAtCall = existsSync(input.workspaceLocalDir);
      return { assetDirs: { home: "/sandbox/assets/home" }, restoreWorkspace: async () => {} };
    });
    runProcessMock
      .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: "You are logged in with grok.com.\n\nDefault model: grok-4\n\nAvailable models:\n  * grok-4", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: [JSON.stringify({ type: "text", data: "hello" }), JSON.stringify({ type: "end", stopReason: "EndTurn", sessionId: "s", requestId: "r" })].join("\n"), stderr: "" });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: { command: "grok", cwd: "/sandbox/workspace", managedAiConnection: { provider: "xai" } },
      executionTarget: { kind: "remote", transport: "sandbox" } as never,
    });

    expect(prepareRuntimeMock).toHaveBeenCalledOnce();
    expect(prepareRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRemoteDir: "/sandbox/workspace" }),
    );
    expect(workspaceLocalDirAtCall).not.toBe("/sandbox/workspace");
    expect(workspaceExistedAtCall).toBe(true);
    // The staged home dir the runtime uploaded is what the probe must use.
    expect(runProcessMock.mock.calls[0]?.[4]).toMatchObject({ env: expect.objectContaining({ GROK_HOME: "/sandbox/assets/home" }) });
    expect(result.status).toBe("pass");
  });

  it("uses a usable company subscription home for both local probes", async () => {
    grokHomeHasUsableAuthMock.mockResolvedValue(true);
    runProcessMock
      .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: "You are logged in with grok.com.\n\nDefault model: grok-4\n\nAvailable models:\n  * grok-4", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: `${JSON.stringify({ type: "text", data: "hello" })}\n${JSON.stringify({ type: "end", stopReason: "EndTurn", sessionId: "s", requestId: "r" })}`, stderr: "" });

    await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: { command: "grok", cwd: "/tmp/project" },
    });

    expect(resolveManagedGrokHomeMock).toHaveBeenCalledWith(process.env, "company-1");
    expect(grokHomeHasUsableAuthMock).toHaveBeenCalledWith("/managed/company-1/grok-home");
    expect(runProcessMock.mock.calls[0]?.[4].env.GROK_HOME).toBe("/managed/company-1/grok-home");
    expect(runProcessMock.mock.calls[1]?.[4].env.GROK_HOME).toBe("/managed/company-1/grok-home");
  });

  it("preserves the host-login fallback when company subscription auth is missing", async () => {
    runProcessMock
      .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: "You are logged in with grok.com.\n\nDefault model: grok-4\n\nAvailable models:\n  * grok-4", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: `${JSON.stringify({ type: "text", data: "hello" })}\n${JSON.stringify({ type: "end", stopReason: "EndTurn", sessionId: "s", requestId: "r" })}`, stderr: "" });

    await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: { command: "grok", cwd: "/tmp/project" },
    });

    expect(runProcessMock.mock.calls[0]?.[4].env.GROK_HOME).toBeUndefined();
    expect(runProcessMock.mock.calls[1]?.[4].env.GROK_HOME).toBeUndefined();
    expect(stageGrokHomeMock).not.toHaveBeenCalled();
  });

  it("does not pin or stage a home for configured or inherited API-key diagnostics", async () => {
    const previousApiKey = process.env.XAI_API_KEY;
    try {
      process.env.XAI_API_KEY = "inherited-test-key";
      for (const configEnv of [{ XAI_API_KEY: "configured-test-key" }, {}]) {
        runProcessMock.mockReset()
          .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: "You are logged in with grok.com.\n\nDefault model: grok-4\n\nAvailable models:\n  * grok-4", stderr: "" })
          .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: `${JSON.stringify({ type: "text", data: "hello" })}\n${JSON.stringify({ type: "end", stopReason: "EndTurn", sessionId: "s", requestId: "r" })}`, stderr: "" });

        await testEnvironment({
          companyId: "company-1",
          adapterType: "grok_local",
          config: { command: "grok", cwd: "/tmp/project", env: configEnv },
        });

        expect(runProcessMock.mock.calls[0]?.[4].env.GROK_HOME).toBeUndefined();
      }
      expect(grokHomeHasUsableAuthMock).not.toHaveBeenCalled();
      expect(stageGrokHomeMock).not.toHaveBeenCalled();
    } finally {
      if (previousApiKey === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = previousApiKey;
    }
  });

  it("treats an explicit empty API key as a subscription override", async () => {
    const previousApiKey = process.env.XAI_API_KEY;
    try {
      process.env.XAI_API_KEY = "inherited-test-key";
      grokHomeHasUsableAuthMock.mockResolvedValue(true);
      runProcessMock
        .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: "You are logged in with grok.com.\n\nDefault model: grok-4\n\nAvailable models:\n  * grok-4", stderr: "" })
        .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: `${JSON.stringify({ type: "text", data: "hello" })}\n${JSON.stringify({ type: "end", stopReason: "EndTurn", sessionId: "s", requestId: "r" })}`, stderr: "" });

      await testEnvironment({
        companyId: "company-1",
        adapterType: "grok_local",
        config: { command: "grok", cwd: "/tmp/project", env: { XAI_API_KEY: "" } },
      });

      expect(runProcessMock.mock.calls[0]?.[4].env.GROK_HOME).toBe("/managed/company-1/grok-home");
    } finally {
      if (previousApiKey === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = previousApiKey;
    }
  });

  it("stages an unmanaged remote subscription home through the runtime", async () => {
    grokHomeHasUsableAuthMock.mockResolvedValue(true);
    prepareRuntimeMock.mockResolvedValue({
      assetDirs: { home: "/sandbox/assets/home" },
      restoreWorkspace: async () => {},
    });
    runProcessMock
      .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: "You are logged in with grok.com.\n\nDefault model: grok-4\n\nAvailable models:\n  * grok-4", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: `${JSON.stringify({ type: "text", data: "hello" })}\n${JSON.stringify({ type: "end", stopReason: "EndTurn", sessionId: "s", requestId: "r" })}`, stderr: "" });

    await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: { command: "grok", cwd: "/sandbox/workspace" },
      executionTarget: { kind: "remote", transport: "sandbox" } as never,
    });

    expect(stageGrokHomeMock).toHaveBeenCalledWith("/managed/company-1/grok-home", expect.any(Object));
    expect(prepareRuntimeMock).toHaveBeenCalledOnce();
    expect(runProcessMock.mock.calls[0]?.[4].env.GROK_HOME).toBe("/sandbox/assets/home");
  });

  it("reports copy-back failures without rejecting the completed remote diagnostic", async () => {
    let runtimeWorkspaceLocalDir = "";
    copyBackGrokAuthMock.mockRejectedValueOnce(new Error("fixture credential detail"));
    prepareRuntimeMock.mockImplementationOnce(async (input: {
      workspaceLocalDir: string;
      assets: Array<{ restore: (input: { assetDir: string; readFile: (path: string) => Promise<Buffer> }) => Promise<void> }>;
    }) => {
      runtimeWorkspaceLocalDir = input.workspaceLocalDir;
      return {
        assetDirs: { home: "/sandbox/assets/home" },
        restoreWorkspace: async () => input.assets[0]!.restore({
          assetDir: "/sandbox/assets/home",
          readFile: async () => Buffer.from("fixture", "utf8"),
        }),
      };
    });
    runProcessMock
      .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: "You are logged in with grok.com.\n\nDefault model: grok-4\n\nAvailable models:\n  * grok-4", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: `${JSON.stringify({ type: "text", data: "hello" })}\n${JSON.stringify({ type: "end", stopReason: "EndTurn", sessionId: "s", requestId: "r" })}`, stderr: "" });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: { command: "grok", cwd: "/sandbox/workspace" },
      executionTarget: { kind: "remote", transport: "sandbox" } as never,
    });

    expect(result.status).toBe("warn");
    expect(result.checks).toContainEqual(expect.objectContaining({
      code: "grok_auth_copyback_failed",
      level: "warn",
    }));
    expect(JSON.stringify(result.checks)).not.toContain("fixture credential detail");
    expect(copyBackGrokAuthMock).toHaveBeenCalledOnce();
    expect(existsSync(runtimeWorkspaceLocalDir)).toBe(false);
  });

  it("reports a failed runtime preparation as a check instead of crashing", async () => {
    prepareRuntimeMock.mockRejectedValueOnce(
      new Error("Workspace ignore scan failed: git-ignore-scan-failed"),
    );

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: { command: "grok", cwd: "/sandbox/workspace", managedAiConnection: { provider: "xai" } },
      executionTarget: { kind: "remote", transport: "sandbox" } as never,
    });

    expect(result.status).toBe("fail");
    const unprepared = result.checks.find((check: { code: string }) => check.code === "grok_environment_unprepared");
    expect(unprepared).toMatchObject({ level: "error" });
    // A failed staging means there is no environment worth probing.
    expect(runProcessMock).not.toHaveBeenCalled();
  });

  it("emits no adapter_auth_missing check for a local target with missing authentication", async () => {
    // The canonical check gates sandbox login eligibility only. A local target
    // has no sandbox login to offer, so the check must not appear.
    runProcessMock
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "Not logged in. Run `grok login`.",
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "Not logged in. Run `grok login`.",
      });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: { command: "grok", cwd: "/tmp/project" },
    });

    expect(result.checks.some((check: { code: string }) => check.code === "adapter_auth_missing")).toBe(
      false,
    );
  });
});

import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  EmbeddedPostgresRuntimeInstaller,
  ensureEmbeddedPostgresPlatformPackageReady,
  type EmbeddedPostgresRuntimeIssue,
  type EmbeddedPostgresRuntimeRepairResult,
} from "./embedded-postgres-runtime-installer.js";

function createMissingPlatformPackageError(specifier: string): Error & { code: string } {
  return Object.assign(
    new Error(`Cannot find package '${specifier}' imported from /tmp/embedded-postgres/binary.js`),
    { code: "ERR_MODULE_NOT_FOUND" },
  );
}

function createEligibleInstaller(
  overrides: Partial<ConstructorParameters<typeof EmbeddedPostgresRuntimeInstaller>[0]> = {},
): EmbeddedPostgresRuntimeInstaller {
  return new EmbeddedPostgresRuntimeInstaller({
    platform: "win32",
    arch: "x64",
    env: {
      npm_command: "exec",
      npm_config_cache: "/tmp/npm-cache",
      npm_execpath: "/usr/lib/node_modules/npm/bin/npm-cli.js",
    },
    resolveModule: () => "/tmp/npm-cache/_npx/run-123/node_modules/embedded-postgres/package.json",
    resolveModuleFrom: (_fromPath, specifier) => {
      throw createMissingPlatformPackageError(specifier);
    },
    readTextFile: async () => JSON.stringify({ version: "18.1.0-beta.16" }),
    isWritable: async () => true,
    ...overrides,
  });
}

describe("EmbeddedPostgresRuntimeInstaller", () => {
  it("maps supported platforms and architectures to the expected package name", () => {
    expect(new EmbeddedPostgresRuntimeInstaller({ platform: "win32", arch: "x64" }).getExpectedPlatformPackageName())
      .toBe("@embedded-postgres/windows-x64");
    expect(new EmbeddedPostgresRuntimeInstaller({ platform: "darwin", arch: "arm64" }).getExpectedPlatformPackageName())
      .toBe("@embedded-postgres/darwin-arm64");
    expect(new EmbeddedPostgresRuntimeInstaller({ platform: "darwin", arch: "x64" }).getExpectedPlatformPackageName())
      .toBe("@embedded-postgres/darwin-x64");
    expect(new EmbeddedPostgresRuntimeInstaller({ platform: "linux", arch: "arm64" }).getExpectedPlatformPackageName())
      .toBe("@embedded-postgres/linux-arm64");
    expect(new EmbeddedPostgresRuntimeInstaller({ platform: "linux", arch: "ppc64" }).getExpectedPlatformPackageName())
      .toBe("@embedded-postgres/linux-ppc64");
    expect(new EmbeddedPostgresRuntimeInstaller({ platform: "win32", arch: "arm64" }).getExpectedPlatformPackageName())
      .toBeNull();
  });

  it("returns null when the current platform package is already installed", async () => {
    const installer = createEligibleInstaller({
      resolveModuleFrom: () => "/tmp/npm-cache/_npx/run-123/node_modules/@embedded-postgres/windows-x64/index.js",
    });

    await expect(installer.inspectRuntime()).resolves.toBeNull();
  });

  it("detects a missing current-platform package and enables auto-repair inside npm exec cache", async () => {
    const installer = createEligibleInstaller();
    const installRoot = path.resolve("/tmp/npm-cache/_npx/run-123");

    const issue = await installer.inspectRuntime();

    expect(issue).toEqual({
      packageName: "@embedded-postgres/windows-x64",
      packageSpecifier: "@embedded-postgres/windows-x64",
      packageVersion: "18.1.0-beta.16",
      installRoot,
      eligibleForAutoRepair: true,
    });
  });

  it("keeps manual repair mode when the install root is outside the npm exec cache", async () => {
    const installer = createEligibleInstaller({
      resolveModule: () => "/tmp/local-install/node_modules/embedded-postgres/package.json",
    });

    const issue = await installer.inspectRuntime();

    expect(issue).not.toBeNull();
    expect(issue?.eligibleForAutoRepair).toBe(false);
    expect(issue?.reason).toContain("temporary npx/npm exec environments");
  });

  it("returns null when embedded-postgres itself is not installed", async () => {
    const installer = createEligibleInstaller({
      resolveModule: () => {
        throw createMissingPlatformPackageError("embedded-postgres/package.json");
      },
    });

    await expect(installer.inspectRuntime()).resolves.toBeNull();
  });

  it("builds the expected npm install command and only attempts the repair once per process", async () => {
    const installRoot = path.resolve("/tmp/npm-cache/_npx/run-123");
    const runCommand = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      signal: null,
    }));
    const installer = createEligibleInstaller({ runCommand });
    const issue = await installer.inspectRuntime();

    expect(issue).not.toBeNull();
    await expect(installer.attemptRepair(issue!)).resolves.toEqual({ kind: "repaired" });
    await expect(installer.attemptRepair(issue!)).resolves.toEqual({
      kind: "skipped",
      reason: "Automatic repair already ran once in this process.",
    });

    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith(
      process.execPath,
      [
        "/usr/lib/node_modules/npm/bin/npm-cli.js",
        "install",
        "--prefix",
        installRoot,
        "--no-save",
        "--no-package-lock",
        "--no-audit",
        "--fund=false",
        "@embedded-postgres/windows-x64@18.1.0-beta.16",
      ],
      expect.objectContaining({
        cwd: installRoot,
        env: expect.objectContaining({
          npm_command: "exec",
          npm_execpath: "/usr/lib/node_modules/npm/bin/npm-cli.js",
        }),
      }),
    );
  });

  it("surfaces a clearer manual-repair message when automatic repair is unavailable", async () => {
    const installer = createEligibleInstaller({
      env: {
        npm_command: "install",
        npm_config_cache: "/tmp/npm-cache",
        npm_execpath: "/usr/lib/node_modules/npm/bin/npm-cli.js",
      },
    });
    const issue = await installer.inspectRuntime();

    expect(issue).not.toBeNull();
    const enhancedError = installer.createManualRepairError(issue!);

    expect(enhancedError.message).toContain("Missing embedded-postgres platform package @embedded-postgres/windows-x64@18.1.0-beta.16.");
    expect(enhancedError.message).toContain("temporary npx/npm exec environments");
    expect(enhancedError.message).toContain("Install the missing package into the same runtime environment and retry.");
  });
});

describe("ensureEmbeddedPostgresPlatformPackageReady", () => {
  it("does nothing when the runtime is already ready", async () => {
    const inspectRuntime = vi.fn(async () => null);
    const attemptRepair = vi.fn();
    const createManualRepairError = vi.fn();

    await expect(
      ensureEmbeddedPostgresPlatformPackageReady({
        installer: {
          inspectRuntime,
          attemptRepair,
          createManualRepairError,
        },
      }),
    ).resolves.toBeUndefined();

    expect(inspectRuntime).toHaveBeenCalledTimes(1);
    expect(attemptRepair).not.toHaveBeenCalled();
    expect(createManualRepairError).not.toHaveBeenCalled();
  });

  it("repairs the missing platform package before embedded-postgres loads", async () => {
    const issue: EmbeddedPostgresRuntimeIssue = {
      packageName: "@embedded-postgres/windows-x64",
      packageSpecifier: "@embedded-postgres/windows-x64",
      packageVersion: "18.1.0-beta.16",
      installRoot: "/tmp/npm-cache/_npx/run-123",
      eligibleForAutoRepair: true,
    };
    const inspectRuntime = vi.fn(async () => issue);
    const attemptRepair = vi.fn(async (): Promise<EmbeddedPostgresRuntimeRepairResult> => ({ kind: "repaired" }));
    const createManualRepairError = vi.fn();
    const logger = { info: vi.fn(), warn: vi.fn() };

    await expect(
      ensureEmbeddedPostgresPlatformPackageReady({
        installer: {
          inspectRuntime,
          attemptRepair,
          createManualRepairError,
        },
        logger,
      }),
    ).resolves.toBeUndefined();

    expect(attemptRepair).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      "Installed @embedded-postgres/windows-x64@18.1.0-beta.16 before loading embedded PostgreSQL.",
    );
    expect(createManualRepairError).not.toHaveBeenCalled();
  });

  it("throws an enhanced error when the repair cannot run", async () => {
    const issue: EmbeddedPostgresRuntimeIssue = {
      packageName: "@embedded-postgres/windows-x64",
      packageSpecifier: "@embedded-postgres/windows-x64",
      packageVersion: "18.1.0-beta.16",
      installRoot: null,
      eligibleForAutoRepair: false,
      reason: "Automatic repair only runs inside temporary npx/npm exec environments.",
    };
    const inspectRuntime = vi.fn(async () => issue);
    const attemptRepair = vi.fn(async () => ({
      kind: "skipped" as const,
      reason: "Automatic repair only runs inside temporary npx/npm exec environments.",
    }));
    const createManualRepairError = vi.fn(
      (targetIssue: EmbeddedPostgresRuntimeIssue, repairResult?: EmbeddedPostgresRuntimeRepairResult) =>
        new Error(`${targetIssue.packageName} | ${repairResult?.kind ?? "none"}`),
    );

    await expect(
      ensureEmbeddedPostgresPlatformPackageReady({
        installer: {
          inspectRuntime,
          attemptRepair,
          createManualRepairError,
        },
      }),
    ).rejects.toThrow("@embedded-postgres/windows-x64 | skipped");

    expect(attemptRepair).toHaveBeenCalledTimes(1);
    expect(createManualRepairError).toHaveBeenCalledTimes(1);
  });
});

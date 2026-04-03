import { spawn } from "node:child_process";
import { access, constants, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

type ModuleResolver = (specifier: string) => string;
type ScopedModuleResolver = (fromPath: string, specifier: string) => string;
type FileReader = (filePath: string) => Promise<string>;
type WritabilityChecker = (targetPath: string) => Promise<boolean>;
type CommandRunner = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
  },
) => Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
  error?: unknown;
}>;

export type EmbeddedPostgresRuntimeLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

export type EmbeddedPostgresConstructorOptions = {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
  initdbFlags?: string[];
  onLog?: (message: unknown) => void;
  onError?: (message: unknown) => void;
};

export type EmbeddedPostgresCtor = new (opts: EmbeddedPostgresConstructorOptions) => EmbeddedPostgresInstance;

export type EmbeddedPostgresRuntimeIssue = {
  packageName: string;
  packageSpecifier: string;
  packageVersion: string | null;
  installRoot: string | null;
  eligibleForAutoRepair: boolean;
  reason?: string;
};

export type EmbeddedPostgresRuntimeRepairResult =
  | { kind: "repaired" }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; reason: string };

type EmbeddedPostgresRuntimeInstallerOptions = {
  arch?: string;
  env?: NodeJS.ProcessEnv;
  isWritable?: WritabilityChecker;
  logger?: EmbeddedPostgresRuntimeLogger;
  platform?: NodeJS.Platform;
  readTextFile?: FileReader;
  resolveModule?: ModuleResolver;
  resolveModuleFrom?: ScopedModuleResolver;
  runCommand?: CommandRunner;
};

const MODULE_NOT_FOUND_CODES = new Set(["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"]);
const moduleRequire = createRequire(import.meta.url);

function defaultResolveModule(specifier: string): string {
  return moduleRequire.resolve(specifier);
}

function defaultResolveModuleFrom(fromPath: string, specifier: string): string {
  return createRequire(fromPath).resolve(specifier);
}

async function defaultReadTextFile(filePath: string): Promise<string> {
  return await readFile(filePath, "utf8");
}

async function defaultIsWritable(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function defaultRunCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
  },
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
  error?: unknown;
}> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let childError: unknown;

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      childError = error;
    });
    child.on("close", (exitCode, signal) => {
      resolve({
        exitCode,
        stdout,
        stderr,
        signal,
        ...(childError === undefined ? {} : { error: childError }),
      });
    });
  });
}

function trimTrailingPeriod(input: string): string {
  return input.endsWith(".") ? input.slice(0, -1) : input;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.length > 0 ? error.message : error.name;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isModuleNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code === "string" && MODULE_NOT_FOUND_CODES.has(code)) return true;
  return error.message.includes("Cannot find package") || error.message.includes("Cannot find module");
}

function getExpectedPlatformPackageName(platform: NodeJS.Platform, arch: string): string | null {
  switch (platform) {
    case "darwin":
      if (arch === "arm64") return "@embedded-postgres/darwin-arm64";
      if (arch === "x64") return "@embedded-postgres/darwin-x64";
      return null;
    case "linux":
      if (arch === "arm") return "@embedded-postgres/linux-arm";
      if (arch === "arm64") return "@embedded-postgres/linux-arm64";
      if (arch === "ia32") return "@embedded-postgres/linux-ia32";
      if (arch === "ppc64") return "@embedded-postgres/linux-ppc64";
      if (arch === "x64") return "@embedded-postgres/linux-x64";
      return null;
    case "win32":
      if (arch === "x64") return "@embedded-postgres/windows-x64";
      return null;
    default:
      return null;
  }
}

function normalizeForComparison(targetPath: string, platform: NodeJS.Platform): string {
  const normalized = path.resolve(targetPath);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isPathInside(targetPath: string, parentPath: string, platform: NodeJS.Platform): boolean {
  const normalizedTarget = normalizeForComparison(targetPath, platform);
  const normalizedParent = normalizeForComparison(parentPath, platform);
  const relativePath = path.relative(normalizedParent, normalizedTarget);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function findInstallRootFromPackageJsonPath(packageJsonPath: string): string | null {
  let currentPath = path.dirname(path.resolve(packageJsonPath));
  while (true) {
    if (path.basename(currentPath) === "node_modules") {
      return path.dirname(currentPath);
    }
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }
    currentPath = parentPath;
  }
}

function formatPackageLabel(issue: Pick<EmbeddedPostgresRuntimeIssue, "packageName" | "packageVersion">): string {
  return issue.packageVersion ? `${issue.packageName}@${issue.packageVersion}` : issue.packageName;
}

export class EmbeddedPostgresRuntimeInstaller {
  private readonly arch: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly isWritable: WritabilityChecker;
  private readonly logger?: EmbeddedPostgresRuntimeLogger;
  private readonly platform: NodeJS.Platform;
  private readonly readTextFile: FileReader;
  private readonly resolveModule: ModuleResolver;
  private readonly resolveModuleFrom: ScopedModuleResolver;
  private readonly runCommand: CommandRunner;
  private readonly attemptedInstalls = new Set<string>();

  constructor(options: EmbeddedPostgresRuntimeInstallerOptions = {}) {
    this.arch = options.arch ?? os.arch();
    this.env = options.env ?? process.env;
    this.isWritable = options.isWritable ?? defaultIsWritable;
    this.logger = options.logger;
    this.platform = options.platform ?? process.platform;
    this.readTextFile = options.readTextFile ?? defaultReadTextFile;
    this.resolveModule = options.resolveModule ?? defaultResolveModule;
    this.resolveModuleFrom = options.resolveModuleFrom ?? defaultResolveModuleFrom;
    this.runCommand = options.runCommand ?? defaultRunCommand;
  }

  getExpectedPlatformPackageName(): string | null {
    return getExpectedPlatformPackageName(this.platform, this.arch);
  }

  async inspectRuntime(): Promise<EmbeddedPostgresRuntimeIssue | null> {
    const expectedPackageName = this.getExpectedPlatformPackageName();
    if (!expectedPackageName) {
      return null;
    }

    let embeddedPostgresPackageJsonPath: string;
    try {
      embeddedPostgresPackageJsonPath = this.resolveModule("embedded-postgres/package.json");
    } catch {
      return null;
    }

    try {
      this.resolveModuleFrom(embeddedPostgresPackageJsonPath, expectedPackageName);
      return null;
    } catch (error) {
      if (!isModuleNotFoundError(error)) {
        return null;
      }
    }

    const issue: EmbeddedPostgresRuntimeIssue = {
      packageName: expectedPackageName,
      packageSpecifier: expectedPackageName,
      packageVersion: null,
      installRoot: null,
      eligibleForAutoRepair: false,
    };

    try {
      const rawPackageJson = await this.readTextFile(embeddedPostgresPackageJsonPath);
      const parsedPackageJson = JSON.parse(rawPackageJson) as { version?: unknown };
      if (typeof parsedPackageJson.version === "string" && parsedPackageJson.version.trim().length > 0) {
        issue.packageVersion = parsedPackageJson.version;
      }
    } catch {
      issue.reason = "Could not read the embedded-postgres package version.";
      return issue;
    }

    issue.installRoot = findInstallRootFromPackageJsonPath(embeddedPostgresPackageJsonPath);
    if (!issue.installRoot) {
      issue.reason = "Could not determine the embedded-postgres installation root.";
      return issue;
    }

    if (this.env.npm_command !== "exec") {
      issue.reason = "Automatic repair only runs inside temporary npx/npm exec environments.";
      return issue;
    }

    const npmCache = this.env.npm_config_cache;
    if (typeof npmCache !== "string" || npmCache.trim().length === 0) {
      issue.reason = "Automatic repair requires npm_config_cache to locate the npm exec cache.";
      return issue;
    }

    const npxCacheRoot = path.resolve(npmCache, "_npx");
    if (!isPathInside(issue.installRoot, npxCacheRoot, this.platform)) {
      issue.reason = "Automatic repair only runs inside temporary npx/npm exec environments.";
      return issue;
    }

    if (typeof this.env.npm_execpath !== "string" || this.env.npm_execpath.trim().length === 0) {
      issue.reason = "Automatic repair requires npm_execpath so Paperclip can invoke npm.";
      return issue;
    }

    if (!(await this.isWritable(issue.installRoot))) {
      issue.reason = `The npm exec cache directory is not writable: ${issue.installRoot}`;
      return issue;
    }

    issue.eligibleForAutoRepair = true;
    return issue;
  }

  async attemptRepair(issue: EmbeddedPostgresRuntimeIssue): Promise<EmbeddedPostgresRuntimeRepairResult> {
    if (!issue.eligibleForAutoRepair) {
      return { kind: "skipped", reason: issue.reason ?? "Automatic repair is not available for this runtime." };
    }
    if (!issue.installRoot) {
      return { kind: "skipped", reason: "Automatic repair could not determine the npm exec cache directory." };
    }
    if (!issue.packageVersion) {
      return { kind: "skipped", reason: "Automatic repair could not determine the embedded-postgres package version." };
    }

    const attemptKey = `${issue.installRoot}::${issue.packageName}@${issue.packageVersion}`;
    if (this.attemptedInstalls.has(attemptKey)) {
      return { kind: "skipped", reason: "Automatic repair already ran once in this process." };
    }
    this.attemptedInstalls.add(attemptKey);

    const npmExecPath = this.env.npm_execpath?.trim();
    if (!npmExecPath) {
      return { kind: "skipped", reason: "Automatic repair could not find the npm CLI entrypoint." };
    }

    const packageLabel = `${issue.packageName}@${issue.packageVersion}`;
    this.logger?.warn?.(
      `Missing embedded-postgres platform package ${packageLabel}; attempting one-time runtime install.`,
    );

    const installArgs = [
      npmExecPath,
      "install",
      "--prefix",
      issue.installRoot,
      "--no-save",
      "--no-package-lock",
      "--no-audit",
      "--fund=false",
      packageLabel,
    ];

    let result: Awaited<ReturnType<CommandRunner>>;
    try {
      result = await this.runCommand(process.execPath, installArgs, {
        cwd: issue.installRoot,
        env: this.env,
      });
    } catch (error) {
      return {
        kind: "failed",
        reason: trimTrailingPeriod(formatUnknownError(error)),
      };
    }

    if (result.exitCode === 0) {
      return { kind: "repaired" };
    }

    const details = [result.stderr.trim(), result.stdout.trim(), formatUnknownError(result.error)]
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    return {
      kind: "failed",
      reason: details.length > 0
        ? trimTrailingPeriod(details[0])
        : `npm exited with code ${result.exitCode ?? "unknown"}`,
    };
  }

  createManualRepairError(
    issue: EmbeddedPostgresRuntimeIssue,
    repairResult?: EmbeddedPostgresRuntimeRepairResult,
  ): Error {
    const messageParts = [`Missing embedded-postgres platform package ${formatPackageLabel(issue)}.`];

    if (repairResult?.kind === "failed") {
      messageParts.push(`Automatic runtime repair failed: ${trimTrailingPeriod(repairResult.reason)}.`);
    } else if (repairResult?.kind === "skipped" && repairResult.reason.trim().length > 0) {
      messageParts.push(`${trimTrailingPeriod(repairResult.reason)}.`);
    } else if (issue.reason && issue.reason.trim().length > 0) {
      messageParts.push(`${trimTrailingPeriod(issue.reason)}.`);
    }

    messageParts.push("Install the missing package into the same runtime environment and retry.");
    return new Error(messageParts.join(" "));
  }
}

export async function ensureEmbeddedPostgresPlatformPackageReady(
  options: {
    installer?: Pick<EmbeddedPostgresRuntimeInstaller, "attemptRepair" | "createManualRepairError" | "inspectRuntime">;
    logger?: EmbeddedPostgresRuntimeLogger;
    successMessage?: string;
  } = {},
): Promise<void> {
  const installer = options.installer ?? new EmbeddedPostgresRuntimeInstaller({ logger: options.logger });
  const issue = await installer.inspectRuntime();
  if (!issue) {
    return;
  }

  const repairResult = await installer.attemptRepair(issue);
  if (repairResult.kind === "repaired") {
    options.logger?.info?.(
      options.successMessage
        ?? `Installed ${formatPackageLabel(issue)} before loading embedded PostgreSQL.`,
    );
    return;
  }

  throw installer.createManualRepairError(issue, repairResult);
}

export async function loadEmbeddedPostgresCtor(
  options: {
    logger?: EmbeddedPostgresRuntimeLogger;
    missingDependencyMessage?: string;
    successMessage?: string;
  } = {},
): Promise<EmbeddedPostgresCtor> {
  await ensureEmbeddedPostgresPlatformPackageReady({
    logger: options.logger,
    successMessage: options.successMessage,
  });
  try {
    const mod = await import("embedded-postgres");
    return mod.default as EmbeddedPostgresCtor;
  } catch {
    throw new Error(
      options.missingDependencyMessage
        ?? "Embedded PostgreSQL support requires dependency `embedded-postgres`. Reinstall dependencies and try again.",
    );
  }
}

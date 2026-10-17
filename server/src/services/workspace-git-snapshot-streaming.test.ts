import { execFile, type ExecFileOptions } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { disposeGitWorkspaceSnapshot, readGitWorkspaceSnapshot, runLocalGit, setExpensiveWorkspaceGitExecutor, type GitWorkspaceSnapshot } from "@penclipai/adapter-utils/git-workspace-sync";
import { isPathManifest, workspacePaths } from "@penclipai/adapter-utils/workspace-manifest";
import { prepareSandboxManagedRuntime, type PreparedSandboxManagedRuntime, type SandboxManagedRuntimeClient } from "@penclipai/adapter-utils/sandbox-managed-runtime";
import { prepareTestPosixShell } from "@penclipai/adapter-utils/test-fixtures/posix-shell";
import { createWorkspaceGitOperationScheduler } from "./workspace-git-operation-scheduler.js";

const exec = promisify(execFile);
async function execute(command: string, args: string[], options: ExecFileOptions = {}): Promise<void> {
  try { await exec(command, args, options); }
  catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "");
    throw new Error(`Fixture command failed: ${String(error)}\n${stderr.slice(-8192)}`, { cause: error });
  }
}
async function executeTestPosixShell(command: string, options: ExecFileOptions = {}): Promise<void> {
  const shell = prepareTestPosixShell({ command: "sh", args: ["-c", command], env: process.env });
  await execute(shell.command, shell.args, { ...options, env: shell.env });
}
const directories: string[] = [];
const snapshots: GitWorkspaceSnapshot[] = [];
const runtimes: PreparedSandboxManagedRuntime[] = [];
afterEach(async () => {
  setExpensiveWorkspaceGitExecutor(null);
  for (const runtime of runtimes.splice(0)) await runtime.cleanupWorkspaceSnapshot();
  for (const snapshot of snapshots.splice(0)) await disposeGitWorkspaceSnapshot(snapshot);
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
}, 60_000);

type PostUploadCommandType = "archive_extract" | "deleted_paths" | "other";

function postUploadCommandType(command: string): PostUploadCommandType {
  if (command.includes("xargs -0") && command.includes("rm -rf --")) return "deleted_paths";
  if (command.includes("tar -xf")) return "archive_extract";
  return "other";
}

function logPostUploadTiming(input: {
  stage: "start" | "complete" | "failed";
  type: PostUploadCommandType;
  count: number;
  elapsedMs: number;
}): void {
  // Keep timeout diagnostics inspectable without exposing the command, path, or environment.
  console.info("[workspace-git-streaming] post-upload", JSON.stringify(input));
}

function localClient(commands: string[]): SandboxManagedRuntimeClient {
  return {
    makeDir: async (dir) => { await fs.mkdir(dir, { recursive: true }); },
    writeFile: async (file, bytes) => { await fs.writeFile(file, Buffer.from(bytes)); },
    readFile: async (file) => fs.readFile(file),
    listFiles: async (dir) => fs.readdir(dir),
    remove: async (file) => { await fs.rm(file, { recursive: true, force: true }); },
    run: async (command) => { await executeTestPosixShell(command); },
    syncIn: async (operations) => {
      for (const operation of operations) {
        for (const mapping of operation.files) {
          await fs.mkdir(path.dirname(mapping.targetPath), { recursive: true });
          await fs.copyFile(mapping.sourcePath, mapping.targetPath);
        }
        for (const [index, command] of (operation.postUploadCommands ?? []).entries()) {
          const type = postUploadCommandType(command.command);
          const count = index + 1;
          const startedAt = performance.now();
          logPostUploadTiming({ stage: "start", type, count, elapsedMs: 0 });
          commands.push(command.command);
          try {
            await executeTestPosixShell(command.command, { maxBuffer: 64 * 1024 });
            logPostUploadTiming({ stage: "complete", type, count, elapsedMs: performance.now() - startedAt });
          } catch (error) {
            logPostUploadTiming({ stage: "failed", type, count, elapsedMs: performance.now() - startedAt });
            throw error;
          }
        }
      }
      return { operations: [] };
    },
  };
}

// Windows NTFS adds per-file overhead across fixture creation, staging, and four
// Git scan/deletion passes. This real 32 MiB fixture needs its own bounded budget.
const realGitTimeoutMs = process.platform === "win32" ? 600_000 : process.platform === "darwin" ? 300_000 : 180_000;
it("streams and stages all four real Git filename lanes above 32 MiB through the shared scheduler", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "pc-stream-git-")));
  directories.push(root);
  const repo = path.join(root, "repo");
  await fs.mkdir(repo);
  const env = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_COMMITTER_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.test", GIT_COMMITTER_EMAIL: "test@example.test" };
  const git = (args: string[]) => runLocalGit(repo, args, { env, timeout: 120_000, maxBuffer: 64 * 1024 });
  await git(["init"]);
  // A host-wide excludes file can contain `*.js`, which would erase every
  // large fixture record. Pin this real repository to its own empty excludes
  // file so all four Git lanes observe the fixture rather than host policy.
  const excludesFile = path.join(root, "fixture-global-excludes");
  await fs.writeFile(excludesFile, "");
  await git(["config", "core.excludesFile", excludesFile]);
  // The 32 MiB lane deliberately uses deep, long paths; Git for Windows
  // otherwise silently omits them under its default legacy path policy.
  await git(["config", "core.longpaths", "true"]);
  await git(["commit", "--allow-empty", "-qm", "fixture"]);
  // Windows uses fewer, deeper ASCII parent paths to keep each real Git lane
  // above 32 MiB; POSIX keeps its original 40,000-file fixture.
  const fixtureCount = process.platform === "win32" ? 9_000 : 40_000;
  const fixtureSegments = Array.from(
    { length: process.platform === "win32" ? 17 : 3 },
    () => "nested-".repeat(30),
  );
  const parent = path.join(repo, ...fixtureSegments, "storybook-output");
  await fs.mkdir(parent, { recursive: true });
  const fileName = (index: number) => `${"asset-".repeat(36)}${index}.js`;
  const writeFiles = async (content: string) => {
    for (let start = 0; start < fixtureCount; start += 100) {
      await Promise.all(Array.from({ length: Math.min(100, fixtureCount - start) }, (_, offset) => fs.writeFile(path.join(parent, fileName(start + offset)), content)));
    }
  };
  await writeFiles("base");
  // Keep every Git lane adversarial on Windows without requesting names the
  // native filesystem cannot create (newline, `?`, and `*`). The Git-provided
  // GNU tar stages this Unicode name through the NUL list on Windows.
  const unusual = process.platform === "win32"
    ? [" leading-space", "-option", "apostrophe-'s", "snow-雪-💾", "wild[brackets]$dollar", "braces{literal}"]
    : [" space ", "line\nbreak", "-option", "雪-💾", "wild[?]*"];
  for (const name of unusual) await fs.writeFile(path.join(repo, name), name);
  const scheduler = createWorkspaceGitOperationScheduler({ concurrency: 2, queueCapacity: 8 });
  const bindScheduler = () => setExpensiveWorkspaceGitExecutor((input) => scheduler.run({
    workspacePath: input.localDir, args: input.args, operation: input.operation,
    timeoutMs: input.timeout, onStdout: input.onStdout, signal: input.signal, cacheTtlMs: 0,
    maxStdoutBytes: 1, maxStderrBytes: 64 * 1024,
  }));
  const scan = async () => {
    const result = await readGitWorkspaceSnapshot(repo);
    expect(result).not.toBeNull();
    snapshots.push(result!);
    expect(JSON.stringify(result).length).toBeLessThan(4096);
    return result!;
  };
  const checkLargeLane = (paths: GitWorkspaceSnapshot["overlayPaths"]) => {
    let count = 0, bytes = 0;
    for (const relative of workspacePaths(paths)) {
      if (!relative.endsWith(".js")) continue;
      count++;
      bytes += Buffer.byteLength(relative) + 1;
    }
    const relativeParent = [...fixtureSegments, "storybook-output"].join("/");
    const expectedBytes = Array.from({ length: fixtureCount }, (_, index) =>
      Buffer.byteLength(`${relativeParent}/${fileName(index)}\0`),
    ).reduce((total, value) => total + value, 0);
    expect(count).toBe(fixtureCount);
    expect(bytes).toBe(expectedBytes);
    expect(bytes).toBeGreaterThan(32 * 1024 * 1024);
  };
  // Standalone callers must use the same streaming semantics.
  setExpensiveWorkspaceGitExecutor(null);
  const standalone = await scan();
  checkLargeLane(standalone.overlayPaths);
  await disposeGitWorkspaceSnapshot(standalone);
  bindScheduler();
  const snapshot = await scan();
  checkLargeLane(snapshot.overlayPaths);
  await fs.writeFile(path.join(parent, "late.js"), "must not stage");
  const commands: string[] = [];
  const remote = path.join(root, "remote");
  const stage = async (gitSnapshot: GitWorkspaceSnapshot) => {
    const runtime = await prepareSandboxManagedRuntime({
      spec: { transport: "sandbox", provider: "test", sandboxId: "test", remoteCwd: remote, timeoutMs: 120_000, apiKey: null },
      client: localClient(commands), adapterKey: "stream-test", workspaceLocalDir: repo, workspaceGitSnapshot: gitSnapshot,
    });
    runtimes.push(runtime);
    return runtime;
  };
  const runtime = await stage(snapshot);
  const remoteParent = path.join(remote, path.relative(repo, parent));
  const stagedFiles: string[] = [];
  for await (const entry of await fs.opendir(remoteParent)) stagedFiles.push(entry.name);
  for (let start = 0; start < stagedFiles.length; start += 100) {
    await Promise.all(stagedFiles.slice(start, start + 100).map(async (name) => {
      expect(await fs.readFile(path.join(remoteParent, name), "utf8")).toBe("base");
    }));
  }
  expect(stagedFiles).toHaveLength(fixtureCount);
  for (const name of unusual) expect(await fs.readFile(path.join(remote, name), "utf8")).toBe(name);
  const manifestFile = isPathManifest(snapshot.overlayPaths) ? snapshot.overlayPaths.filePath : "";
  await runtime.cleanupWorkspaceSnapshot();
  await expect(fs.stat(manifestFile)).rejects.toMatchObject({ code: "ENOENT" });
  await fs.rm(path.join(parent, "late.js"));

  await fs.writeFile(path.join(repo, ".gitignore"), "*.js\n");
  const ignored = await scan();
  checkLargeLane(ignored.ignoredPaths);
  await disposeGitWorkspaceSnapshot(ignored);
  await fs.rm(path.join(repo, ".gitignore"));
  await git(["add", "--", "."]);
  await git(["commit", "-qm", "track generated files"]);
  await writeFiles("changed");
  const changed = await scan();
  checkLargeLane(changed.overlayPaths);
  await disposeGitWorkspaceSnapshot(changed);
  await fs.rm(parent, { recursive: true });
  const deleted = await scan();
  checkLargeLane(deleted.deletedPaths);
  await stage(deleted);
  let remaining = 0;
  for await (const _entry of await fs.opendir(remoteParent)) remaining++;
  expect(remaining).toBe(0);
  expect(commands.every((command) => command.length < 16 * 1024)).toBe(true);
  expect(scheduler.snapshot()).toMatchObject({ activeCount: 0, queuedCount: 0, inFlightCount: 0, cacheBytes: 0 });
}, realGitTimeoutMs);

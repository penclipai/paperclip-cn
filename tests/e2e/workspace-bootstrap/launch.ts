import fs from "node:fs";
import path from "node:path";
import { prepareTestDriveEnvironment, testDriveCommand } from "../../../cli/src/commands/test-drive.js";

function isExistingFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveWindowsGitExecutable(originalPath: string): string {
  const configuredGit = process.env.BOOTSTRAP_REAL_GIT?.trim();
  if (configuredGit) {
    if (!path.isAbsolute(configuredGit) || !isExistingFile(configuredGit)) {
      throw new Error("BOOTSTRAP_REAL_GIT must be an existing absolute path to git.exe for the Windows workspace-bootstrap fixture.");
    }
    return configuredGit;
  }

  for (const entry of originalPath.split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.resolve(entry, "git.exe");
    if (isExistingFile(candidate)) return candidate;
  }

  throw new Error("Could not find git.exe on the original PATH for the Windows workspace-bootstrap fixture. Set BOOTSTRAP_REAL_GIT to an existing absolute git.exe path.");
}

const options = {
  harness: "codex",
  apiKeyEnv: "BOOTSTRAP_FIXTURE_KEY",
  companyName: "Workspace Recovery QA",
  browser: false,
} as const;

const originalPath = process.env.PATH ?? "";
process.env.BOOTSTRAP_FIXTURE_KEY = "not-a-provider-key";
await prepareTestDriveEnvironment(options);
process.env.NODE_ENV = "test";
// Test-drive clears PAPERCLIP_* settings. Apply the fixture's short deadline
// after isolation; production snapshots may legitimately take much longer.
process.env.PAPERCLIP_WORKSPACE_GIT_SNAPSHOT_TIMEOUT_MS = "10000";
process.env.PAPERCLIP_VITE_CACHE_DIR = path.join(process.env.PAPERCLIP_HOME!, "vite-cache");
let fixtureBin = path.join(import.meta.dirname, "bin");
if (process.platform === "win32") {
  const realGit = resolveWindowsGitExecutable(originalPath);
  // `execFile("git")` cannot execute a .cmd shim, and Windows resolves a
  // later git.exe before an earlier git.cmd. Give this disposable test-drive
  // a copied Node executable named git.exe instead. Its inherited preload
  // dispatches only that renamed executable to the fixture shim.
  fixtureBin = path.join(process.env.PAPERCLIP_HOME!, "workspace-bootstrap-git-shim");
  fs.mkdirSync(fixtureBin, { recursive: true });
  fs.copyFileSync(process.execPath, path.join(fixtureBin, "git.exe"));
  const preload = path.join(import.meta.dirname, "bin-win", "git-preload.cjs");
  // NODE_OPTIONS is shell-tokenized by Node itself; forward slashes avoid the
  // Windows backslashes being consumed while it parses this absolute path.
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--require="${preload.replaceAll("\\", "/")}"`]
    .filter(Boolean)
    .join(" ");
  process.env.BOOTSTRAP_REAL_GIT = realGit;
}
// Remove inherited Git executable directories for this fixture process only.
// The shim delegates non-injected commands to BOOTSTRAP_REAL_GIT by absolute
// path, so no production command path is changed.
const inheritedPath = originalPath
  .split(path.delimiter)
  .filter((entry) => entry && !fs.existsSync(path.join(entry, "git.exe")))
  .join(path.delimiter);
process.env.PATH = `${fixtureBin}${path.delimiter}${inheritedPath}`;
await testDriveCommand(options);

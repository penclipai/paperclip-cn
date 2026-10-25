import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const excludedDirectoryNames = new Set([
  ".cache", ".claude", ".codex", ".git", ".grok", ".omx", ".stage",
  "coverage", "node_modules", "playwright-report", "release", "target", "test-results",
]);
const rootFiles = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc"];
const packageIgnoreFiles = new Set([".npmignore", ".gitignore"]);
const copilotClosureManifest = ".paperclip-copilot-closure.json";
// Keep this list aligned with COPILOT_CLOSURE_SHA256 in the Runner's
// copilot-installation resolver; no other platform directory is admitted.
const qualifiedCopilotPlatforms = new Set(["darwin-arm64", "darwin-x64", "linux-x64"]);

export function isQualifiedCopilotPlatform(platform = process.platform, architecture = process.arch) {
  return qualifiedCopilotPlatforms.has(`${platform}-${architecture}`);
}

function isCurrentCopilotClosureManifest(source, candidate, allowedRelativePaths, stat) {
  if (!stat.isFile() || stat.isSymbolicLink()) return false;
  return allowedRelativePaths?.has(path.relative(source, candidate)) ?? false;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function discoverWorkspacePackages(repoRoot) {
  const packages = new Map();
  const visit = (directory, depth) => {
    if (depth > 5 || excludedDirectoryNames.has(path.basename(directory))) return;
    const manifestPath = path.resolve(directory, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = readJson(manifestPath);
      if (typeof manifest.name === "string") {
        packages.set(manifest.name, { directory, manifest });
      }
      return;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || excludedDirectoryNames.has(entry.name)) continue;
      visit(path.resolve(directory, entry.name), depth + 1);
    }
  };

  for (const root of ["server", "packages"]) {
    const directory = path.resolve(repoRoot, root);
    if (existsSync(directory)) visit(directory, 0);
  }
  return packages;
}

function workspaceDependencyNames(manifest) {
  const names = [];
  // pnpm resolves workspace references before applying deploy --prod, so a
  // server devDependency that uses workspace:* must exist in the detached
  // workspace even though it will not enter the final runtime payload.
  for (const section of ["dependencies", "optionalDependencies", "devDependencies"]) {
    for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
      if (typeof specifier === "string" && specifier.startsWith("workspace:")) names.push(name);
    }
  }
  return names;
}

export function resolveDeployWorkspaceClosure(repoRoot, entryPackageName) {
  const packages = discoverWorkspacePackages(repoRoot);
  const queue = [entryPackageName];
  const closure = [];
  const visited = new Set();
  while (queue.length) {
    const name = queue.shift();
    if (visited.has(name)) continue;
    const pkg = packages.get(name);
    if (!pkg) throw new Error(`Missing workspace package required by desktop deploy: ${name}`);
    visited.add(name);
    closure.push({ name, relativeDirectory: path.relative(repoRoot, pkg.directory) });
    queue.push(...workspaceDependencyNames(pkg.manifest));
  }
  return closure.sort((left, right) => left.relativeDirectory.localeCompare(right.relativeDirectory));
}

function copyPackageDirectory(source, destination, allowedHiddenFiles) {
  cpSync(source, destination, {
    recursive: true,
    force: true,
    filter: (candidate) => {
      const name = path.basename(candidate);
      const stat = lstatSync(candidate);
      if (excludedDirectoryNames.has(name)) return false;
      if (name.startsWith(".") && !packageIgnoreFiles.has(name)
        && !isCurrentCopilotClosureManifest(source, candidate, allowedHiddenFiles, stat)) return false;
      if (stat.isSymbolicLink()) throw new Error(`Refusing source link in detached deploy workspace: ${candidate}`);
      return true;
    },
  });
}

function assertNoLinkedAncestors(directory) {
  for (let current = directory;; current = path.dirname(current)) {
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`Refusing linked detached deploy path: ${current}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (path.dirname(current) === current) return;
  }
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function createDetachedDeployWorkspace({ repoRoot, workspaceRoot, entryPackageName = "@penclipai/server" }) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  if (resolvedWorkspaceRoot === resolvedRepoRoot || resolvedRepoRoot.startsWith(`${resolvedWorkspaceRoot}${path.sep}`)) {
    throw new Error(`Detached deploy workspace must not contain the source repository: ${resolvedWorkspaceRoot}`);
  }
  // A workspace inside a source package would recursively copy itself. The
  // desktop's excluded .stage tree is the only supported in-repository target.
  const desktopStage = path.resolve(resolvedRepoRoot, "packages", "desktop-electron", ".stage");
  if (isInside(resolvedRepoRoot, resolvedWorkspaceRoot) && !isInside(desktopStage, resolvedWorkspaceRoot)) {
    throw new Error(`In-repository deploy workspace must stay in desktop .stage: ${resolvedWorkspaceRoot}`);
  }
  if (existsSync(resolvedWorkspaceRoot)) {
    throw new Error(`Detached deploy workspace must not already exist: ${resolvedWorkspaceRoot}`);
  }
  assertNoLinkedAncestors(resolvedRepoRoot);
  assertNoLinkedAncestors(resolvedWorkspaceRoot);
  mkdirSync(resolvedWorkspaceRoot, { recursive: true });
  for (const file of rootFiles) {
    const source = path.resolve(repoRoot, file);
    if (existsSync(source)) {
      if (lstatSync(source).isSymbolicLink()) throw new Error(`Refusing linked deploy configuration: ${source}`);
      cpSync(source, path.resolve(resolvedWorkspaceRoot, file), { force: true });
    }
  }
  // pnpm also runs the root's lifecycle hooks during deploy. Keep their local
  // imports and patch inputs in the copy, so hooks cannot fall back to source.
  for (const directory of ["scripts", "patches"]) {
    const source = path.resolve(repoRoot, directory);
    if (existsSync(source)) copyPackageDirectory(source, path.resolve(resolvedWorkspaceRoot, directory));
  }

  const closure = resolveDeployWorkspaceClosure(repoRoot, entryPackageName);
  for (const { relativeDirectory } of closure) {
    const allowedHiddenFiles = ["server", path.join("packages", "paperclip-runner")].includes(relativeDirectory)
      ? new Set([...qualifiedCopilotPlatforms].map((platform) =>
        path.join("provider-assets", "copilot", platform, copilotClosureManifest)))
      : undefined;
    copyPackageDirectory(
      path.resolve(repoRoot, relativeDirectory),
      path.resolve(resolvedWorkspaceRoot, relativeDirectory),
      allowedHiddenFiles,
    );
  }
  return closure;
}

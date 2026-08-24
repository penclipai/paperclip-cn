#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNodeScript, runPnpm } from "./utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageDir, "../..");
const stageRootDir = path.resolve(packageDir, ".stage");
const serverDeployDir = path.resolve(stageRootDir, "server-deploy");
const serverDeployNodeModulesDir = path.resolve(serverDeployDir, "node_modules");
const appRuntimeDir = path.resolve(stageRootDir, "app-runtime");
const appRuntimeServerDir = path.resolve(appRuntimeDir, "server");
const appRuntimeNodeModulesDir = path.resolve(appRuntimeDir, "node_modules");
const appRuntimeSkillsDir = path.resolve(appRuntimeDir, "skills");
const appRuntimeBundledPluginsDir = path.resolve(appRuntimeDir, "packages", "plugins");
const bundledSkillsDir = path.resolve(repoRoot, "skills");
const bundledPluginsDir = path.resolve(repoRoot, "packages", "plugins");
const bundledPluginPackageExclusions = new Set([
  "examples/plugin-orchestration-smoke-example",
]);
const standaloneBundledPluginPackagePrefixes = [
  "sandbox-providers/",
];
const standaloneBundledPluginInstallEnv = {
  ...process.env,
  NODE_ENV: "development",
  NPM_CONFIG_PRODUCTION: "false",
  npm_config_production: "false",
};
const runtimeNodeModulePruneRules = [
  {
    label: "Vite runtime peer spillover",
    topLevelEntries: ["vite", "@vitejs"],
    pnpmPackagePrefixes: ["vite@", "@vitejs+"],
  },
  {
    label: "Vitest runtime peer spillover",
    topLevelEntries: ["vitest", "@vitest"],
    pnpmPackagePrefixes: ["vitest@", "@vitest+"],
  },
  {
    label: "Storybook build-only packages",
    topLevelEntries: ["storybook", "@storybook"],
    pnpmPackagePrefixes: ["storybook@", "@storybook+"],
  },
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  const nextContents = `${JSON.stringify(value, null, 2)}\n`;
  const tempPath = `${filePath}.tmp`;

  rmSync(tempPath, { force: true });
  writeFileSync(tempPath, nextContents);
  rmSync(filePath, { force: true });
  renameSync(tempPath, filePath);
}

function withPnpm9DeployPatchAllowance(callback) {
  const rootPackageJsonPath = path.resolve(repoRoot, "package.json");
  const originalContents = readFileSync(rootPackageJsonPath, "utf8");
  const rootPackageJson = JSON.parse(originalContents);

  if (rootPackageJson.pnpm?.allowNonAppliedPatches === true) {
    return callback();
  }

  rootPackageJson.pnpm ??= {};
  rootPackageJson.pnpm.allowNonAppliedPatches = true;

  let restored = false;
  const restoreRootPackageJson = () => {
    if (restored) return;
    writeFileSync(rootPackageJsonPath, originalContents);
    restored = true;
  };

  process.once("exit", restoreRootPackageJson);
  writeJson(rootPackageJsonPath, rootPackageJson);

  try {
    return callback();
  } finally {
    process.off("exit", restoreRootPackageJson);
    restoreRootPackageJson();
  }
}

function isInsideStage(targetPath) {
  const realTarget = realpathSync(targetPath);
  const relative = path.relative(stageRootDir, realTarget);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function collectScopedPackageJsons(rootDir, scopeName) {
  const packageJsons = new Set();

  const topLevelScopeDir = path.resolve(rootDir, scopeName);
  if (existsSync(topLevelScopeDir)) {
    for (const entry of readdirSync(topLevelScopeDir, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const candidate = path.resolve(topLevelScopeDir, entry.name, "package.json");
      if (existsSync(candidate)) {
        packageJsons.add(candidate);
      }
    }
  }

  const pnpmDir = path.resolve(rootDir, ".pnpm");
  if (!existsSync(pnpmDir)) {
    return [...packageJsons];
  }

  const stack = [pnpmDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const nextPath = path.resolve(current, entry.name);
      if (!entry.isDirectory()) continue;

      if (entry.name === scopeName) {
        for (const scopedEntry of readdirSync(nextPath, { withFileTypes: true })) {
          if (!scopedEntry.isDirectory()) continue;
          const candidate = path.resolve(nextPath, scopedEntry.name, "package.json");
          if (existsSync(candidate)) {
            packageJsons.add(candidate);
          }
        }
        continue;
      }

      stack.push(nextPath);
    }
  }

  return [...packageJsons];
}

function patchPublishMetadata(packageJsonPath) {
  if (!existsSync(packageJsonPath)) return false;
  if (!isInsideStage(packageJsonPath)) return false;

  const fileStat = lstatSync(packageJsonPath);
  if (fileStat.isSymbolicLink()) {
    return false;
  }

  const stat = lstatSync(path.dirname(packageJsonPath));
  if (stat.isSymbolicLink()) {
    return false;
  }

  const pkg = readJson(packageJsonPath);
  if (!pkg.name?.startsWith("@penclipai/")) return false;

  let changed = false;
  if (pkg.publishConfig?.exports) {
    pkg.exports = pkg.publishConfig.exports;
    changed = true;
  }
  if (pkg.publishConfig?.main) {
    pkg.main = pkg.publishConfig.main;
    changed = true;
  }
  if (pkg.publishConfig?.types) {
    pkg.types = pkg.publishConfig.types;
    changed = true;
  }

  if (!changed) return false;
  writeJson(packageJsonPath, pkg);
  return true;
}

function findBundledPluginPackageJsons(rootDir, maxDepth = 4) {
  if (!existsSync(rootDir)) return [];

  const packageJsons = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const entryPath = path.resolve(dir, entry.name);
      if (entry.isFile() && entry.name === "package.json") {
        const relativePackageRoot = path.relative(rootDir, dir).replaceAll(path.sep, "/");
        if (bundledPluginPackageExclusions.has(relativePackageRoot)) {
          continue;
        }

        const pkg = readJson(entryPath);
        if (
          pkg.paperclipPlugin
          && typeof pkg.paperclipPlugin === "object"
          && !Array.isArray(pkg.paperclipPlugin)
        ) {
          packageJsons.push(entryPath);
        }
        continue;
      }
      if (entry.isDirectory()) {
        walk(entryPath, depth + 1);
      }
    }
  };

  walk(rootDir, 0);
  return packageJsons;
}

function bundledPluginRelativeRoot(packageRoot) {
  return path.relative(bundledPluginsDir, packageRoot).replaceAll(path.sep, "/");
}

function shouldInstallBundledPluginBeforeBuild(packageRoot) {
  const relativePackageRoot = bundledPluginRelativeRoot(packageRoot);
  return standaloneBundledPluginPackagePrefixes.some((prefix) =>
    relativePackageRoot.startsWith(prefix));
}

function copyIfExists(sourcePath, destinationPath, options = {}) {
  if (!existsSync(sourcePath)) return false;
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  cpSync(sourcePath, destinationPath, {
    recursive: true,
    force: true,
    ...options,
  });
  return true;
}

function copyBundledPluginPackage(packageJsonPath) {
  const packageRoot = path.dirname(packageJsonPath);
  const relativePackageRoot = path.relative(bundledPluginsDir, packageRoot);
  const destinationRoot = path.resolve(appRuntimeBundledPluginsDir, relativePackageRoot);
  const pkg = readJson(packageJsonPath);

  mkdirSync(destinationRoot, { recursive: true });
  copyIfExists(packageJsonPath, path.resolve(destinationRoot, "package.json"));

  for (const fileName of ["README.md", "LICENSE", "LICENSE.md"]) {
    copyIfExists(path.resolve(packageRoot, fileName), path.resolve(destinationRoot, fileName));
  }

  const publishFiles = Array.isArray(pkg.files)
    ? pkg.files.filter((entry) => typeof entry === "string")
    : [];
  const requiredEntries = new Set([
    "dist",
    "migrations",
    ...publishFiles,
  ]);

  for (const entryName of requiredEntries) {
    copyIfExists(path.resolve(packageRoot, entryName), path.resolve(destinationRoot, entryName), {
      dereference: true,
    });
  }

  return { sourceRoot: packageRoot, stagedRoot: destinationRoot };
}

function packageDependencyPath(nodeModulesRoot, packageName) {
  return packageName.startsWith("@")
    ? path.resolve(nodeModulesRoot, ...packageName.split("/"))
    : path.resolve(nodeModulesRoot, packageName);
}

function getRuntimeDependencyNames(pkg) {
  const dependencies = pkg.dependencies && typeof pkg.dependencies === "object" && !Array.isArray(pkg.dependencies)
    ? Object.keys(pkg.dependencies)
    : [];
  const optionalDependencies =
    pkg.optionalDependencies && typeof pkg.optionalDependencies === "object" && !Array.isArray(pkg.optionalDependencies)
      ? Object.keys(pkg.optionalDependencies)
      : [];

  return [...new Set([...dependencies, ...optionalDependencies])].filter((dependencyName) =>
    dependencyName !== "@paperclipai/plugin-sdk"
    && dependencyName !== "@penclipai/plugin-sdk"
    && dependencyName !== "@penclipai/shared"
    && dependencyName !== "@penclipai/shared");
}

function dependencySiblingRoot(packageRoot, packageName) {
  return packageName.startsWith("@")
    ? path.dirname(path.dirname(packageRoot))
    : path.dirname(packageRoot);
}

function copyDependencyClosure(sourceNodeModulesRoot, stagedNodeModulesRoot, dependencyName, visited) {
  const sourcePath = packageDependencyPath(sourceNodeModulesRoot, dependencyName);
  if (!existsSync(sourcePath)) return;

  const realSourcePath = realpathSync(sourcePath);
  const visitedKey = `${dependencyName}:${realSourcePath}`;
  if (visited.has(visitedKey)) return;
  visited.add(visitedKey);

  const destinationPath = packageDependencyPath(stagedNodeModulesRoot, dependencyName);
  if (existsSync(destinationPath)) return;
  copyIfExists(sourcePath, destinationPath, { dereference: true });

  const dependencyPackageJsonPath = path.resolve(realSourcePath, "package.json");
  if (!existsSync(dependencyPackageJsonPath)) return;

  const dependencyPackageJson = readJson(dependencyPackageJsonPath);
  const transitiveRoot = dependencySiblingRoot(realSourcePath, dependencyName);
  for (const transitiveName of getRuntimeDependencyNames(dependencyPackageJson)) {
    copyDependencyClosure(transitiveRoot, stagedNodeModulesRoot, transitiveName, visited);
  }
}

function copyBundledPluginDependencies(sourcePackageRoot, stagedPluginRoot) {
  const pkg = readJson(path.resolve(sourcePackageRoot, "package.json"));
  const sourceNodeModulesRoot = path.resolve(sourcePackageRoot, "node_modules");
  const stagedNodeModulesRoot = path.resolve(stagedPluginRoot, "node_modules");
  const visited = new Set();

  for (const dependencyName of getRuntimeDependencyNames(pkg)) {
    copyDependencyClosure(sourceNodeModulesRoot, stagedNodeModulesRoot, dependencyName, visited);
  }
}

function removeIfExists(targetPath) {
  if (!existsSync(targetPath)) return false;
  rmSync(targetPath, { recursive: true, force: true });
  return true;
}

function pruneRuntimeNodeModules() {
  if (!existsSync(appRuntimeNodeModulesDir)) {
    return;
  }

  const pnpmStoreDir = path.resolve(appRuntimeNodeModulesDir, ".pnpm");
  const removedEntries = [];

  for (const rule of runtimeNodeModulePruneRules) {
    for (const entryName of rule.topLevelEntries) {
      const entryPath = path.resolve(appRuntimeNodeModulesDir, entryName);
      if (removeIfExists(entryPath)) {
        removedEntries.push(`${rule.label}: ${entryName}`);
      }
    }

    if (!existsSync(pnpmStoreDir)) {
      continue;
    }

    for (const entry of readdirSync(pnpmStoreDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!rule.pnpmPackagePrefixes.some((prefix) => entry.name.startsWith(prefix))) {
        continue;
      }

      const entryPath = path.resolve(pnpmStoreDir, entry.name);
      if (removeIfExists(entryPath)) {
        removedEntries.push(`${rule.label}: .pnpm/${entry.name}`);
      }
    }
  }

  if (removedEntries.length === 0) {
    console.log("[desktop-stage] No build/test-only runtime packages needed pruning.");
    return;
  }

  console.log(
    `[desktop-stage] Pruned ${removedEntries.length} build/test-only runtime package entries from staged node_modules.`,
  );
  for (const entry of removedEntries) {
    console.log(`[desktop-stage]   - ${entry}`);
  }
}

console.log("[desktop-stage] Building server workspace and dependencies...");
runPnpm(["--dir", repoRoot, "--filter", "@penclipai/server...", "build"], {
  cwd: repoRoot,
});

console.log("[desktop-stage] Building bundled plugin packages...");
for (const packageJsonPath of findBundledPluginPackageJsons(bundledPluginsDir)) {
  const packageRoot = path.dirname(packageJsonPath);
  const pkg = readJson(packageJsonPath);
  if (shouldInstallBundledPluginBeforeBuild(packageRoot)) {
    const relativePackageRoot = bundledPluginRelativeRoot(packageRoot);
    console.log(`[desktop-stage] Installing standalone bundled plugin deps for ${relativePackageRoot}...`);
    runPnpm(["--dir", packageRoot, "install", "--ignore-workspace", "--no-lockfile"], {
      cwd: packageRoot,
      env: standaloneBundledPluginInstallEnv,
    });
  }
  if (pkg.scripts?.build) {
    runPnpm(["--dir", packageRoot, "run", "build"], { cwd: packageRoot });
  }
}

console.log("[desktop-stage] Preparing bundled UI...");
runNodeScript(path.resolve(repoRoot, "scripts", "prepare-server-ui-dist.mjs"), [], {
  cwd: repoRoot,
});

console.log("[desktop-stage] Building Electron shell...");
runPnpm(["--dir", repoRoot, "--filter", "@penclipai/desktop-electron", "build:release"], {
  cwd: repoRoot,
});

console.log("[desktop-stage] Creating staged packaged runtime...");
rmSync(stageRootDir, { recursive: true, force: true });
mkdirSync(stageRootDir, { recursive: true });

// pnpm 9's hoisted deploy copies bundled dependencies such as the patched
// acpx package, but does not count them as applied patches. Scope the legacy
// allowance to this deploy so normal workspace installs remain strict.
withPnpm9DeployPatchAllowance(() =>
  runPnpm(
    [
      "--config.node-linker=hoisted",
      "--dir",
      repoRoot,
      "--filter",
      "@penclipai/server",
      "deploy",
      "--prod",
      serverDeployDir,
    ],
    { cwd: repoRoot },
  ),
);

const hoistedSelfRefServerPath = path.resolve(
  serverDeployNodeModulesDir,
  ".pnpm",
  "node_modules",
  "@penclipai",
  "server",
);

if (existsSync(hoistedSelfRefServerPath)) {
  rmSync(hoistedSelfRefServerPath, { recursive: true, force: true });
}

console.log("[desktop-stage] Patching deployed workspace package metadata...");
patchPublishMetadata(path.resolve(serverDeployDir, "package.json"));
const packageJsons = collectScopedPackageJsons(serverDeployNodeModulesDir, "@penclipai");
let patchedCount = 0;
for (const packageJsonPath of packageJsons) {
  if (patchPublishMetadata(packageJsonPath)) {
    patchedCount += 1;
  }
}

console.log(`[desktop-stage] Patched ${patchedCount} deployed package manifests.`);

console.log("[desktop-stage] Assembling packaged app-runtime...");
rmSync(appRuntimeDir, { recursive: true, force: true });
mkdirSync(appRuntimeServerDir, { recursive: true });

cpSync(path.resolve(serverDeployDir, "dist"), path.resolve(appRuntimeServerDir, "dist"), {
  recursive: true,
  force: true,
});
cpSync(path.resolve(serverDeployDir, "ui-dist"), path.resolve(appRuntimeServerDir, "ui-dist"), {
  recursive: true,
  force: true,
});
cpSync(path.resolve(serverDeployDir, "package.json"), path.resolve(appRuntimeServerDir, "package.json"), {
  force: true,
});
cpSync(serverDeployNodeModulesDir, appRuntimeNodeModulesDir, {
  recursive: true,
  force: true,
});
cpSync(bundledSkillsDir, appRuntimeSkillsDir, {
  recursive: true,
  force: true,
});

console.log("[desktop-stage] Assembling bundled plugin packages...");
const bundledPluginPackageJsons = findBundledPluginPackageJsons(bundledPluginsDir);
const stagedPluginRoots = bundledPluginPackageJsons.map(copyBundledPluginPackage);

copyIfExists(
  path.resolve(bundledPluginsDir, "sdk", "package.json"),
  path.resolve(appRuntimeBundledPluginsDir, "sdk", "package.json"),
);
copyIfExists(
  path.resolve(bundledPluginsDir, "sdk", "dist"),
  path.resolve(appRuntimeBundledPluginsDir, "sdk", "dist"),
  { dereference: true },
);

console.log("[desktop-stage] Preparing bundled plugin runtime dependencies...");
for (const { sourceRoot, stagedRoot } of stagedPluginRoots) {
  copyBundledPluginDependencies(sourceRoot, stagedRoot);
}

pruneRuntimeNodeModules();

console.log("[desktop-stage] Packaged runtime ready in .stage/app-runtime.");

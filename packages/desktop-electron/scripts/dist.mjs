#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runNodeScript, runPnpm } from "./utils.mjs";
import { checkCatalog } from "../../../scripts/i18n-catalog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageDir, "../..");
const releaseDir = path.resolve(packageDir, "release");
const generatedWorkspaceDir = path.resolve(packageDir, "packages");
const stageAppRuntimeDir = path.resolve(packageDir, ".stage", "app-runtime");
const stageAppRuntimeServerDir = path.resolve(stageAppRuntimeDir, "server");
const stageAppRuntimeNodeModulesDir = path.resolve(stageAppRuntimeDir, "node_modules");
const stageAppRuntimeSkillsDir = path.resolve(stageAppRuntimeDir, "skills");
const stageAppRuntimeBundledPluginsDir = path.resolve(stageAppRuntimeDir, "packages", "plugins");
const prepareStageScript = path.resolve(packageDir, "scripts", "prepare-stage.mjs");
const desktopSizeAuditScript = path.resolve(packageDir, "scripts", "desktop-size-audit.mjs");
const desktopReleaseVersion = process.env.PAPERCLIP_DESKTOP_RELEASE_VERSION?.trim() ?? "";
const desktopArtifactManifestPath = path.resolve(releaseDir, "desktop-artifacts.json");
const PRODUCT_NAME = "Paperclip CN";

const PLATFORM_CONFIG = {
  win: {
    id: "win",
    nodePlatform: "win32",
    supportedArchs: ["x64"],
    defaultArch: "x64",
    builderFlag: "--win",
    installerTarget: "nsis",
    unpackedDirCandidates: () => ["win-unpacked"],
    releaseAssetExtensions: [".exe"],
    resolveRuntimePath: (unpackedAppPath) => path.resolve(unpackedAppPath, "resources", "app-runtime"),
    resolveLauncherPath: (unpackedAppPath) => {
      const candidates = [
        path.resolve(unpackedAppPath, `${PRODUCT_NAME}.exe`),
        path.resolve(unpackedAppPath, "Paperclip-CN.exe"),
        path.resolve(unpackedAppPath, "electron.exe"),
      ];

      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          return candidate;
        }
      }

      const discoveredExecutable = readdirSync(unpackedAppPath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".exe"))
        .map((entry) => path.resolve(unpackedAppPath, entry.name))
        .at(0);

      if (discoveredExecutable) {
        return discoveredExecutable;
      }

      throw new Error(`Packaged Windows executable not found in ${unpackedAppPath}.`);
    },
    resolvePrepackagedPath: (unpackedAppPath) => unpackedAppPath,
    shouldIncludeReleaseAsset: (name) =>
      name.toLowerCase().endsWith(".exe") && !name.includes(".__uninstaller"),
  },
  mac: {
    id: "mac",
    nodePlatform: "darwin",
    supportedArchs: ["x64", "arm64"],
    defaultArch: process.arch === "arm64" ? "arm64" : "x64",
    builderFlag: "--mac",
    installerTarget: "dmg",
    unpackedDirCandidates: (arch) => arch === "arm64" ? ["mac-arm64", "mac"] : ["mac", "mac-x64"],
    releaseAssetExtensions: [".dmg"],
    resolveRuntimePath: (appBundlePath) => path.resolve(appBundlePath, "Contents", "Resources", "app-runtime"),
    resolveLauncherPath: (appBundlePath) => {
      const executablePath = path.resolve(appBundlePath, "Contents", "MacOS", PRODUCT_NAME);
      if (existsSync(executablePath)) {
        return executablePath;
      }

      const executableDir = path.resolve(appBundlePath, "Contents", "MacOS");
      const discoveredExecutable = readdirSync(executableDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.resolve(executableDir, entry.name))
        .at(0);

      if (discoveredExecutable) {
        return discoveredExecutable;
      }

      throw new Error(`Packaged macOS launcher not found inside ${appBundlePath}.`);
    },
    resolvePrepackagedPath: (appBundlePath) => appBundlePath,
    shouldIncludeReleaseAsset: (name) => name.toLowerCase().endsWith(".dmg"),
  },
  linux: {
    id: "linux",
    nodePlatform: "linux",
    supportedArchs: ["x64"],
    defaultArch: "x64",
    builderFlag: "--linux",
    installerTarget: "AppImage",
    unpackedDirCandidates: () => ["linux-unpacked"],
    releaseAssetExtensions: [".appimage"],
    resolveRuntimePath: (unpackedAppPath) => path.resolve(unpackedAppPath, "resources", "app-runtime"),
    resolveLauncherPath: (unpackedAppPath) => {
      const candidateNames = [PRODUCT_NAME, "Paperclip-CN", "paperclip-cn", "paperclip"];
      for (const candidateName of candidateNames) {
        const candidatePath = path.resolve(unpackedAppPath, candidateName);
        if (isExecutableFile(candidatePath)) {
          return candidatePath;
        }
      }

      const discoveredExecutable = readdirSync(unpackedAppPath, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.resolve(unpackedAppPath, entry.name))
        .find((candidatePath) => isExecutableFile(candidatePath));

      if (discoveredExecutable) {
        return discoveredExecutable;
      }

      throw new Error(`Packaged Linux launcher not found in ${unpackedAppPath}.`);
    },
    resolvePrepackagedPath: (unpackedAppPath) => unpackedAppPath,
    shouldIncludeReleaseAsset: (name) => name.toLowerCase().endsWith(".appimage"),
  },
};

function parseArgs(argv) {
  const args = {
    dirOnly: false,
    platform: null,
    arch: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dir-only") {
      args.dirOnly = true;
      continue;
    }
    if (arg === "--platform") {
      args.platform = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--arch") {
      args.arch = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--platform=")) {
      args.platform = arg.slice("--platform=".length);
      continue;
    }
    if (arg.startsWith("--arch=")) {
      args.arch = arg.slice("--arch=".length);
    }
  }

  return args;
}

function resolveDefaultPlatform() {
  switch (process.platform) {
    case "win32":
      return "win";
    case "darwin":
      return "mac";
    case "linux":
      return "linux";
    default:
      throw new Error(`Unsupported host platform for desktop packaging: ${process.platform}`);
  }
}

function resolveTargetConfig(args) {
  const requestedPlatform = args.platform ?? resolveDefaultPlatform();
  const platformConfig = PLATFORM_CONFIG[requestedPlatform];

  if (!platformConfig) {
    throw new Error(`Unsupported desktop target platform: ${requestedPlatform}`);
  }

  const arch = args.arch ?? platformConfig.defaultArch;
  if (!platformConfig.supportedArchs.includes(arch)) {
    throw new Error(`Unsupported arch "${arch}" for desktop target platform "${requestedPlatform}".`);
  }

  return {
    ...platformConfig,
    arch,
  };
}

function validateDesktopReleaseVersion(version) {
  if (version.length === 0) {
    return;
  }

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(
      `Invalid PAPERCLIP_DESKTOP_RELEASE_VERSION "${version}". Expected a semver-safe version such as 2026.414.0.`,
    );
  }
}

function electronBuilderVersionArgs() {
  validateDesktopReleaseVersion(desktopReleaseVersion);

  if (desktopReleaseVersion.length === 0) {
    return [];
  }

  console.log(`[desktop-dist] Overriding desktop build version to ${desktopReleaseVersion}.`);
  return [`-c.extraMetadata.version=${desktopReleaseVersion}`];
}

function electronBuilderArchArgs(targetConfig) {
  switch (targetConfig.arch) {
    case "x64":
      return ["--x64"];
    case "arm64":
      return ["--arm64"];
    default:
      return [];
  }
}

function isExecutableFile(filePath) {
  if (!existsSync(filePath)) {
    return false;
  }

  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) {
      return false;
    }
    if (process.platform === "win32") {
      return true;
    }
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function listRequiredTopLevelPackages(nodeModulesDir) {
  return readdirSync(nodeModulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== ".bin" && name !== ".pnpm")
    .sort((left, right) => left.localeCompare(right));
}

function listSkillDirectories(skillsDir) {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function listBundledPluginPackageNames(pluginRootDir, maxDepth = 4) {
  if (!existsSync(pluginRootDir)) return [];

  const packageNames = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const entryPath = path.resolve(dir, entry.name);
      if (entry.isFile() && entry.name === "package.json") {
        const pkg = readJsonFile(entryPath);
        if (
          typeof pkg.name === "string"
          && pkg.paperclipPlugin
          && typeof pkg.paperclipPlugin === "object"
          && !Array.isArray(pkg.paperclipPlugin)
        ) {
          packageNames.push(pkg.name);
        }
        continue;
      }
      if (entry.isDirectory()) {
        walk(entryPath, depth + 1);
      }
    }
  };

  walk(pluginRootDir, 0);
  return packageNames.sort((left, right) => left.localeCompare(right));
}

function findFirstExistingPath(candidates) {
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function resolveUnpackedDirectoryPath(targetConfig) {
  const directCandidates = targetConfig.unpackedDirCandidates(targetConfig.arch)
    .map((dirName) => path.resolve(releaseDir, dirName));
  const directMatch = findFirstExistingPath(directCandidates);
  if (directMatch) {
    return directMatch;
  }

  const discoveredDirectory = readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.resolve(releaseDir, entry.name))
    .find((candidatePath) => {
      const baseName = path.basename(candidatePath).toLowerCase();
      if (targetConfig.id === "mac") {
        return baseName.startsWith("mac");
      }
      return baseName === `${targetConfig.id}-unpacked`;
    });

  if (discoveredDirectory) {
    return discoveredDirectory;
  }

  throw new Error(`Unable to find unpacked app directory for ${targetConfig.id}/${targetConfig.arch}.`);
}

function resolveMacAppBundlePath(targetConfig) {
  const unpackedDirectoryPath = resolveUnpackedDirectoryPath(targetConfig);
  const expectedBundlePath = path.resolve(unpackedDirectoryPath, `${PRODUCT_NAME}.app`);
  if (existsSync(expectedBundlePath)) {
    return {
      unpackedRootPath: unpackedDirectoryPath,
      unpackedAppPath: expectedBundlePath,
    };
  }

  const discoveredBundle = readdirSync(unpackedDirectoryPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
    .map((entry) => path.resolve(unpackedDirectoryPath, entry.name))
    .at(0);

  if (discoveredBundle) {
    return {
      unpackedRootPath: unpackedDirectoryPath,
      unpackedAppPath: discoveredBundle,
    };
  }

  throw new Error(`Unable to find a macOS .app bundle in ${unpackedDirectoryPath}.`);
}

function resolvePackagedAppLayout(targetConfig) {
  if (targetConfig.id === "mac") {
    const { unpackedRootPath, unpackedAppPath } = resolveMacAppBundlePath(targetConfig);
    return {
      unpackedRootPath,
      unpackedAppPath,
      launcherPath: targetConfig.resolveLauncherPath(unpackedAppPath),
      runtimePath: targetConfig.resolveRuntimePath(unpackedAppPath),
      prepackagedPath: targetConfig.resolvePrepackagedPath(unpackedAppPath),
    };
  }

  const unpackedAppPath = resolveUnpackedDirectoryPath(targetConfig);
  return {
    unpackedRootPath: unpackedAppPath,
    unpackedAppPath,
    launcherPath: targetConfig.resolveLauncherPath(unpackedAppPath),
    runtimePath: targetConfig.resolveRuntimePath(unpackedAppPath),
    prepackagedPath: targetConfig.resolvePrepackagedPath(unpackedAppPath),
  };
}

function resolveReleaseAssetPaths(targetConfig) {
  if (!existsSync(releaseDir)) {
    return [];
  }

  return readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && targetConfig.shouldIncludeReleaseAsset(entry.name))
    .map((entry) => path.resolve(releaseDir, entry.name));
}

async function resolveEmbeddedPostgresPackageName(targetConfig) {
  const installerModulePath = pathToFileURL(
    path.resolve(repoRoot, "packages", "db", "dist", "embedded-postgres-runtime-installer.js"),
  ).href;
  const { EmbeddedPostgresRuntimeInstaller } = await import(installerModulePath);
  const installer = new EmbeddedPostgresRuntimeInstaller({
    platform: targetConfig.nodePlatform,
    arch: targetConfig.arch,
  });
  return installer.getExpectedPlatformPackageName();
}

async function verifyPackagedRuntime(targetConfig, appLayout, embeddedPostgresPackageName) {
  if (!existsSync(appLayout.launcherPath)) {
    throw new Error(`Missing unpacked launcher: ${appLayout.launcherPath}`);
  }

  if (!existsSync(stageAppRuntimeDir)) {
    throw new Error(`Missing staged runtime directory: ${stageAppRuntimeDir}`);
  }

  if (!existsSync(stageAppRuntimeServerDir)) {
    throw new Error(`Missing staged runtime server directory: ${stageAppRuntimeServerDir}`);
  }

  if (!existsSync(stageAppRuntimeNodeModulesDir)) {
    throw new Error(`Missing staged runtime node_modules: ${stageAppRuntimeNodeModulesDir}`);
  }

  if (!existsSync(stageAppRuntimeSkillsDir)) {
    throw new Error(`Missing staged runtime skills directory: ${stageAppRuntimeSkillsDir}`);
  }

  if (!existsSync(stageAppRuntimeBundledPluginsDir)) {
    throw new Error(`Missing staged runtime bundled plugins directory: ${stageAppRuntimeBundledPluginsDir}`);
  }

  if (!existsSync(appLayout.runtimePath)) {
    throw new Error(`Missing packaged runtime directory: ${appLayout.runtimePath}`);
  }

  const packagedRuntimeServerDir = path.resolve(appLayout.runtimePath, "server");
  const packagedRuntimeNodeModulesDir = path.resolve(appLayout.runtimePath, "node_modules");
  const packagedRuntimeSkillsDir = path.resolve(appLayout.runtimePath, "skills");
  const packagedRuntimeBundledPluginsDir = path.resolve(appLayout.runtimePath, "packages", "plugins");

  if (!existsSync(packagedRuntimeServerDir)) {
    throw new Error(`Missing packaged runtime server directory: ${packagedRuntimeServerDir}`);
  }

  if (!existsSync(packagedRuntimeNodeModulesDir)) {
    throw new Error(`Missing packaged runtime node_modules: ${packagedRuntimeNodeModulesDir}`);
  }

  if (!existsSync(packagedRuntimeSkillsDir)) {
    throw new Error(`Missing packaged runtime skills directory: ${packagedRuntimeSkillsDir}`);
  }

  if (!existsSync(packagedRuntimeBundledPluginsDir)) {
    throw new Error(`Missing packaged runtime bundled plugins directory: ${packagedRuntimeBundledPluginsDir}`);
  }

  await checkCatalog({
    root: repoRoot,
    artifactRoot: path.resolve(packagedRuntimeServerDir, "ui-dist", "locales"),
  });

  const requiredRuntimePaths = [
    {
      description: "server entrypoint",
      stagedPath: path.resolve(stageAppRuntimeServerDir, "dist", "index.js"),
      packagedPath: path.resolve(packagedRuntimeServerDir, "dist", "index.js"),
    },
    {
      description: "server package manifest",
      stagedPath: path.resolve(stageAppRuntimeServerDir, "package.json"),
      packagedPath: path.resolve(packagedRuntimeServerDir, "package.json"),
    },
    {
      description: "bundled static UI",
      stagedPath: path.resolve(stageAppRuntimeServerDir, "ui-dist", "index.html"),
      packagedPath: path.resolve(packagedRuntimeServerDir, "ui-dist", "index.html"),
    },
  ];

  for (const { description, stagedPath, packagedPath } of requiredRuntimePaths) {
    if (!existsSync(stagedPath)) {
      throw new Error(`Staged runtime is missing ${description}: ${stagedPath}`);
    }
    if (!existsSync(packagedPath)) {
      throw new Error(`Packaged runtime is missing ${description}: ${packagedPath}`);
    }
  }

  const stagedPackages = listRequiredTopLevelPackages(stageAppRuntimeNodeModulesDir);
  const packagedPackages = new Set(listRequiredTopLevelPackages(packagedRuntimeNodeModulesDir));
  const missingTopLevelPackages = stagedPackages.filter((name) => !packagedPackages.has(name));

  if (missingTopLevelPackages.length > 0) {
    throw new Error(
      `Packaged runtime is missing top-level node_modules entries: ${missingTopLevelPackages.join(", ")}`,
    );
  }

  const requiredPaths = [
    path.resolve(packagedRuntimeNodeModulesDir, "@aws-sdk", "client-s3"),
    path.resolve(packagedRuntimeNodeModulesDir, "@penclipai", "adapter-codex-local"),
    path.resolve(packagedRuntimeNodeModulesDir, "@penclipai", "adapter-cursor-local"),
    path.resolve(packagedRuntimeNodeModulesDir, "@penclipai", "db"),
    path.resolve(packagedRuntimeNodeModulesDir, "@penclipai", "shared"),
    path.resolve(packagedRuntimeNodeModulesDir, "@penclipai", "adapter-utils"),
    path.resolve(packagedRuntimeNodeModulesDir, ...embeddedPostgresPackageName.split("/")),
  ];

  for (const requiredPath of requiredPaths) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Packaged runtime is missing required dependency path: ${requiredPath}`);
    }
  }

  const sourceSkillDirs = listSkillDirectories(stageAppRuntimeSkillsDir);
  const packagedSkillDirs = new Set(listSkillDirectories(packagedRuntimeSkillsDir));
  const missingSkillDirs = sourceSkillDirs.filter((name) => !packagedSkillDirs.has(name));

  if (missingSkillDirs.length > 0) {
    throw new Error(
      `Packaged runtime is missing bundled Paperclip skills: ${missingSkillDirs.join(", ")}`,
    );
  }

  const stagedPluginPackages = listBundledPluginPackageNames(stageAppRuntimeBundledPluginsDir);
  const packagedPluginPackages = new Set(listBundledPluginPackageNames(packagedRuntimeBundledPluginsDir));
  const missingPluginPackages = stagedPluginPackages.filter((name) => !packagedPluginPackages.has(name));

  if (missingPluginPackages.length > 0) {
    throw new Error(
      `Packaged runtime is missing bundled Paperclip plugins: ${missingPluginPackages.join(", ")}`,
    );
  }

  console.log(
    `[desktop-dist] Verified packaged runtime completeness for ${targetConfig.id}/${targetConfig.arch} (${stagedPackages.length} top-level package roots, ${sourceSkillDirs.length} bundled skills, ${stagedPluginPackages.length} bundled plugins).`,
  );
}

function writeDesktopArtifactManifest(targetConfig, appLayout, releaseAssetPaths) {
  const manifest = {
    platform: targetConfig.id,
    nodePlatform: targetConfig.nodePlatform,
    arch: targetConfig.arch,
    releaseVersion: desktopReleaseVersion || null,
    unpackedRootPath: appLayout.unpackedRootPath,
    unpackedAppPath: appLayout.unpackedAppPath,
    launcherPath: appLayout.launcherPath,
    runtimePath: appLayout.runtimePath,
    releaseAssetPaths,
  };

  writeFileSync(desktopArtifactManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function runPowerShell(command, { ignoreFailure = false } = {}) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    {
      cwd: packageDir,
      stdio: "inherit",
      windowsHide: true,
    },
  );

  if (ignoreFailure) {
    return result;
  }

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`PowerShell command failed with exit code ${result.status}`);
  }

  return result;
}

function sleepMs(milliseconds) {
  if (milliseconds <= 0) {
    return;
  }

  runPowerShell(`Start-Sleep -Milliseconds ${milliseconds}`, { ignoreFailure: true });
}

function stopProcessesUsingReleaseDir() {
  if (process.platform !== "win32" || !existsSync(releaseDir)) {
    return;
  }

  const escapedReleaseDir = releaseDir.replace(/'/g, "''");
  runPowerShell(
    `
$releaseDir = '${escapedReleaseDir}';
Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and $_.Path.StartsWith($releaseDir, [System.StringComparison]::OrdinalIgnoreCase) } |
  Stop-Process -Force -ErrorAction SilentlyContinue
`,
    { ignoreFailure: true },
  );
}

function removePathWithRetries(targetPath, description, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      const retryable =
        error &&
        typeof error === "object" &&
        "code" in error &&
        ["EPERM", "EBUSY", "ENOTEMPTY"].includes(error.code);

      if (!retryable || attempt === attempts) {
        throw error;
      }

      console.warn(
        `[desktop-dist] Retry ${attempt}/${attempts - 1} while removing ${description}; attempting to stop lingering packaged processes...`,
      );
      stopProcessesUsingReleaseDir();
      sleepMs(750);
    }
  }
}

function cleanReleaseArtifacts() {
  stopProcessesUsingReleaseDir();
  removePathWithRetries(releaseDir, "release directory");
  removePathWithRetries(generatedWorkspaceDir, "generated workspace directory");
}

function buildUnpackedApp(targetConfig) {
  runPnpm(
    [
      "exec",
      "electron-builder",
      "--config",
      "electron-builder.yml",
      "--dir",
      targetConfig.builderFlag,
      "--publish",
      "never",
      ...electronBuilderArchArgs(targetConfig),
      ...electronBuilderVersionArgs(),
    ],
    { cwd: packageDir },
  );
}

function buildInstallerFromPrepackagedApp(targetConfig, prepackagedPath) {
  runPnpm(
    [
      "exec",
      "electron-builder",
      "--config",
      "electron-builder.yml",
      targetConfig.builderFlag,
      targetConfig.installerTarget,
      "--prepackaged",
      prepackagedPath,
      "--publish",
      "never",
      ...electronBuilderArchArgs(targetConfig),
      ...electronBuilderVersionArgs(),
    ],
    { cwd: packageDir },
  );
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const targetConfig = resolveTargetConfig(args);

  cleanReleaseArtifacts();

  console.log("[desktop-dist] Preparing staged desktop runtime...");
  runNodeScript(prepareStageScript, [], { cwd: packageDir });

  console.log(`[desktop-dist] Building verified unpacked output for ${targetConfig.id}/${targetConfig.arch}...`);
  buildUnpackedApp(targetConfig);

  const embeddedPostgresPackageName = await resolveEmbeddedPostgresPackageName(targetConfig);
  if (!embeddedPostgresPackageName) {
    throw new Error(`Unsupported embedded-postgres platform package for ${targetConfig.id}/${targetConfig.arch}.`);
  }

  const appLayout = resolvePackagedAppLayout(targetConfig);
  await verifyPackagedRuntime(targetConfig, appLayout, embeddedPostgresPackageName);

  let releaseAssetPaths = [];
  if (!args.dirOnly) {
    console.log(
      `[desktop-dist] Building ${targetConfig.installerTarget} installer from verified unpacked output for ${targetConfig.id}/${targetConfig.arch}...`,
    );
    buildInstallerFromPrepackagedApp(targetConfig, appLayout.prepackagedPath);
    releaseAssetPaths = resolveReleaseAssetPaths(targetConfig);
    if (releaseAssetPaths.length === 0) {
      throw new Error(`No release assets were produced for ${targetConfig.id}/${targetConfig.arch} in ${releaseDir}.`);
    }
    console.log(
      `[desktop-dist] Release assets: ${releaseAssetPaths.map((artifact) => path.basename(artifact)).join(", ")}`,
    );
  }

  writeDesktopArtifactManifest(targetConfig, appLayout, releaseAssetPaths);
  runNodeScript(desktopSizeAuditScript, [], { cwd: packageDir });
  console.log(`[desktop-dist] Wrote desktop artifact manifest: ${desktopArtifactManifestPath}`);
}

try {
  await run();
} catch (error) {
  console.error("[desktop-dist] Failed:", error);
  process.exitCode = 1;
}

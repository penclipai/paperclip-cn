import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import { resolveQualifiedCopilotMaterializerPackage } from "./detached-deploy-workspace.mjs";

// Keep this in lock-step with paperclip-runner's qualified OpenCode resolver.
// Updating this version or target map requires an explicit packaging review.
const QUALIFIED_OPENCODE_VERSION = "1.18.34";
const NATIVE_PACKAGE_BY_TARGET = {
  "linux-x64": "opencode-linux-x64-baseline",
  "darwin-arm64": "opencode-darwin-arm64",
  "darwin-x64": "opencode-darwin-x64-baseline",
};
const NATIVE_PACKAGE_NAMES = new Set([
  "opencode-darwin-arm64",
  "opencode-darwin-x64",
  "opencode-darwin-x64-baseline",
  "opencode-linux-arm64",
  "opencode-linux-arm64-musl",
  "opencode-linux-x64",
  "opencode-linux-x64-baseline",
  "opencode-linux-x64-baseline-musl",
  "opencode-linux-x64-musl",
]);

function targetKey(platform, arch) {
  return `${platform}-${arch}`;
}

function supportedTarget(platform, arch) {
  return NATIVE_PACKAGE_BY_TARGET[targetKey(platform, arch)] ?? null;
}

function detectedLinuxLibc() {
  try {
    return process.report?.getReport?.().header?.glibcVersionRuntime ? "glibc" : "unknown";
  } catch {
    return "unknown";
  }
}

function assertSupportedLinuxLibc(platform, libc) {
  if (platform !== "linux") return;
  const resolved = libc ?? detectedLinuxLibc();
  if (resolved !== "glibc") {
    throw new Error(
      `Desktop runtime payload optimization supports only Linux glibc; received ${String(resolved)}. Preserve the native payload for this target.`,
    );
  }
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function isWithinOrEqual(root, candidate) {
  return candidate === root || isWithin(root, candidate);
}

function assertRuntimeRoot(runtimeRoot) {
  if (lstatSync(runtimeRoot).isSymbolicLink()) {
    throw new Error("Desktop runtime root must not be a symbolic link");
  }
  const root = realpathSync(runtimeRoot);
  if (!statSync(root).isDirectory()) throw new Error("Desktop runtime root is not a directory");
  return root;
}

function assertInside(root, candidate, description) {
  let resolved;
  try {
    resolved = realpathSync(candidate);
  } catch (error) {
    throw new Error(`${description} cannot be resolved inside the staged runtime`, { cause: error });
  }
  if (!isWithin(root, resolved)) throw new Error(`${description} escapes the staged runtime`);
  return resolved;
}

function assertMutablePath(root, target, description) {
  const parent = realpathSync(path.dirname(target));
  if (!isWithinOrEqual(root, parent)) {
    throw new Error(`${description} parent escapes the staged runtime`);
  }
}

function readJson(filePath, description) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${description}: ${error.message}`, { cause: error });
  }
}

function hashFile(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function bytesInTree(root) {
  const stat = lstatSync(root);
  if (stat.isSymbolicLink()) return 0;
  if (stat.isFile()) return stat.size;
  let total = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    total += bytesInTree(path.join(root, entry.name));
  }
  return total;
}

function nodeModuleDirectories(runtimeRoot) {
  const direct = path.join(runtimeRoot, "node_modules");
  if (!existsSync(direct)) return [];
  const directories = [direct];
  const store = path.join(direct, ".pnpm");
  if (!existsSync(store)) return directories;
  for (const entry of readdirSync(store, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = path.join(store, entry.name, "node_modules");
    if (existsSync(nested)) directories.push(nested);
  }
  return directories;
}

function candidateAt(nodeModules, name) {
  const candidate = path.join(nodeModules, name);
  try {
    lstatSync(candidate);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return candidate;
}

function collectNativePackages(runtimeRoot) {
  const entries = new Map();
  for (const nodeModules of nodeModuleDirectories(runtimeRoot)) {
    for (const name of NATIVE_PACKAGE_NAMES) {
      const entryPath = candidateAt(nodeModules, name);
      if (!entryPath) continue;
      const packageRoot = assertInside(runtimeRoot, entryPath, `OpenCode package ${name}`);
      const manifestPath = path.join(packageRoot, "package.json");
      const manifest = readJson(manifestPath, `OpenCode package ${name} manifest`);
      if (manifest.name !== name) {
        throw new Error(`OpenCode package identity mismatch: expected ${name}, received ${String(manifest.name)}`);
      }
      const existing = entries.get(packageRoot) ?? { name, root: packageRoot, aliases: [] };
      existing.aliases.push(entryPath);
      entries.set(packageRoot, existing);
    }
  }
  return [...entries.values()];
}

function collectCopilotMaterializerPackages(runtimeRoot, packageName) {
  const entries = new Map();
  for (const nodeModules of nodeModuleDirectories(runtimeRoot)) {
    const entryPath = candidateAt(nodeModules, packageName);
    if (!entryPath) continue;
    const packageRoot = assertInside(runtimeRoot, entryPath, `Copilot materializer package ${packageName}`);
    const manifest = readJson(path.join(packageRoot, "package.json"), `Copilot materializer package ${packageName} manifest`);
    if (manifest.name !== packageName) {
      throw new Error(`Copilot materializer package identity mismatch: expected ${packageName}, received ${String(manifest.name)}`);
    }
    const existing = entries.get(packageRoot) ?? { root: packageRoot, aliases: [] };
    existing.aliases.push(entryPath);
    entries.set(packageRoot, existing);
  }
  return [...entries.values()];
}

function runtimeState({ runtimeRoot, platform, arch, libc }) {
  const root = assertRuntimeRoot(runtimeRoot);
  assertSupportedLinuxLibc(platform, libc);
  const nativePackage = supportedTarget(platform, arch);
  if (!nativePackage) {
    return {
      supported: false,
      platform,
      arch,
      nativePackage: null,
      nativeExecutable: null,
      portableExecutable: null,
      portableIsSymlink: false,
      unexpectedPackages: [],
      bytesSaved: 0,
    };
  }

  const nodeModules = path.join(root, "node_modules");
  const wrapperRoot = assertInside(root, path.join(nodeModules, "opencode-ai"), "OpenCode portable package");
  const wrapper = readJson(path.join(wrapperRoot, "package.json"), "OpenCode portable package manifest");
  if (wrapper.name !== "opencode-ai" || wrapper.version !== QUALIFIED_OPENCODE_VERSION) {
    throw new Error(`OpenCode portable package identity mismatch; expected opencode-ai@${QUALIFIED_OPENCODE_VERSION}. Review the desktop payload policy before upgrading.`);
  }
  if (wrapper.optionalDependencies?.[nativePackage] !== QUALIFIED_OPENCODE_VERSION) {
    throw new Error(`OpenCode portable package does not pin ${nativePackage}@${QUALIFIED_OPENCODE_VERSION}`);
  }

  const nativeEntries = collectNativePackages(root);
  const selected = nativeEntries.find((entry) => entry.name === nativePackage);
  if (!selected) throw new Error(`Qualified OpenCode package ${nativePackage} is missing from the staged runtime`);
  const nativeManifest = readJson(path.join(selected.root, "package.json"), `qualified OpenCode package ${nativePackage} manifest`);
  if (
    nativeManifest.name !== nativePackage
    || nativeManifest.version !== QUALIFIED_OPENCODE_VERSION
    || !Array.isArray(nativeManifest.os)
    || !nativeManifest.os.includes(platform)
    || !Array.isArray(nativeManifest.cpu)
    || !nativeManifest.cpu.includes(arch)
  ) {
    throw new Error(`Qualified OpenCode package identity mismatch for ${nativePackage}`);
  }

  const nativeExecutable = assertInside(root, path.join(selected.root, "bin", "opencode"), "Qualified OpenCode executable");
  if (!isWithin(selected.root, nativeExecutable)) throw new Error("Qualified OpenCode executable escapes its package");
  if (!statSync(nativeExecutable).isFile()) throw new Error("Qualified OpenCode executable is not a regular file");
  const portablePath = path.join(wrapperRoot, "bin", "opencode.exe");
  const portableStat = lstatSync(portablePath);
  const portableResolved = assertInside(root, portablePath, "OpenCode portable executable");
  if (!statSync(portableResolved).isFile()) throw new Error("OpenCode portable executable is not a regular file");
  const portableIsSymlink = portableStat.isSymbolicLink();
  const portableMatchesNative = portableResolved === nativeExecutable || hashFile(portableResolved) === hashFile(nativeExecutable);
  const unexpectedPackages = nativeEntries.filter((entry) => entry.name !== nativePackage).map((entry) => entry.name).sort();

  return {
    supported: true,
    root,
    platform,
    arch,
    nativePackage,
    nativeExecutable,
    portablePath,
    portableResolved,
    portableIsSymlink,
    portableMatchesNative,
    unexpectedPackages,
    bytesSaved: 0,
    nativeEntries,
  };
}

function publicState(state) {
  return {
    supported: state.supported,
    platform: state.platform,
    arch: state.arch,
    nativePackage: state.nativePackage,
    nativeExecutable: state.nativeExecutable,
    // Return the stable portable entrypoint, not its realpath. Packaged checks
    // can execute this path and verify the relative symlink survived archiving.
    portableExecutable: state.portablePath ?? null,
    portableIsSymlink: state.portableIsSymlink,
    unexpectedPackages: state.unexpectedPackages,
    bytesSaved: state.bytesSaved,
    ...(state.supported ? { portableMatchesNative: state.portableMatchesNative } : {}),
  };
}

/**
 * Inspect the staged desktop runtime without changing it. Unsupported targets
 * deliberately return supported:false so Windows keeps its current payload.
 */
export function inspectRuntimePayload({ runtimeRoot, platform = process.platform, arch = process.arch, libc }) {
  const state = runtimeState({ runtimeRoot, platform, arch, libc });
  return publicState(state);
}

/**
 * Remove non-selected OpenCode native packages from the staged runtime and
 * replace an identical Unix portable executable with a relative symlink.
 */
export function optimizeRuntimePayload({ runtimeRoot, platform = process.platform, arch = process.arch, libc }) {
  const state = runtimeState({ runtimeRoot, platform, arch, libc });
  if (!state.supported) return publicState(state);

  let bytesSaved = 0;
  for (const entry of state.nativeEntries) {
    if (entry.name === state.nativePackage) continue;
    bytesSaved += bytesInTree(entry.root);
    for (const alias of entry.aliases) {
      // rmSync on a symlink removes only the link; all real package roots were
      // already proven to resolve inside the staged runtime.
      assertMutablePath(state.root, alias, `OpenCode package ${entry.name}`);
      rmSync(alias, { recursive: true, force: true });
    }
    if (existsSync(entry.root)) {
      assertMutablePath(state.root, entry.root, `OpenCode package ${entry.name}`);
      rmSync(entry.root, { recursive: true, force: true });
    }
  }

  let portableIsSymlink = state.portableIsSymlink;
  let portableMatchesNative = state.portableMatchesNative;
  if (!portableIsSymlink && portableMatchesNative) {
    const relativeTarget = path.relative(path.dirname(state.portablePath), state.nativeExecutable);
    const linkedTarget = path.resolve(path.dirname(state.portablePath), relativeTarget);
    if (!relativeTarget || path.isAbsolute(relativeTarget) || linkedTarget !== state.nativeExecutable || !isWithin(state.root, linkedTarget)) {
      throw new Error("OpenCode portable executable cannot be linked without escaping its package");
    }
    assertMutablePath(state.root, state.portablePath, "OpenCode portable executable");
    bytesSaved += lstatSync(state.portablePath).size;
    rmSync(state.portablePath, { force: true });
    symlinkSync(relativeTarget, state.portablePath, "file");
    portableIsSymlink = true;
  }

  const inspected = runtimeState({ runtimeRoot, platform, arch, libc });
  if (inspected.unexpectedPackages.length > 0) {
    throw new Error(`OpenCode payload optimization left unexpected packages: ${inspected.unexpectedPackages.join(", ")}`);
  }
  inspected.bytesSaved = bytesSaved;
  return publicState(inspected);
}

/**
 * Remove only the native Copilot npm package that was used to materialize
 * already-verified server-owned provider assets. The caller must run the final
 * server verifier first; this function never replaces that admission check.
 */
export function pruneVerifiedCopilotMaterializer({ runtimeRoot, platform = process.platform, arch = process.arch }) {
  const packageName = resolveQualifiedCopilotMaterializerPackage(platform, arch);
  if (!packageName) {
    return { supported: false, platform, arch, packageName: null, bytesSaved: 0 };
  }

  const root = assertRuntimeRoot(runtimeRoot);
  const entries = collectCopilotMaterializerPackages(root, packageName);
  let bytesSaved = 0;
  for (const entry of entries) {
    bytesSaved += bytesInTree(entry.root);
    for (const alias of entry.aliases) {
      assertMutablePath(root, alias, `Copilot materializer package ${packageName}`);
      rmSync(alias, { recursive: true, force: true });
    }
    if (existsSync(entry.root)) {
      assertMutablePath(root, entry.root, `Copilot materializer package ${packageName}`);
      rmSync(entry.root, { recursive: true, force: true });
    }
  }

  return { supported: true, platform, arch, packageName, bytesSaved };
}

export const runtimePayloadInternals = {
  QUALIFIED_OPENCODE_VERSION,
  NATIVE_PACKAGE_BY_TARGET,
};

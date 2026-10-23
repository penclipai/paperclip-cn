#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { detachOwnedReadonlyVolume } from "./installer-volume.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function boundedOutput(value) {
  const text = String(value ?? "").trim();
  return text ? text.slice(-4_000) : "no diagnostic output";
}

function runArchiveCommand(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 180_000,
    windowsHide: true,
    shell: false,
  });
  if (result.error || result.status !== 0) {
    const diagnostic = String(result.stderr ?? "").trim() || result.error?.message;
    throw new Error(`Installer inspection command failed: ${path.basename(command)} (exit ${String(result.status)}): ${boundedOutput(diagnostic)}`);
  }
  return result;
}

/** Run native-module-sensitive validation outside the process that mounted a DMG. */
export function runRuntimePayloadProbe({ runtimeRoot, platform, arch, description, spawn = spawnSync }) {
  const probe = path.join(scriptDir, "probe-runtime-payload.mjs");
  const result = spawn(process.execPath, [probe, "--runtime-root", runtimeRoot, "--platform", platform, "--arch", arch, "--description", description], {
    encoding: "utf8", timeout: 90_000, maxBuffer: 1024 * 1024, windowsHide: true, shell: false,
  });
  if (result.error || result.status !== 0) {
    const diagnostic = String(result.stderr ?? "").trim() || result.error?.message;
    throw new Error(`Packaged runtime probe failed for ${description} (exit ${String(result.status)}): ${boundedOutput(diagnostic)}`);
  }
  if (result.stdout?.trim()) console.log(result.stdout.trim());
}

function assertRuntimeInsideApplication(manifest) {
  const runtimeRoot = realpathSync(manifest.runtimePath);
  const appRoot = realpathSync(manifest.unpackedAppPath);
  const relative = path.relative(appRoot, runtimeRoot);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Packaged runtime is outside the unpacked application.");
  }
  return runtimeRoot;
}

/**
 * Cleanup stays separate so a failed detach never makes rmSync traverse an
 * active DMG mount. The caller preserves any earlier verification error.
 */
export function cleanupMountedInstallerVolume({
  temporaryRoot,
  mounted,
  detach,
  remove = (target) => rmSync(target, { recursive: true, force: true }),
}) {
  let detachResult = null;
  if (mounted) {
    detachResult = detach();
  }
  remove(temporaryRoot);
  return { mounted: false, detach: detachResult, preservedTemporaryRoot: null };
}

function verifyInstallerPayload(manifest) {
  if (manifest.platform === "win" || !manifest.releaseAssetPaths?.length) return;
  if (manifest.releaseAssetPaths.length !== 1) throw new Error("Expected exactly one Unix installer.");
  const installer = realpathSync(manifest.releaseAssetPaths[0]);
  const temporaryRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "paperclip-installer-payload-")));
  let mountPoint = null;
  let mounted = false;
  let failure = null;
  try {
    let installerRuntime;
    if (manifest.platform === "mac") {
      mountPoint = path.join(temporaryRoot, "volume");
      mkdirSync(mountPoint);
      runArchiveCommand("hdiutil", ["attach", "-readonly", "-nobrowse", "-quiet", "-mountpoint", mountPoint, installer]);
      mounted = true;
      const apps = readdirSync(mountPoint, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
      if (apps.length !== 1) throw new Error("Expected one application in the release DMG.");
      installerRuntime = path.join(mountPoint, apps[0].name, "Contents", "Resources", "app-runtime");
    } else {
      runArchiveCommand(installer, ["--appimage-extract"], temporaryRoot);
      installerRuntime = path.join(temporaryRoot, "squashfs-root", "resources", "app-runtime");
    }
    runRuntimePayloadProbe({ runtimeRoot: installerRuntime, platform: manifest.nodePlatform, arch: manifest.arch, description: "release installer" });
  } catch (error) {
    failure = error;
  } finally {
    try {
      const cleanup = cleanupMountedInstallerVolume({
        temporaryRoot,
        mounted,
        detach: () => detachOwnedReadonlyVolume({
          temporaryRoot,
          mountPoint,
          readonlyMount: true,
          runCommand: (command, commandArgs) => spawnSync(command, commandArgs, {
            encoding: "utf8", stdio: ["ignore", "ignore", "pipe"], timeout: 180_000, windowsHide: true, shell: false,
          }),
        }),
      });
      if (cleanup.detach?.forced) {
        console.warn(`[desktop-runtime-payload] Detached busy installer volume with force after ${cleanup.detach.attempts - 1} normal retries.`);
      }
    } catch (cleanupError) {
      const message = `Installer volume cleanup failed; preserving ${temporaryRoot}: ${cleanupError.message}`;
      if (!failure) failure = new Error(message, { cause: cleanupError });
      else console.error(`[desktop-runtime-payload] ${message}`);
    }
  }
  if (failure) throw failure;
}

export function verifyRuntimePayloadManifest(manifest) {
  const expectedPlatform = { mac: "darwin", linux: "linux", win: "win32" }[manifest.platform];
  if (!expectedPlatform || manifest.nodePlatform !== expectedPlatform || manifest.nodePlatform !== process.platform || manifest.arch !== process.arch) {
    throw new Error("Packaged runtime verification requires the matching native build host.");
  }
  runRuntimePayloadProbe({ runtimeRoot: assertRuntimeInsideApplication(manifest), platform: manifest.nodePlatform, arch: manifest.arch, description: "unpacked application" });
  verifyInstallerPayload(manifest);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--manifest" || !args[1]) throw new Error("Usage: verify-runtime-payload.mjs --manifest <desktop-artifacts.json>");
  verifyRuntimePayloadManifest(JSON.parse(readFileSync(path.resolve(args[1]), "utf8")));
}

const invokedPath = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : null;
if (invokedPath === import.meta.url) main();

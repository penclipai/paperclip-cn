#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspectRuntimePayload, runtimePayloadInternals } from "./runtime-payload.mjs";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--manifest" || !args[1]) {
  throw new Error("Usage: verify-runtime-payload.mjs --manifest <desktop-artifacts.json>");
}

const manifest = JSON.parse(readFileSync(path.resolve(args[1]), "utf8"));
const expectedPlatform = { mac: "darwin", linux: "linux", win: "win32" }[manifest.platform];
if (!expectedPlatform || manifest.nodePlatform !== expectedPlatform
  || manifest.nodePlatform !== process.platform || manifest.arch !== process.arch) {
  throw new Error("Packaged runtime verification requires the matching native build host.");
}
const runtimeRoot = realpathSync(manifest.runtimePath);
const appRoot = realpathSync(manifest.unpackedAppPath);
const relative = path.relative(appRoot, runtimeRoot);
if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
  throw new Error("Packaged runtime is outside the unpacked application.");
}
await verifyPayload(runtimeRoot, "unpacked application");

// The installer is a second serialization boundary. Verify its actual contents,
// not just the directory that electron-builder used as input.
if (manifest.platform !== "win" && manifest.releaseAssetPaths?.length) {
  if (manifest.releaseAssetPaths.length !== 1) throw new Error("Expected exactly one Unix installer.");
  const installer = realpathSync(manifest.releaseAssetPaths[0]);
  const temporaryRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "paperclip-installer-payload-")));
  let mountPoint = null;
  let mounted = false;
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
    await verifyPayload(installerRuntime, "release installer");
  } finally {
    if (mounted) {
      runArchiveCommand("hdiutil", ["detach", "-quiet", mountPoint]);
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function runArchiveCommand(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, { cwd, stdio: "ignore", timeout: 180_000, windowsHide: true, shell: false });
  if (result.error || result.status !== 0) throw new Error(`Installer inspection command failed: ${path.basename(command)} (exit ${result.status}).`);
}

async function verifyPayload(runtimeRoot, description) {
  const payload = inspectRuntimePayload({ runtimeRoot, platform: manifest.nodePlatform, arch: manifest.arch });
  if (!payload.supported) {
    if (manifest.platform !== "win" || manifest.arch !== "x64") {
      throw new Error("No reviewed native payload policy exists for this desktop target.");
    }
    console.log("[desktop-runtime-payload] Windows x64 payload preserved; Unix OpenCode trimming does not apply.");
  } else {
    if (payload.unexpectedPackages.length > 0) {
      throw new Error(`Unexpected OpenCode native packages: ${payload.unexpectedPackages.join(", ")}`);
    }
    if (payload.portableMatchesNative && !payload.portableIsSymlink) {
      throw new Error("Packaging expanded the deduplicated OpenCode portable executable into a second file.");
    }
    // Exercise the actual vendored Runner resolver, rather than only repeating
    // the staging policy. No provider session, credentials, or inference is used.
    const resolverPath = path.resolve(runtimeRoot, "server/dist/vendor/paperclip-runner/drivers/opencode/opencode-server-driver.js");
    const { resolvePinnedOpenCodeCommand } = await import(pathToFileURL(resolverPath).href);
    if (realpathSync(resolvePinnedOpenCodeCommand()) !== realpathSync(payload.nativeExecutable)) {
      throw new Error("The packaged Runner selected a different OpenCode executable.");
    }
    for (const executable of [payload.nativeExecutable, payload.portableExecutable]) {
      const result = spawnSync(executable, ["--version"], {
        encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
        windowsHide: true, shell: false,
      });
      if (result.error || result.status !== 0
        || result.stdout.trim() !== runtimePayloadInternals.QUALIFIED_OPENCODE_VERSION) {
        throw new Error(`Packaged OpenCode version probe failed for ${path.relative(runtimeRoot, executable)}.`);
      }
    }
    console.log(`[desktop-runtime-payload] ${manifest.platform}/${manifest.arch} ${description}: ${payload.nativePackage}, Runner resolution and both executable entrypoints passed.`);
  }
}

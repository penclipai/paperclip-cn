import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const helper = fileURLToPath(new URL("../prepare-desktop-release-assets.mjs", import.meta.url));
const version = "2026.1021.0";
const targets = [
  ["win-x64", "win", "x64", "x64", ".exe"],
  ["mac-x64", "mac", "x64", "x64", ".dmg"],
  ["mac-arm64", "mac", "arm64", "arm64", ".dmg"],
  ["linux-x64", "linux", "x64", "x86_64", ".AppImage"],
];

function installerName(target, releaseVersion = version) {
  return `Paperclip-CN-${releaseVersion}-${target[3]}${target[4]}`;
}

function writeBundle(root, target, { releaseVersion = version, platform = target[1], arch = target[2], assetName = installerName(target) } = {}) {
  const releaseDir = path.join(root, `desktop-${target[0]}`, "packages", "desktop-electron", "release");
  mkdirSync(releaseDir, { recursive: true });
  writeFileSync(path.join(releaseDir, assetName), `${target[0]}\n`);
  writeFileSync(path.join(releaseDir, "desktop-artifacts.json"), JSON.stringify({
    platform,
    arch,
    releaseVersion,
    releaseAssetPaths: [`C:\\native\\release\\${assetName}`],
  }));
  return releaseDir;
}

function fixture(callback) {
  const root = mkdtempSync(path.join(tmpdir(), "desktop-release-assets-"));
  try {
    for (const target of targets) writeBundle(root, target);
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function run(root) {
  return spawnSync(process.execPath, [helper, "--bundles-dir", root, "--output-dir", path.join(root, "release-assets"), "--release-version", version, "--artifact-prefix", "desktop"], { encoding: "utf8" });
}

test("stages exactly four manifest-validated installers and regenerates SHA256SUMS", () => fixture((root) => {
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  const checksums = readFileSync(path.join(root, "release-assets", "SHA256SUMS.txt"), "utf8").trim().split("\n");
  const expected = targets.map((target) => {
    const name = installerName(target);
    return `${createHash("sha256").update(`${target[0]}\n`).digest("hex")}  ${name}`;
  }).sort();
  assert.deepEqual(checksums.sort(), expected);
}));

test("rejects a manifest release version that differs from the requested cohort", () => fixture((root) => {
  writeBundle(root, targets[0], { releaseVersion: "2026.1020.0", assetName: installerName(targets[0], "2026.1020.0") });
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected release version/);
}));

test("rejects a manifest target that does not match its exact downloaded bundle", () => fixture((root) => {
  writeBundle(root, targets[1], { platform: "linux" });
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected manifest target/);
}));

test("rejects a missing expected target bundle", () => fixture((root) => {
  rmSync(path.join(root, "desktop-linux-x64"), { recursive: true, force: true });
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing downloaded bundle/);
}));

test("rejects a manifest that names an installer outside the exact versioned contract", () => fixture((root) => {
  writeBundle(root, targets[2], { assetName: "Paperclip-CN-2026.1021.0-x64.dmg" });
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected installer name/);
}));

test("rejects duplicate manifests in an exact bundle", () => fixture((root) => {
  const duplicateDir = path.join(root, "desktop-win-x64", "duplicate");
  mkdirSync(duplicateDir, { recursive: true });
  writeFileSync(path.join(duplicateDir, "desktop-artifacts.json"), "{}");
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Expected exactly one manifest/);
}));

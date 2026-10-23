import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../workflows/desktop-release.yml", import.meta.url), "utf8");
const matrixScript = source.match(/\/\/ desktop-target-matrix:start([\s\S]*?)\/\/ desktop-target-matrix:end/)?.[1];
assert.ok(matrixScript, "The desktop matrix resolver must remain inspectable.");

test("desktop defaults retain all four supported build targets", () => {
  const result = spawnSync(process.execPath, ["-e", matrixScript], { encoding: "utf8", env: { ...process.env, DESKTOP_TARGET: "all" } });
  assert.equal(result.status, 0, result.stderr);
  const matrix = JSON.parse(result.stdout.trim().replace(/^matrix=/, ""));
  assert.deepEqual(matrix.include.map(({ platform, arch }) => `${platform}-${arch}`).sort(), ["linux-x64", "mac-arm64", "mac-x64", "win-x64"]);
  assert.match(source, /matrix: \$\{\{ fromJSON\(needs\.resolve_targets\.outputs\.matrix\) \}\}/);
});

test("desktop can select Intel alone without accepting arbitrary runners", () => {
  const selected = spawnSync(process.execPath, ["-e", matrixScript], { encoding: "utf8", env: { ...process.env, DESKTOP_TARGET: "mac-x64" } });
  assert.equal(selected.status, 0, selected.stderr);
  assert.deepEqual(JSON.parse(selected.stdout.trim().replace(/^matrix=/, "")).include, [{ runner: "macos-15-intel", platform: "mac", arch: "x64" }]);
  const invalid = spawnSync(process.execPath, ["-e", matrixScript], { encoding: "utf8", env: { ...process.env, DESKTOP_TARGET: "self-hosted" } });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Unsupported desktop target/);
});

test("failed validation preserves diagnostic installers without publishing them", () => {
  assert.match(source, /name: Preserve built installers after a failed check\r?\n\s+if: failure\(\)/);
  assert.match(source, /name: Upload desktop assets to GitHub Release\r?\n\s+if: inputs\.upload_to_release/);
});

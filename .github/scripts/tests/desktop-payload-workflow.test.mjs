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

test("release publishing is fail-closed for a partial target or missing release tag", () => {
  assert.match(source, /if \[ "\$UPLOAD_TO_RELEASE" = "true" \] && \[ -z "\$GITHUB_RELEASE_TAG" \]/);
  assert.match(source, /if \[ "\$UPLOAD_TO_RELEASE" = "true" \] && \[ "\$DESKTOP_TARGET" != "all" \]/);
  assert.match(source, /upload_to_release=true requires target=all/);
});

test("release upload waits for the whole matrix and downloads only exact bundles", () => {
  assert.match(source, /upload_desktop_assets_to_release:\r?\n\s+needs: build_desktop_assets\r?\n\s+if: inputs\.upload_to_release && needs\.build_desktop_assets\.result == 'success'/);
  for (const target of ["win-x64", "mac-x64", "mac-arm64", "linux-x64"]) {
    assert.match(source, new RegExp("name: \\$\\{\\{ inputs\\.artifact_name \\}\\}-" + target));
    assert.match(source, new RegExp("path: desktop-bundles/\\$\\{\\{ inputs\\.artifact_name \\}\\}-" + target));
  }
  assert.match(source, /prepare-desktop-release-assets\.mjs/);
  assert.match(source, /gh release upload "\$RELEASE_TAG" release-assets\/\*/);
  assert.doesNotMatch(source, /gh release upload[\s\S]*steps\.manifest\.outputs\.release_asset_paths/);
});

test("fanin uploader checks out the workflow revision and passes release values through quoted environment variables", () => {
  assert.match(source, /name: Checkout release uploader[\s\S]*?fetch-depth: 1[\s\S]*?persist-credentials: false[\s\S]*?ref: \$\{\{ github\.sha \}\}/);
  assert.match(source, /name: Setup Node\.js[\s\S]*?node-version: 24[\s\S]*?package-manager-cache: false[\s\S]*?name: Download Windows installer bundle/);
  assert.match(source, /RELEASE_VERSION: \$\{\{ inputs\.release_version \}\}[\s\S]*?ARTIFACT_PREFIX: \$\{\{ inputs\.artifact_name \}\}[\s\S]*?--release-version "\$RELEASE_VERSION"[\s\S]*?--artifact-prefix "\$ARTIFACT_PREFIX"/);
  assert.match(source, /RELEASE_TAG: \$\{\{ inputs\.github_release_tag \}\}[\s\S]*?RELEASE_REPOSITORY: \$\{\{ github\.repository \}\}[\s\S]*?gh release upload "\$RELEASE_TAG" release-assets\/\* --repo "\$RELEASE_REPOSITORY"/);
  assert.doesNotMatch(source, /--release-version "\$\{\{ inputs\.release_version \}\}"|--artifact-prefix "\$\{\{ inputs\.artifact_name \}\}"|gh release upload "\$\{\{ inputs\.github_release_tag \}\}"/);
});

test("failed validation preserves diagnostic installers without publishing them", () => {
  assert.match(source, /name: Preserve built installers after a failed check\r?\n\s+if: failure\(\)/);
  assert.match(source, /name: Upload desktop size audit evidence\r?\n\s+if: always\(\)/);
  assert.match(source, /build_desktop_assets:[\s\S]*?permissions:\r?\n\s+contents: read/);
  assert.match(source, /upload_desktop_assets_to_release:[\s\S]*?permissions:\r?\n\s+contents: write/);
});

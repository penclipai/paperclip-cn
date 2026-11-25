import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8").replaceAll("\r\n", "\n");
const canaryFinalizeWorkflow = readFileSync(".github/workflows/canary-finalize.yml", "utf8").replaceAll("\r\n", "\n");
const desktopBuilderConfig = readFileSync("packages/desktop-electron/electron-builder.yml", "utf8").replaceAll("\r\n", "\n");

test("canary reuses successful exact-source verification and stable calls the shared verifier", () => {
  assert.match(releaseWorkflow, /^  verify_canary:/m);
  assert.match(releaseWorkflow, /run: node scripts\/cloud-source-verification\.mjs "\$SOURCE_SHA"/);
  assert.match(releaseWorkflow, /^  publish_canary:\n[\s\S]*?    needs: \[verify_canary, release_runner_source, release_runner_binaries\]/m);
  assert.match(releaseWorkflow, /^  verify_stable:\n[\s\S]*?uses: \.\/\.github\/workflows\/release-verify\.yml/m);
  assert.match(releaseWorkflow, /^  publish_stable:\n[\s\S]*?    needs: \[preflight_stable, verify_stable, release_runner_source, release_runner_binaries\]/m);
});

test("release publish jobs use GitHub OIDC without registry token injection", () => {
  const job = (name) => releaseWorkflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z_]+:|$(?![\\s\\S]))`, "m"))?.[1] ?? "";
  for (const lane of ["preview", "canary", "nightly", "beta", "stable"]) {
    assert.match(job(`publish_${lane}`), /id-token: write/);
  }
  assert.equal((releaseWorkflow.match(/secrets\.NPM_TOKEN/g) ?? []).length, 0);
  assert.doesNotMatch(releaseWorkflow, /- name: Verify npm auth|npm whoami|registry-url: https:\/\/registry\.npmjs\.org|always-auth: true/);
});

test("tokenless OIDC leaves canary and stable release gates intact", () => {
  const job = (name) => releaseWorkflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z_]+:|$(?![\\s\\S]))`, "m"))?.[1] ?? "";
  const publishCanary = job("publish_canary");
  assert.match(publishCanary, /contents: read/);
  assert.match(publishCanary, /actions: write/);
  assert.match(publishCanary, /gh workflow run canary-finalize\.yml/);
  assert.match(canaryFinalizeWorkflow, /contents: write/);
  assert.match(canaryFinalizeWorkflow, /actions: write/);
  const publishStable = job("publish_stable");
  assert.match(publishStable, /contents: write/);
  assert.match(publishStable, /actions: write/);
  assert.match(publishStable, /GITHUB_ACTIONS: "true"/);
  assert.match(publishCanary, /needs: \[verify_canary, release_runner_source, release_runner_binaries\]/);
  assert.match(publishStable, /needs: \[preflight_stable, verify_stable, release_runner_source, release_runner_binaries\]/);
});

test("release publish jobs trigger smoke and desktop follow-ups", () => {
  assert.match(canaryFinalizeWorkflow, /^  smoke_canary_onboarding:/m);
  for (const job of ["desktop_stable", "smoke_stable"]) {
    assert.match(releaseWorkflow, new RegExp(`^  ${job}:`, "m"));
  }

  assert.match(canaryFinalizeWorkflow, /run: pnpm run test:canary-onboarding-smoke/);
  assert.match(canaryFinalizeWorkflow, /PAPERCLIPAI_VERSION: \$\{\{ needs\.confirm_canary\.outputs\.version \}\}/);
  assert.match(releaseWorkflow, /paperclip_version: latest/);
  assert.match(releaseWorkflow, /uses: \.\/\.github\/workflows\/desktop-release\.yml/);
  assert.match(releaseWorkflow, /source_ref: \$\{\{ needs\.publish_stable\.outputs\.stable_tag \}\}/);
});

test("desktop release config uses a safe executable name", () => {
  assert.match(desktopBuilderConfig, /^executableName: Paperclip-CN$/m);
});

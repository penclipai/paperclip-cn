import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Pins the wiring that makes the background-service smoke an effective gate.
// The service leg exists because v2026.824.0 shipped a service install that
// crash-looped on a missing shim while the Docker smoke stayed green; these
// assertions keep the job from being silently disconnected or weakened.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const scriptPath = join(repoRoot, "scripts", "service-onboard-smoke.sh");
const script = readFileSync(scriptPath, "utf8");
const cliPackage = JSON.parse(readFileSync(join(repoRoot, "cli", "package.json"), "utf8"));
const installStore = readFileSync(join(repoRoot, "cli", "src", "install-store.ts"), "utf8");
const serviceManager = readFileSync(join(repoRoot, "cli", "src", "services", "service-manager.ts"), "utf8");
const smokeWorkflow = readFileSync(join(repoRoot, ".github", "workflows", "release-smoke.yml"), "utf8");
const releaseWorkflow = readFileSync(join(repoRoot, ".github", "workflows", "release.yml"), "utf8");

const packageName = cliPackage.name;
const installStoreShimName = installStore.match(/shimPath:\s*path\.join\(homeDir,\s*"\.local",\s*"bin",\s*"([^"]+)"\)/)?.[1];
const defaultServiceName = serviceManager.match(/return instanceId === "default" \? "([^"]+\.service)"/)?.[1];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("smoke script is executable and parses", () => {
  accessSync(scriptPath, constants.X_OK);
  execFileSync("bash", ["-n", "scripts/service-onboard-smoke.sh"], { cwd: repoRoot, encoding: "utf8" });
});

test("smoke script keeps its load-bearing assertions", () => {
  assert.match(script, /^set -euo pipefail$/m);
  // Onboards the published artifact with the service leg forced on.
  assert.match(script, /onboard --yes --install-service/);
  // Fails when the shim never materialized.
  assert.match(script, /no executable shim at .*after onboarding/);
  // Fails when the unit dies instead of serving.
  assert.match(script, /entered the failed state/);
  // Fails when health answers but the service is not what is serving --
  // the exact signature of the v2026.824.0 defect.
  assert.match(script, /something other than the service is serving/);
  // Refuses to smoke over a real install unless forced.
  assert.match(script, /SMOKE_FORCE/);
});

test("smoke script follows the fork CLI install and service contracts", () => {
  assert.equal(typeof packageName, "string", "cli/package.json must declare the published CLI name");
  assert.equal(installStoreShimName, packageName, "managed installer shim must use the published CLI name");
  assert.ok(defaultServiceName, "service-manager must retain a default technical systemd unit");

  const expectedShim = `$HOME/.local/bin/${installStoreShimName}`;
  assert.match(script, new RegExp(`^SHIM_PATH="\\$\\{PAPERCLIP_SHIM_PATH:-${escapeRegExp(expectedShim)}\\}"$`, "m"));
  assert.match(script, new RegExp(`npx --yes "${escapeRegExp(packageName)}@\\$\\{PAPERCLIPAI_VERSION\\}" onboard --yes --install-service`));
  assert.match(script, new RegExp(`^SERVICE_NAME="${escapeRegExp(defaultServiceName)}"$`, "m"));
});

test("release-smoke workflow runs the service leg against the input version", () => {
  assert.match(smokeWorkflow, /^  smoke_service:$/m);
  assert.match(smokeWorkflow, /scripts\/service-onboard-smoke\.sh/);
  const serviceJob = smokeWorkflow.split(/^  smoke:$/m)[0];
  assert.match(serviceJob, /PAPERCLIPAI_VERSION: \$\{\{ inputs\.paperclip_version \}\}/);
  // Diagnostics must survive the run: cleanup stays off in CI and the
  // artifact name cannot collide with the Docker job's upload.
  assert.match(serviceJob, /SMOKE_CLEANUP: "false"/);
  assert.match(serviceJob, /\$\{\{ inputs\.artifact_name \}\}-service/);
});

test("nightly and beta smokes still route through the reusable workflow", () => {
  const calls = releaseWorkflow.match(/uses: \.\/\.github\/workflows\/release-smoke\.yml/g) ?? [];
  assert.ok(calls.length >= 2, "smoke_nightly and smoke_beta must call release-smoke.yml so smoke_service gates them");
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function readWorkflow(name) {
  return readFileSync(path.join(repoRoot, ".github/workflows", name), "utf8");
}

function jobBlock(workflow, jobName) {
  const normalizedWorkflow = workflow.replace(/\r\n/g, "\n");
  const match = `\n${normalizedWorkflow}`.match(
    new RegExp(`\\n  ${jobName}:\\n([\\s\\S]*?)(?=\\n  [A-Za-z0-9_]+:\\n|\\n?$)`),
  );
  assert.ok(match, `expected workflow job ${jobName}`);
  return match[1];
}

test("release workflow delegates stable and canary verification to the reusable workflow", () => {
  const releaseWorkflow = readWorkflow("release.yml");

  assert.match(
    jobBlock(releaseWorkflow, "verify_canary_core"),
    /if: github\.event_name == 'push'\n\s+uses: \.\/\.github\/workflows\/release-verify\.yml\n\s+with:\n\s+ref: \$\{\{ github\.sha \}\}/,
  );
  assert.match(
    jobBlock(releaseWorkflow, "verify_stable_core"),
    /if: github\.event_name == 'workflow_dispatch'\n\s+uses: \.\/\.github\/workflows\/release-verify\.yml\n\s+with:\n\s+ref: \$\{\{ inputs\.source_ref \}\}/,
  );
  assert.match(jobBlock(releaseWorkflow, "publish_canary"), /needs:\n\s+- verify_canary_core\n\s+- verify_canary_general_tests\n\s+- verify_canary_serialized_server/);
  assert.match(jobBlock(releaseWorkflow, "publish_stable"), /needs:\n\s+- verify_stable_core\n\s+- verify_stable_general_tests\n\s+- verify_stable_serialized_server/);
  assert.doesNotMatch(jobBlock(releaseWorkflow, "verify_canary_core"), /pnpm test:run(?:\n|$)/);
  assert.doesNotMatch(
    jobBlock(releaseWorkflow, "verify_stable_core"),
    /pnpm test:run(?:\n|$)/,
  );
});

test("release verify workflow covers the same split test surface as stable PR verification", () => {
  const verifyWorkflow = readWorkflow("release-verify.yml");

  assert.match(verifyWorkflow, /workflow_call:/);
  assert.match(verifyWorkflow, /node \.\/scripts\/release-package-map\.mjs check/);
  assert.match(verifyWorkflow, /pnpm -r typecheck/);
  assert.match(verifyWorkflow, /pnpm build/);

  for (const group of ["general-server", "general-workspaces-a", "general-workspaces-b"]) {
    assert.match(verifyWorkflow, new RegExp(`group: ${group}`));
  }

  for (const shardIndex of [0, 1, 2]) {
    assert.match(
      verifyWorkflow,
      new RegExp(`group: general-server[\\s\\S]*?shard_index: ${shardIndex}[\\s\\S]*?shard_count: 3`),
    );
  }

  for (const shardIndex of [0, 1, 2, 3, 4]) {
    assert.match(verifyWorkflow, new RegExp(`shard_index: ${shardIndex}[\\s\\S]*?shard_count: 5`));
  }

  assert.match(verifyWorkflow, /pnpm test:run:general -- --group/);
  assert.match(verifyWorkflow, /pnpm test:run:serialized -- --shard-index/);
});

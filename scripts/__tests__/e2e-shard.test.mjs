import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  defaultSuiteWeight,
  loadShardDurations,
} from "../general-server-shard.mjs";
import {
  DEFAULT_PARALLEL_WORKERS,
  EFFECTIVE_PARALLEL_SPEEDUP,
  EFFECTIVE_PARALLEL_SPEEDUP_4W,
  IGNORED_SPECS,
  SERIAL_SPECS,
  isSerialE2eSpec,
  listE2eSpecs,
  partitionE2eShards,
  resolveEffectiveParallelSpeedup,
  selectE2eShard,
} from "../e2e-shard.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const script = path.join(repoRoot, "scripts", "e2e-shard.mjs");
const durationsManifest = path.join(
  repoRoot,
  "scripts",
  "e2e-shard-durations.json",
);
const playwrightConfig = path.join(
  repoRoot,
  "tests",
  "e2e",
  "playwright.config.ts",
);
const prCallerWorkflow = path.join(repoRoot, ".github", "workflows", "pr.yml");
const trustedPrWorkflowPath = ".github/workflows/pr-trusted.yml";
const trustedPrWorkflow = path.join(repoRoot, trustedPrWorkflowPath);
const routingWorkflow = path.join(
  repoRoot,
  ".github",
  "workflows",
  "ci-routing.yml",
);
const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";

const ciTaskMatrixPath = path.join(repoRoot, ".github", "ci-task-matrix.json");
const SHARD_COUNT = JSON.parse(readFileSync(ciTaskMatrixPath, "utf8")).e2e_shards.length;
const TARGET_AWS_SHARD_COUNT = 16;
const TARGET_HOSTED_SHARD_COUNT = 4;

function bashPath(value) {
  if (process.platform !== "win32") return value;
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(value);
  if (!match) return value.replaceAll("\\", "/");
  const [, drive, rest] = match;
  const root = process.env.MSYSTEM
    ? `/${drive.toLowerCase()}`
    : `/mnt/${drive.toLowerCase()}`;
  return `${root}/${rest.replaceAll("\\", "/")}`;
}

function bashQuote(value) {
  return `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;
}

function runShard(args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `expected success for ${args.join(" ")}: ${result.stderr}`,
  );
  return result.stdout.trim().split(/\s+/).filter(Boolean);
}

function readTrustedPrWorkflow() {
  const caller = readFileSync(prCallerWorkflow, "utf8");
  assert.match(
    caller,
    /^\s+uses: penclipai\/paperclip-cn\/\.github\/workflows\/pr-trusted\.yml@[0-9a-f]{40}\s*$/m,
    "pr.yml must call the trusted workflow from an immutable fork commit",
  );
  const pinnedSha = caller.match(
    /uses: penclipai\/paperclip-cn\/\.github\/workflows\/pr-trusted\.yml@([0-9a-f]{40})\s*$/m,
  )?.[1];
  assert.ok(pinnedSha, "missing immutable trusted workflow SHA");
  const pinned = spawnSync(
    "git",
    ["show", `${pinnedSha}:${trustedPrWorkflowPath}`],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(
    pinned.status,
    0,
    `Cannot read pinned trusted workflow ${pinnedSha}: ${pinned.stderr}`,
  );
  const source = pinned.stdout.replaceAll("\r\n", "\n");
  return source;
}

function readProposedTrustedPrWorkflow() {
  // Workflow activation, ancestry, and dormant-source integrity are enforced
  // by cn-workflow-source-guard and its identity test. This reader checks the
  // candidate's E2E contract without treating it as the caller's active blob.
  return readFileSync(trustedPrWorkflow, "utf8").replaceAll("\r\n", "\n");
}

function readWorkflowJobs(workflow) {
  const jobs = new Map();
  let current = null;
  for (const line of workflow.split("\n")) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      current = header[1];
      jobs.set(current, []);
      continue;
    }
    if (current && /^\S/.test(line)) current = null;
    if (current) jobs.get(current).push(line);
  }
  for (const [id, lines] of jobs) jobs.set(id, lines.join("\n"));
  return jobs;
}

function runStackScope(stack, prBaseRef) {
  const workflow = readFileSync(routingWorkflow, "utf8");
  const match = workflow.match(
    /      - name: Select PR CI scope[\s\S]*?        run: \|\n([\s\S]*?)(?=\n      - name:|$)/,
  );
  assert.ok(match, "routing workflow must define the PR CI scope script");
  const script = match[1]
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
  const scratch = mkdtempSync(path.join(tmpdir(), "paperclip-stack-scope-"));
  const output = path.join(scratch, "github-output");
  const jqFixture = path.join(scratch, "jq-fixture.cjs");
  const fixtureScriptPath = path.join(scratch, "scope.sh");

  try {
    // GitHub-hosted runners provide jq. The local Windows test environment can
    // be either Git Bash or WSL and may not, so model only the queries this
    // scope selector uses instead of relying on a machine-global executable.
    writeFileSync(
      jqFixture,
      `const input = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
const filter = process.argv.at(-1);
if (filter === "type == \\\"object\\\"") process.exit(input && !Array.isArray(input) && typeof input === "object" ? 0 : 1);
const match = /^\\.([A-Za-z_][\\w-]*)(?:\\.([A-Za-z_][\\w-]*))? \\//.exec(filter);
if (!match) process.exit(2);
const value = match[2] ? input?.[match[1]]?.[match[2]] : input?.[match[1]];
if (value !== undefined && value !== null) process.stdout.write(String(value));
`,
    );
    const fixtureScript = `function jq() { node ${bashQuote(bashPath(jqFixture))} "$@"; }
export GITHUB_OUTPUT=${bashQuote(bashPath(output))}
export PR_BASE_REF=${bashQuote(prBaseRef)}
export STACK_JSON=${bashQuote(JSON.stringify(stack))}
${script}`;
    writeFileSync(fixtureScriptPath, fixtureScript.replaceAll("\r\n", "\n"));
    const result = spawnSync("bash", [bashPath(fixtureScriptPath)], {
      encoding: "utf8",
      env: process.env,
    });
    assert.equal(
      result.status,
      0,
      `${result.error ?? ""}\n${result.signal ?? ""}\n${result.stderr}`,
    );
    return Object.fromEntries(
      readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function runAggregate(block, fullCi, overrides = {}) {
  const names = /needs: \[([^\]]+)\]/.exec(block)[1].split(", ");
  const results = Object.fromEntries(names.map((name) => [name, { result: overrides[name]
    ?? (name === "gate" || name === "policy" || fullCi ? "success" : "skipped") }]));
  const legacyScript = block.split("        run: |\n")[1];
  if (!block.includes("node --input-type=module <<'NODE'")) {
    assert.ok(legacyScript, "legacy aggregate must have an executable run block");
    return spawnSync(bash, ["-e", "-s"], { encoding: "utf8", input: legacyScript, env: {
      ...process.env,
      FULL_CI: String(fullCi),
      POLICY_RESULT: results.policy?.result ?? "skipped",
      E2E_SHARDS_RESULT: results.e2e_shards?.result ?? "skipped",
    } });
  }
  const code = block.split("          node --input-type=module <<'NODE'\n")[1].split("\n          NODE")[0]
    .split("\n").map((line) => line.slice(10)).join("\n");
  return spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", env: {
    ...process.env, FULL_CI: String(fullCi), CI_PLAN: "", CI_RESULTS: JSON.stringify(results),
  } });
}

test("the e2e shards form a complete, non-overlapping partition", () => {
  const specs = listE2eSpecs();
  assert.ok(specs.length > 0, "expected a non-empty e2e spec set");

  const shards = Array.from({ length: SHARD_COUNT }, (_, index) =>
    runShard([
      "--shard-index",
      String(index),
      "--shard-count",
      String(SHARD_COUNT),
    ]),
  );

  const combined = shards.flat();
  assert.equal(
    combined.length,
    specs.length,
    "every spec must land on exactly one shard",
  );
  assert.deepEqual([...combined].sort(), [...specs].sort());
  for (const shard of shards) {
    assert.ok(
      shard.length > 0,
      "no shard may be empty — Playwright fails a run with no matching specs",
    );
  }
});

test("the ignored spec list matches playwright.config.ts testIgnore", () => {
  const config = readFileSync(playwrightConfig, "utf8");
  const match = config.match(/testIgnore:\s*\[([^\]]*)\]/);
  assert.ok(match, "expected a testIgnore array in playwright.config.ts");
  const configured = [...match[1].matchAll(/"([^"]+)"/g)].map(
    (entry) => entry[1],
  );
  assert.deepEqual([...configured].sort(), [...IGNORED_SPECS].sort());
});

test("the serial spec list matches playwright.config.ts SERIAL_SPECS and never mixes with parallel specs", () => {
  const config = readFileSync(playwrightConfig, "utf8");
  const match = config.match(/export const SERIAL_SPECS = \[([\s\S]*?)\];/);
  assert.ok(match, "expected a SERIAL_SPECS array in playwright.config.ts");
  const configured = [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
  assert.deepEqual([...configured].sort(), [...SERIAL_SPECS].sort());

  const specs = listE2eSpecs();
  const durations = loadShardDurations(durationsManifest);
  const shards = partitionE2eShards(specs, SHARD_COUNT, durations);
  assert.equal(shards.length, SHARD_COUNT);
  for (const shard of shards) {
    const serialCount = shard.files.filter(isSerialE2eSpec).length;
    assert.ok(
      serialCount === 0 || serialCount === shard.files.length,
      `shard must not mix serial and parallel specs: ${shard.files.join(", ")}`,
    );
  }
});

test("playwright.config.ts supports skipping the UI build when PAPERCLIP_E2E_SKIP_UI_BUILD=1 and uses unminified inline builds", () => {
  const config = readFileSync(playwrightConfig, "utf8");
  assert.match(config, /PAPERCLIP_E2E_SKIP_UI_BUILD/);
  assert.match(config, /ui-dist.*index\.html/);
  assert.match(config, /PAPERCLIP_E2E_BUILD_UI/);
  assert.match(config, /availableParallelism/);
});

test("start-e2e-server.ts boots disposable embedded Postgres without durable fsync and overlaps UI build", () => {
  const bootstrap = readFileSync(path.join(repoRoot, "tests", "e2e", "start-e2e-server.ts"), "utf8");
  assert.match(bootstrap, /--no-sync/);
  assert.match(bootstrap, /fsync = off/);
  assert.match(bootstrap, /synchronous_commit = off/);
  assert.match(bootstrap, /full_page_writes = off/);
  assert.match(bootstrap, /PAPERCLIP_E2E_BUILD_UI/);
  assert.match(bootstrap, /startParallelUiBuild/);
  assert.match(bootstrap, /"--minify",\s*"false"/);
  assert.match(bootstrap, /Promise\.all\(/);
});

test("resolveEffectiveParallelSpeedup matches Playwright worker scaling for 4-vCPU and 8-vCPU runners", () => {
  assert.equal(resolveEffectiveParallelSpeedup(2), 1);
  assert.equal(resolveEffectiveParallelSpeedup(4), EFFECTIVE_PARALLEL_SPEEDUP);
  assert.equal(resolveEffectiveParallelSpeedup(6), 2.55);
  assert.equal(resolveEffectiveParallelSpeedup(8), EFFECTIVE_PARALLEL_SPEEDUP_4W);
  assert.equal(resolveEffectiveParallelSpeedup(16), EFFECTIVE_PARALLEL_SPEEDUP_4W);
});

test("16-shard AWS partitioning stays complete, segregated, and balanced under 85s estimated wall-clock", () => {
  const durations = loadShardDurations(durationsManifest);
  const specs = listE2eSpecs();
  const fallbackWeight = defaultSuiteWeight(durations);
  const shards = partitionE2eShards(specs, TARGET_AWS_SHARD_COUNT, durations, {
    parallelWorkers: EFFECTIVE_PARALLEL_SPEEDUP_4W,
  });
  assert.equal(shards.length, TARGET_AWS_SHARD_COUNT);
  const combined = shards.flatMap((shard) => shard.files);
  assert.deepEqual([...combined].sort(), [...specs].sort());
  for (const shard of shards) {
    assert.ok(shard.files.length > 0, "no 16-shard bucket may be empty");
    const serialCount = shard.files.filter(isSerialE2eSpec).length;
    assert.ok(
      serialCount === 0 || serialCount === shard.files.length,
      `16-shard bucket must not mix serial and parallel specs: ${shard.files.join(", ")}`,
    );
  }
  const wallWeights = shards.map((shard) => {
    const serialSum = shard.files.reduce((sum, file) => sum + (durations[file] ?? fallbackWeight), 0);
    return shard.mode === "parallel" ? serialSum / EFFECTIVE_PARALLEL_SPEEDUP_4W : serialSum;
  });
  const heaviest = Math.max(...wallWeights);
  const totalWall = wallWeights.reduce((sum, weight) => sum + weight, 0);
  const largestSerialSpec = Math.max(
    0,
    ...specs.filter(isSerialE2eSpec).map((file) => durations[file] ?? fallbackWeight),
  );
  const bound = Math.max((totalWall / TARGET_AWS_SHARD_COUNT) * 1.15, largestSerialSpec);
  assert.ok(
    heaviest <= bound,
    `heaviest 16-shard bucket ${Math.round(heaviest)}ms exceeds the balance bound (${Math.round(bound)}ms)`,
  );
  assert.ok(
    heaviest <= 85_000,
    `heaviest 16-shard bucket ${Math.round(heaviest)}ms exceeds 85s Phase 5 ceiling`,
  );
});

test("4-shard hosted partitioning stays complete and segregated on 4-vCPU runners", () => {
  const durations = loadShardDurations(durationsManifest);
  const specs = listE2eSpecs();
  const shards = partitionE2eShards(specs, TARGET_HOSTED_SHARD_COUNT, durations, {
    parallelWorkers: EFFECTIVE_PARALLEL_SPEEDUP,
  });
  assert.equal(shards.length, TARGET_HOSTED_SHARD_COUNT);
  const combined = shards.flatMap((shard) => shard.files);
  assert.deepEqual([...combined].sort(), [...specs].sort());
  for (const shard of shards) {
    assert.ok(shard.files.length > 0, "no 4-shard hosted bucket may be empty");
    const serialCount = shard.files.filter(isSerialE2eSpec).length;
    assert.ok(
      serialCount === 0 || serialCount === shard.files.length,
      `4-shard hosted bucket must not mix serial and parallel specs: ${shard.files.join(", ")}`,
    );
  }
});

test("the duration manifest only names specs that still exist", () => {
  const durations = loadShardDurations(durationsManifest);
  assert.ok(
    Object.keys(durations).length > 0,
    "expected a populated duration manifest",
  );
  const specs = new Set(listE2eSpecs());
  for (const file of Object.keys(durations)) {
    assert.ok(
      specs.has(file),
      `duration manifest names a spec that no longer runs: ${file}`,
    );
  }
});

test("the weighted partition keeps the shards close to balanced", () => {
  const durations = loadShardDurations(durationsManifest);
  const specs = listE2eSpecs();
  const fallbackWeight = defaultSuiteWeight(durations);
  const shards = partitionE2eShards(specs, SHARD_COUNT, durations, {
    parallelWorkers: EFFECTIVE_PARALLEL_SPEEDUP_4W,
  });
  const wallWeights = shards.map((shard) => {
    const serialSum = shard.files.reduce((sum, file) => sum + (durations[file] ?? fallbackWeight), 0);
    return shard.mode === "parallel" ? serialSum / EFFECTIVE_PARALLEL_SPEEDUP_4W : serialSum;
  });

  const heaviest = Math.max(...wallWeights);
  const totalWall = wallWeights.reduce((sum, weight) => sum + weight, 0);
  const largestSerialSpec = Math.max(
    0,
    ...specs.filter(isSerialE2eSpec).map((file) => durations[file] ?? fallbackWeight),
  );
  const bound = Math.max((totalWall / SHARD_COUNT) * 1.15, largestSerialSpec);
  assert.ok(
    heaviest <= bound,
    `heaviest shard ${Math.round(heaviest)}ms exceeds the balance bound (${Math.round(bound)}ms)`,
  );
});

test("shard arguments are validated", () => {
  for (const args of [
    ["--shard-index", "2", "--shard-count", "2"],
    ["--shard-index", "-1", "--shard-count", "2"],
    ["--shard-index", "0", "--shard-count", "0"],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0, `expected failure for ${args.join(" ")}`);
  }
});

test("pr.yml calls the trusted PR workflow from an immutable fork commit", () => {
  assert.ok(readTrustedPrWorkflow().length > 0);
});

test("the active and proposed trusted PR workflows keep a stable aggregate check named e2e over the shard matrix", () => {
  // Branch protection requires a check literally named `e2e`. The shards run
  // as `e2e shard (n/3)`, so the aggregate job below is what keeps the
  // required-check contract intact — same pattern as the `verify` aggregate.
  for (const [source, workflow] of [
    ["active", readTrustedPrWorkflow()],
    ["proposed", readProposedTrustedPrWorkflow()],
  ]) {
    const jobs = readWorkflowJobs(workflow);

    const aggregate = jobs.get("e2e");
    assert.ok(
      aggregate,
      `${source} pr-trusted.yml must define an \`e2e\` job to satisfy branch protection`,
    );
    assert.match(
      aggregate,
      /^ {4}name: e2e$/m,
      `${source} aggregate job must be named exactly \`e2e\``,
    );
    assert.match(
      aggregate,
      /^ {4}if: \$\{\{ always\(\) \}\}$/m,
      `${source} aggregate must run even when a shard fails`,
    );
    assert.match(
      aggregate,
      /^ {4}needs: \[gate, (?:policy, )?e2e_shards\]$/m,
      `${source} aggregate must depend on the runner gate, optional policy gate, and shard matrix`,
    );
    assert.equal(runAggregate(aggregate, true).status, 0);
    assert.equal(runAggregate(aggregate, false).status, 0);
    for (const result of ["failure", "cancelled", "skipped"]) {
      assert.notEqual(runAggregate(aggregate, true, { e2e_shards: result }).status, 0);
      assert.notEqual(runAggregate(aggregate, true, { policy: result }).status, 0);
    }
    assert.notEqual(runAggregate(aggregate, false, { e2e_shards: "success" }).status, 0);

    const shards = jobs.get("e2e_shards");
    assert.ok(shards, `${source} pr-trusted.yml must define the \`e2e_shards\` matrix job`);
  }

  const matrixEntries = JSON.parse(readFileSync(path.join(repoRoot, ".github/ci-task-matrix.json"), "utf8"))
    .e2e_shards.map((entry) => ({
    shardIndex: entry.shard_index,
    shardCount: entry.shard_count,
    shardLabel: entry.shard_label,
  }));

  assert.equal(
    matrixEntries.length,
    SHARD_COUNT,
    "the shard matrix must define exactly SHARD_COUNT entries",
  );
  assert.deepEqual(
    matrixEntries.map((entry) => entry.shardIndex).sort((a, b) => a - b),
    Array.from({ length: SHARD_COUNT }, (_, index) => index),
    "the shard matrix must define each shard index exactly once",
  );
  for (const entry of matrixEntries) {
    assert.equal(
      entry.shardCount,
      SHARD_COUNT,
      "each shard matrix entry must use the same SHARD_COUNT",
    );
    assert.equal(
      entry.shardLabel,
      `${entry.shardIndex + 1}/${SHARD_COUNT}`,
      "each shard label must match its index",
    );
  }
});

test("runner authorization uses reserved capacity and executes metadata checks only", () => {
  const workflow = readFileSync(routingWorkflow, "utf8");
  const jobs = readWorkflowJobs(workflow.split(/^jobs:\n/m)[1]);
  assert.deepEqual([...jobs.keys()], ["gate"]);
  assert.match(jobs.get("gate"), /runs-on\/fleet=paperclip-ci-routing-x64\/env=public-ci/);
  assert.doesNotMatch(jobs.get("gate"), /uses:|actions\/checkout|secrets\./);
  assert.match(
    workflow,
    /^ {6}runner:\n {8}value: \$\{\{ jobs\.gate\.outputs\.runner \}\}$/m,
  );
  assert.match(
    workflow,
    /^ {6}full_ci:\n {8}value: \$\{\{ jobs\.gate\.outputs\.full_ci \}\}$/m,
  );
  assert.doesNotMatch(
    workflow,
    /^ {2}(?:actions|contents|pull-requests): write$/m,
  );
});

test("the proposed trusted PR workflow limits full CI to merge-relevant stack layers", () => {
  const workflow = readProposedTrustedPrWorkflow();
  const jobs = readWorkflowJobs(workflow);
  assert.match(
    jobs.get("gate"),
    /uses: \.\/\.github\/workflows\/ci-routing\.yml/,
  );
  const gate = readWorkflowJobs(readFileSync(routingWorkflow, "utf8")).get(
    "gate",
  );

  assert.match(
    gate,
    /^ {6}full_ci: \$\{\{ steps\.scope\.outputs\.full_ci \}\}$/m,
  );
  assert.match(
    gate,
    /STACK_JSON: \$\{\{ toJSON\(github\.event\.pull_request\.stack\) \}\}/,
  );
  assert.match(gate, /stack_position == stack_size/);
  assert.match(gate, /"\$stack_base_ref" == "\$PR_BASE_REF"/);

  for (const jobId of [
    "typecheck_release_registry",
    "general_tests",
    "verify_paperclip_runner",
    "build",
    "verify_serialized_server",
    "canary_dry_run",
    "e2e_shards",
    "verify_runner_e2e_support",
  ]) {
    assert.match(
      jobs.get(jobId),
      /^ {4}if: \$\{\{ (?:always\(\) && !cancelled\(\) && needs\.gate\.result == 'success' && )?needs\.gate\.outputs\.full_ci == 'true' && /m,
      `${jobId} must run only when the gate selects full CI`,
    );
  }

  assert.doesNotMatch(
    jobs.get("policy"),
    /needs\.gate\.outputs\.full_ci/,
    "the policy job must run on every PR layer",
  );

  const verify = jobs.get("verify");
  assert.match(
    verify,
    /^ {4}needs: \[gate, test_selection, policy, typecheck_release_registry, general_tests, verify_paperclip_runner, build, docker_context_integrity, sandbox_provider_tests, verify_serialized_server, canary_dry_run, verify_runner_e2e_support\]$/m,
  );
  assert.equal(runAggregate(verify, true).status, 0);
  assert.equal(runAggregate(verify, false).status, 0);
  for (const result of ["failure", "cancelled", "skipped"]) {
    assert.equal(runAggregate(verify, true, { test_selection: result }).status, 0,
      "an optional selector cannot block the successful original matrix");
  }
  for (const job of ["gate", "policy", "typecheck_release_registry", "general_tests", "verify_paperclip_runner",
    "build", "docker_context_integrity", "sandbox_provider_tests", "verify_serialized_server", "canary_dry_run", "verify_runner_e2e_support"]) {
    for (const result of ["failure", "cancelled", "skipped"]) {
      assert.notEqual(runAggregate(verify, true, { [job]: result }).status, 0, `${job}: ${result}`);
    }
    if (job !== "gate" && job !== "policy") {
      assert.notEqual(runAggregate(verify, false, { [job]: "success" }).status, 0, job);
    }
  }

  const e2e = jobs.get("e2e");
  assert.match(e2e, /^ {4}needs: \[gate, policy, e2e_shards\]$/m);
  assert.notEqual(runAggregate(e2e, true, { policy: "failure" }).status, 0);
  assert.notEqual(runAggregate(e2e, false, { e2e_shards: "success" }).status, 0);
});

test("the stacked PR scope selector runs full CI only where intended", () => {
  assert.equal(runStackScope(null, "master").full_ci, "true");
  assert.equal(
    runStackScope(
      { position: 11, size: 11, base: { ref: "master" } },
      "stack-10",
    ).full_ci,
    "true",
  );
  assert.equal(
    runStackScope({ position: 1, size: 11, base: { ref: "master" } }, "master")
      .full_ci,
    "true",
  );
  assert.equal(
    runStackScope({ position: 6, size: 11, base: { ref: "master" } }, "stack-5")
      .full_ci,
    "false",
  );
  assert.equal(
    runStackScope(
      { position: "invalid", size: 11, base: { ref: "master" } },
      "stack-5",
    ).full_ci,
    "true",
  );
});

test("the active and proposed trusted PR workflows pass the shard's spec filter to Playwright without a literal --", () => {
  // `pnpm run test:e2e -- $specs` forwards the literal separator to Playwright,
  // so the specs after it are not applied as file filters.
  for (const [source, workflow] of [
    ["active", readTrustedPrWorkflow()],
    ["proposed", readProposedTrustedPrWorkflow()],
  ]) {
    assert.ok(
      !/pnpm run test:e2e --\s/.test(workflow),
      `${source} pr-trusted.yml must not insert a literal \`--\` between \`pnpm run test:e2e\` and the spec filter`,
    );
    assert.match(
      workflow,
      /pnpm run test:e2e \$specs/,
      `${source} pr-trusted.yml e2e_shards must invoke \`pnpm run test:e2e $specs\``,
    );
  }
});

test("the proposed trusted PR workflow regenerates stale stacked lockfiles", () => {
  const workflow = readProposedTrustedPrWorkflow();
  assert.match(
    workflow,
    /policy:\n    needs: \[gate\][\s\S]{0,160}timeout-minutes: 10/,
    "the unconditional resolution step needs the same timeout headroom as the lockfile refresh workflow",
  );
  const policy = workflow
    .split("  policy:\n")[1]
    .split("  typecheck_release_registry:\n")[0];
  assert.doesNotMatch(
    policy,
    /cache: pnpm|uses: actions\/cache/,
    "resolution-only policy must not restore or save a dependency store",
  );
  assert.match(
    policy,
    /pnpm install --resolution-only --ignore-scripts --no-frozen-lockfile/,
    "the policy job must resolve the complete merge tree without rewriting platform metadata",
  );

  // Test lanes no longer wait on a policy-job artifact: each install step
  // resolves a stale lockfile inline, so a manifest-changing or stacked PR
  // still installs while the policy job validates resolution in parallel.
  const fallbackInstalls =
    workflow.match(
      /if ! pnpm install --frozen-lockfile; then\n[\s\S]{0,240}?pnpm install --resolution-only --ignore-scripts --no-frozen-lockfile\n\s+pnpm install --frozen-lockfile\n\s+fi/g,
    ) ?? [];
  assert.equal(
    fallbackInstalls.length,
    7,
    "every downstream install job must resolve a stale lockfile inline",
  );
  assert.doesNotMatch(
    workflow,
    /Restore regenerated PR lockfile|lockfile_regenerated|name: pr-lockfile/,
    "the policy lockfile artifact chain must stay removed; it put the policy job on every lane's critical path",
  );
});

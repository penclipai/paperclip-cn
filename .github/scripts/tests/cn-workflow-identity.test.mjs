import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyWorkflowSourceUpdate } from "../cn-workflow-source-guard.mjs";
import { workflowReviewBase } from "../cn-workflow-review-context.mjs";

const read = (name) =>
  readFileSync(
    new URL(`../../workflows/${name}`, import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const gitResult = (...args) => spawnSync("git", args, {
  cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
});
const git = (...args) => {
  const result = gitResult(...args);
  assert.equal(result.status, 0, `Cannot verify workflow review Git ${args[0]}`);
  return result.stdout;
};
const isAncestor = (ancestor, descendant) => {
  const result = gitResult("merge-base", "--is-ancestor", ancestor, descendant);
  assert.ok(result.status === 0 || result.status === 1, "Cannot verify workflow source ancestry");
  return result.status === 0;
};
const readAt = (sha, path) => git("show", `${sha}:${path}`);
const ci = process.env.GITHUB_ACTIONS === "true";
let event;
if (ci) {
  assert.ok(process.env.GITHUB_EVENT_PATH, "Missing GitHub event context for workflow review");
  try { event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")); }
  catch { throw new Error("Cannot read GitHub event context for workflow review"); }
}
const localForkBase = () => {
  const remotes = git("remote").trim().split(/\s+/).filter(Boolean).filter(remote =>
    /^(?:https:\/\/github\.com\/|git@github\.com:)penclipai\/paperclip-cn(?:\.git)?$/i.test(git("remote", "get-url", remote).trim()));
  assert.ok(remotes.length, "Workflow review needs an explicit fork remote");
  const bases = new Set(remotes.map(remote => git("rev-parse", "--verify", `refs/remotes/${remote}/master`).trim()));
  assert.equal(bases.size, 1, "Fetch fork master before workflow review; local fork refs disagree");
  return [...bases][0];
};
const checkoutSha = git("rev-parse", "HEAD").trim();
const baseSha = workflowReviewBase({
  env: process.env, event, checkoutSha, isAncestor,
  parents: ci ? git("show", "-s", "--format=%P", checkoutSha).trim().split(/\s+/) : undefined,
  localBase: ci ? undefined : localForkBase(),
});
const reviewPaths = [
  ".github/workflows/pr-trusted.yml", ".github/workflows/ci-routing.yml",
  ".github/scripts/cn-workflow-source-guard.mjs", ".github/scripts/tests/cn-workflow-source-guard.test.mjs",
  ".github/scripts/cn-workflow-review-context.mjs", ".github/scripts/tests/cn-workflow-review-context.test.mjs",
  ".github/scripts/tests/cn-workflow-identity.test.mjs",
];
const sourceReview = verifyWorkflowSourceUpdate({
  baseSha, baseCaller: readAt(baseSha, ".github/workflows/pr.yml"), caller: read("pr.yml"), isAncestor, readAt,
  currentFiles: Object.fromEntries(reviewPaths.map(path => [path, readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8")])),
});
const trusted = read("pr-trusted.yml");
const routing = read("ci-routing.yml");
const release = read("release.yml");
const job = (source, name) => {
  const match = source.match(
    new RegExp(
      `^  ${name}:\\n([\\s\\S]*?)(?=^  [a-zA-Z_][\\w-]*:|$(?![\\s\\S]))`,
      "m",
    ),
  );
  assert.ok(match, `missing job ${name}`);
  return match[1];
};

test("CN PR workflows keep read-only permissions and the fork runner trust boundary", () => {
  for (const source of [read("pr.yml"), sourceReview.activeTrusted, trusted]) {
    assert.match(
      source,
      /permissions:\n  actions: read\n  contents: read\n  pull-requests: read/,
    );
    assert.doesNotMatch(source, /id-token: write|secrets: inherit/);
  }
  for (const source of [sourceReview.activeRouting, routing].filter(Boolean)) {
    assert.match(source, /permissions:\n  actions: read\n  contents: read\n  pull-requests: read/);
    assert.doesNotMatch(source, /id-token: write|secrets: inherit/);
    assert.match(source, /penclipai\/paperclip-cn/);
    assert.match(source, /1192887762/);
    assert.doesNotMatch(source, /paperclipai\/paperclip|1170821064/);
  }
  assert.match(
    read("pr.yml"),
    /uses: penclipai\/paperclip-cn\/\.github\/workflows\/pr-trusted\.yml@[0-9a-f]{40}\s*$/m,
  );
  assert.doesNotMatch(
    read("pr.yml"),
    /uses: \.\/|pr-trusted\.yml@(?:master|main|HEAD)/,
  );
  assert.match(trusted, /uses: \.\/\.github\/workflows\/ci-routing\.yml/);
  assert.match(
    routing,
    /permissions:\n  actions: read\n  contents: read\n  pull-requests: read/,
  );
  assert.doesNotMatch(routing, /id-token: write|secrets: inherit/);
  assert.match(routing, /penclipai\/paperclip-cn/);
  assert.match(routing, /1192887762/);
  assert.doesNotMatch(routing, /paperclipai\/paperclip|1170821064/);
  assert.match(routing, /github_runner='ubuntu-latest'/);
  assert.match(routing, /fail_closed\(\) \{\n\s+echo "runner=\$github_runner"/);
});

test("CN workflows retain the trusted lockfile policy and workspace filters", () => {
  for (const source of [sourceReview.activeTrusted, trusted]) {
    const policy = job(source, "policy");
    if (policy.includes("Block untrusted lockfile edits")) {
      assert.ok(policy.includes('git show "$trusted_base:.github/scripts/lockfile-trust.mjs"'));
      assert.ok(policy.includes('BASE_SHA="$trusted_base" node "$policy" pr'));
      assert.ok(policy.includes("lockfile-trust.mjs did not report a lockfile writer"));
    } else {
      assert.match(policy, /!startsWith\(github.head_ref, 'codex\/upstream-sync-'\)/);
    }
  }
  assert.match(trusted, /pnpm --filter @penclipai\/paperclip-runner/);
  assert.doesNotMatch(trusted, /pnpm --filter @paperclipai\//);
});

test("CN publishing jobs use OIDC without an environment npm token", () => {
  for (const lane of ["preview", "canary", "nightly", "beta", "stable"]) {
    const block = job(release, `publish_${lane}`);
    assert.match(block, /id-token: write/);
    assert.doesNotMatch(
      block,
      /NPM_TOKEN|NODE_AUTH_TOKEN|registry-url: https:\/\/registry\.npmjs\.org|always-auth: true/,
    );
  }
  assert.equal((release.match(/secrets\.NPM_TOKEN/g) ?? []).length, 0);
  for (const lane of ["desktop_stable", "smoke_stable"]) {
    assert.doesNotMatch(job(release, lane), /secrets:\s*inherit|NPM_TOKEN/);
  }
});

test("canary verification and branch attachment require the CN repository and ID", () => {
  assert.match(
    job(release, "verify_canary"),
    /github.repository == 'penclipai\/paperclip-cn' && github.repository_id == '1192887762'/,
  );
  const publish = job(release, "publish_canary");
  assert.match(publish, /\$GITHUB_REPOSITORY" != "penclipai\/paperclip-cn"/);
  assert.match(publish, /\$GITHUB_REPOSITORY_ID" != "1192887762"/);
  assert.match(publish, /git rev-parse HEAD/);
});

test("CN Docker channel promotion follows its own npm canary", () => {
  const docker = read("docker.yml");
  assert.match(
    job(docker, "promote_canary_channel"),
    /@penclipai%2Fdb\/dist-tags/,
  );
  assert.doesNotMatch(docker, /@paperclipai%2Fdb\/dist-tags/);
});

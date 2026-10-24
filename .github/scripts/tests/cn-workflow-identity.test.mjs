import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) =>
  readFileSync(
    new URL(`../../workflows/${name}`, import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pinnedSha = read("pr.yml").match(
  /uses: penclipai\/paperclip-cn\/\.github\/workflows\/pr-trusted\.yml@([0-9a-f]{40})\s*$/m,
)?.[1];
assert.ok(
  pinnedSha,
  "pr.yml must pin the trusted fork workflow to a full commit SHA",
);
const pinned = spawnSync(
  "git",
  ["show", `${pinnedSha}:.github/workflows/pr-trusted.yml`],
  { cwd: repoRoot, encoding: "utf8" },
);
assert.equal(
  pinned.status,
  0,
  `Cannot read pinned trusted workflow ${pinnedSha}: ${pinned.stderr}`,
);
const trusted = pinned.stdout.replaceAll("\r\n", "\n");
assert.equal(
  trusted,
  read("pr-trusted.yml"),
  "The pinned workflow must match the proposed trusted workflow source",
);
const routing = read("ci-routing.yml");
const pinnedRouting = spawnSync(
  "git",
  ["show", `${pinnedSha}:.github/workflows/ci-routing.yml`],
  { cwd: repoRoot, encoding: "utf8" },
);
assert.equal(
  pinnedRouting.status,
  0,
  `Cannot read pinned routing workflow ${pinnedSha}: ${pinnedRouting.stderr}`,
);
assert.equal(
  pinnedRouting.stdout.replaceAll("\r\n", "\n"),
  routing,
  "The pinned routing workflow must match the proposed routing workflow source",
);
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
  for (const source of [read("pr.yml"), trusted]) {
    assert.match(
      source,
      /permissions:\n  actions: read\n  contents: read\n  pull-requests: read/,
    );
    assert.doesNotMatch(source, /id-token: write|secrets: inherit/);
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

test("upstream sync policy admits its generated lockfile and CN workspace filters", () => {
  assert.match(
    job(trusted, "policy"),
    /!startsWith\(github.head_ref, 'codex\/upstream-sync-'\)/,
  );
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

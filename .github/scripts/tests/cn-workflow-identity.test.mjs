import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../../workflows/${name}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const trusted = read("pr-trusted.yml");
const release = read("release.yml");
const job = (source, name) => {
  const match = source.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-zA-Z_][\\w-]*:|$(?![\\s\\S]))`, "m"));
  assert.ok(match, `missing job ${name}`);
  return match[1];
};

test("CN PR jobs keep read-only permissions and the fork runner trust boundary", () => {
  for (const source of [read("pr.yml"), trusted]) {
    assert.match(source, /permissions:\n  actions: read\n  contents: read\n  pull-requests: read/);
    assert.doesNotMatch(source, /id-token: write|secrets: inherit/);
  }
  assert.match(read("pr.yml"), /uses: penclipai\/paperclip-cn\/\.github\/workflows\/pr-trusted\.yml@[0-9a-f]{40}\s*$/m);
  assert.doesNotMatch(read("pr.yml"), /uses: \.\/|pr-trusted\.yml@(?:master|main|HEAD)/);
  assert.match(trusted, /penclipai\/paperclip-cn/);
  assert.match(trusted, /1192887762/);
  assert.doesNotMatch(trusted, /paperclipai\/paperclip|1170821064/);
  assert.match(trusted, /github_runner='ubuntu-latest'/);
  assert.match(trusted, /fail_closed\(\) \{\n\s+echo "runner=\$github_runner"/);
});

test("upstream sync policy admits its generated lockfile and CN workspace filters", () => {
  assert.match(job(trusted, "policy"), /!startsWith\(github.head_ref, 'codex\/upstream-sync-'\)/);
  assert.match(trusted, /pnpm --filter @penclipai\/paperclip-runner/);
  assert.doesNotMatch(trusted, /pnpm --filter @paperclipai\//);
});

test("only existing canary and stable publishing jobs receive the environment npm token", () => {
  for (const lane of ["canary", "stable"]) {
    const block = job(release, `publish_${lane}`);
    assert.match(block, new RegExp(`environment: npm-${lane}`));
    assert.match(block, /registry-url: https:\/\/registry.npmjs.org/);
    assert.match(block, /run: npm whoami/);
    assert.equal((block.match(/NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/g) ?? []).length, 2);
    assert.doesNotMatch(block, /id-token: write/);
  }
  assert.equal((release.match(/secrets\.NPM_TOKEN/g) ?? []).length, 4);
  for (const lane of ["preview", "nightly", "beta"]) {
    assert.doesNotMatch(job(release, `publish_${lane}`), /NPM_TOKEN/);
  }
  for (const lane of ["desktop_stable", "smoke_stable"]) {
    assert.doesNotMatch(job(release, lane), /secrets:\s*inherit|NPM_TOKEN/);
  }
});

test("canary verification and branch attachment require the CN repository and ID", () => {
  assert.match(job(release, "verify_canary"), /github.repository == 'penclipai\/paperclip-cn' && github.repository_id == '1192887762'/);
  const publish = job(release, "publish_canary");
  assert.match(publish, /\$GITHUB_REPOSITORY" != "penclipai\/paperclip-cn"/);
  assert.match(publish, /\$GITHUB_REPOSITORY_ID" != "1192887762"/);
  assert.match(publish, /git rev-parse HEAD/);
});

test("CN Docker channel promotion follows its own npm canary", () => {
  const docker = read("docker.yml");
  assert.match(job(docker, "promote_canary_channel"), /@penclipai%2Fdb\/dist-tags/);
  assert.doesNotMatch(docker, /@paperclipai%2Fdb\/dist-tags/);
});

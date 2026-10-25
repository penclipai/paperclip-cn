import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workflow = readFileSync(new URL("../../workflows/docker.yml", import.meta.url), "utf8");
const job = workflow.split("  promote_canary_channel:\n")[1];
const script = job.split("        run: |\n")[1].split("\n").map(line => line.replace(/^ {10}/, "")).join("\n");
const sha = "a".repeat(40);

function bashPath(value) {
  if (process.platform !== "win32") return value;
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(value);
  if (!match) return value.replaceAll("\\", "/");
  const [, drive, rest] = match;
  // The fixture invokes Git for Windows' Bash explicitly, whose drive mounts
  // use /d rather than the WSL-specific /mnt/d form.
  const root = `/${drive.toLowerCase()}`;
  return `${root}/${rest.replaceAll("\\", "/")}`;
}

function bashQuote(value) {
  return `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;
}

const bash = process.platform === "win32"
  ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe")
  : "bash";

test("canary promotion waits for the standard manifest and keeps its serialized channel", () => {
  assert.match(job, /needs: \[merge-and-push\]/);
  assert.match(job, /group: docker-canary-channel-promotion/);
  assert.match(job, /cancel-in-progress: false/);
});

for (const [name, commitPresent, imagePresent] of [
  ["promotes the current npm canary without a cloud image", true, true],
  ["waits when the standard image is missing", true, false],
  ["waits when the npm canary tag has not resolved", false, false],
]) {
  test(name, () => {
    const dir = mkdtempSync(path.join(tmpdir(), "standard-canary-promotion-"));
    const log = path.join(dir, "calls.jsonl");
    const fixturePath = path.join(dir, "fixture.cjs");
    const fixtureScriptPath = path.join(dir, "promotion.sh");
    const fixture = `const fs = require("node:fs");
const command = process.argv[2];
const args = process.argv.slice(3);
fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify({ command, args }) + "\\n");
if (command === "curl") process.stdout.write(JSON.stringify({ canary: "2026.922.0-canary.1" }));
else if (command === "jq") {
  const input = fs.readFileSync(0, "utf8").trim();
  if (args.includes("@uri")) process.stdout.write(encodeURIComponent(input));
  else process.stdout.write(JSON.parse(input).canary);
}
else if (command === "gh") { if (process.env.COMMIT_PRESENT !== "true") process.exit(1); process.stdout.write(process.env.TEST_SHA); }
else if (args.slice(0, 3).join(" ") === "buildx imagetools inspect") process.exit(process.env.IMAGE_PRESENT === "true" ? 0 : 1);
else if (args.slice(0, 3).join(" ") !== "buildx imagetools create") process.exit(99);
`;
    try {
      writeFileSync(fixturePath, fixture);
      const fixtureScript = `function curl() { node ${bashQuote(bashPath(fixturePath))} curl "$@"; }
function gh() { node ${bashQuote(bashPath(fixturePath))} gh "$@"; }
function docker() { node ${bashQuote(bashPath(fixturePath))} docker "$@"; }
function jq() { node ${bashQuote(bashPath(fixturePath))} jq "$@"; }
export IMAGE='ghcr.io/paperclipai/paperclip'
export GITHUB_REPOSITORY='paperclipai/paperclip'
export TEST_CALLS=${bashQuote(bashPath(log))}
export TEST_SHA='${sha}'
export COMMIT_PRESENT='${commitPresent}'
export IMAGE_PRESENT='${imagePresent}'
${script}`;
      writeFileSync(fixtureScriptPath, fixtureScript.replaceAll("\r\n", "\n"));
      const result = spawnSync(bash, [bashPath(fixtureScriptPath)], { encoding: "utf8", env: process.env });
      assert.equal(result.status, 0, result.stderr);
      const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
      assert.ok(
        calls.find(call => call.command === "gh").args.some(arg => arg.includes("canary%2Fv2026.922.0-canary.1")),
        JSON.stringify(calls),
      );
      const docker = calls.filter(call => call.command === "docker").map(call => call.args);
      assert.deepEqual(docker, [
        ...(commitPresent ? [["buildx", "imagetools", "inspect", "ghcr.io/paperclipai/paperclip:sha-aaaaaaa"]] : []),
        ...(commitPresent && imagePresent ? [["buildx", "imagetools", "create", "-t", "ghcr.io/paperclipai/paperclip:canary", "ghcr.io/paperclipai/paperclip:sha-aaaaaaa"]] : []),
      ]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

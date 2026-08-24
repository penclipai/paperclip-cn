import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const bashCommand = process.platform === "win32" ? `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\bash.exe` : "bash";

function toBashPath(path) {
  const normalized = path.replace(/\\/g, "/");
  return normalized.replace(/^([A-Za-z]):\//, (_match, drive) => `/mnt/${drive.toLowerCase()}/`);
}

function bashQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function writeExecutable(path, body) {
  writeFileSync(path, body, { mode: 0o755 });
}

function createReleaseFixture() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "paperclip-release-dry-run-"));
  const scriptsDir = join(fixtureDir, "scripts");
  const binDir = join(fixtureDir, "bin");
  const bashEnv = join(fixtureDir, "bash-env.sh");
  const callLog = join(fixtureDir, "calls.log");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(join(fixtureDir, "releases"));
  mkdirSync(binDir);
  writeFileSync(callLog, "");

  copyFileSync(join(repoRoot, "scripts", "release.sh"), join(scriptsDir, "release.sh"));
  chmodSync(join(scriptsDir, "release.sh"), 0o755);

  copyFileSync(join(repoRoot, "scripts", "release-lib.sh"), join(scriptsDir, "release-lib.sh"));
  writeFileSync(
    join(scriptsDir, "release-lib-fixture.sh"),
    `#!/usr/bin/env bash
release_info() { echo "$@"; }
release_fail() { echo "Error: $*" >&2; exit 1; }
resolve_release_remote() { printf 'origin\\n'; }
fetch_release_remote() { :; }
git_current_branch() { printf 'master\\n'; }
get_last_stable_tag() { printf 'v2026.709.0\\n'; }
get_current_stable_version() { printf '2026.709.0\\n'; }
utc_date_iso() { printf '2026-07-10\\n'; }
list_public_package_info() { printf 'cli\\tpenclip\\t0.0.0\\n'; }
next_stable_version() { printf '2026.710.0\\n'; }
next_prerelease_version() { printf '2026.710.0-%s.0\\n' "$1"; }
release_notes_file() { printf '%s/releases/v%s.md\\n' "$REPO_ROOT" "$1"; }
stable_tag_name() { printf 'v%s\\n' "$1"; }
prerelease_tag_name() { printf '%s/v%s\\n' "$1" "$2"; }
require_channel_tag_at_head() {
  if [ "\${FAKE_MISSING_CHANNEL_TAG:-}" = "$1" ]; then
    echo "Error: HEAD has no $1/v* tag; this channel only publishes commits that already shipped a $1 release." >&2
    exit 1
  fi
  echo "[fixture] require_channel_tag_at_head $1"
}
require_channel_tag_absent_at_head() {
  if [ "\${FAKE_PRESENT_CHANNEL_TAG:-}" = "$1" ]; then
    echo "Error: HEAD already shipped as $1/v2026.710.0-$1.0; delete that tag first if you really want to republish this commit on the $1 channel." >&2
    exit 1
  fi
  echo "[fixture] require_channel_tag_absent_at_head $1"
}
require_clean_worktree() { :; }
require_npm_publish_auth() { :; }
git_local_tag_exists() { return 1; }
git_remote_tag_exists() { return 1; }
npm_package_version_exists() { return 1; }
set_public_package_version() { :; }
`,
  );

  const releaseScript = join(scriptsDir, "release.sh");
  const releaseScriptContents = readFileSync(releaseScript, "utf8")
    .replace(
      'REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
      'REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"',
    )
    .replace(
      '. "$REPO_ROOT/scripts/release-lib.sh"',
      '. "$REPO_ROOT/scripts/release-lib.sh"\n. "$REPO_ROOT/scripts/release-lib-fixture.sh"',
    );
  writeFileSync(releaseScript, releaseScriptContents);

  writeExecutable(
    join(scriptsDir, "release-registry-versions.mjs"),
    `#!/usr/bin/env node
const [mode] = process.argv.slice(2);
if (mode === "fetch") {
  process.stdout.write('{"penclip":[]}\\n');
  process.exit(0);
}
if (mode === "assert-absent") {
  process.exit(0);
}
process.exit(2);
`,
  );

  writeExecutable(
    join(binDir, "node"),
    `#!/usr/bin/env bash
exec "${toBashPath(process.execPath)}" "$@"
`,
  );

  writeExecutable(
    join(binDir, "git"),
    `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "-C" ]; then
  shift 2
fi
printf 'git %s\\n' "$*" >> "$FAKE_CALL_LOG"
case "$1" in
  rev-parse)
    if [ "\${2:-}" = "HEAD" ]; then
      echo abcdef1234567890
      exit 0
    fi
    ;;
  diff|ls-files)
    exit 0
    ;;
  checkout)
    exit 0
    ;;
esac
exit 0
`,
  );

  writeExecutable(
    join(binDir, "pnpm"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'pnpm %s\\n' "$*" >> "$FAKE_CALL_LOG"
if [ "$*" = "build" ]; then
  echo "fixture stopped at workspace build"
  exit 42
fi
exit 0
`,
  );

  writeFileSync(
    bashEnv,
    `git() {
  printf 'git %s\\n' "$*" >> ${bashQuote(toBashPath(callLog))}
  if [ "$1" = "-C" ]; then
    shift 2
  fi
  case "$1" in
    rev-parse)
      if [ "\${2:-}" = "HEAD" ]; then
        echo abcdef1234567890
        return 0
      fi
      ;;
    diff|ls-files|checkout)
      return 0
      ;;
  esac
  return 0
}

pnpm() {
  printf 'pnpm %s\\n' "$*" >> ${bashQuote(toBashPath(callLog))}
  if [ "$*" = "build" ]; then
    echo "fixture stopped at workspace build"
    return 42
  fi
  return 0
}

node() {
  local translated=()
  local arg drive rest
  for arg in "$@"; do
    case "$arg" in
      /mnt/[a-zA-Z]/*)
        drive="\${arg:5:1}"
        rest="\${arg:7}"
        translated+=("\${drive^^}:/\${rest}")
        ;;
      *)
        translated+=("$arg")
        ;;
    esac
  done
  "${toBashPath(process.execPath)}" "\${translated[@]}"
}

export -f git pnpm node
`,
  );

  return { bashEnv, binDir, callLog, fixtureDir, script: join(scriptsDir, "release.sh") };
}

function runRelease(args, extraEnv = {}) {
  const fixture = createReleaseFixture();
  const quotedArgs = args.map(bashQuote).join(" ");
  const fixtureEnv = Object.entries(extraEnv)
    .map(([key, value]) => `export ${key}=${bashQuote(String(value))}`)
    .join("; ");
  const command = [
    "set -euo pipefail",
    `. ${bashQuote(toBashPath(fixture.bashEnv))}`,
    fixtureEnv,
    `bash ${bashQuote(toBashPath(fixture.script))}${quotedArgs ? ` ${quotedArgs}` : ""}`,
  ].filter(Boolean).join("; ");
  const result = spawnSync(bashCommand, ["-c", command], {
    cwd: fixture.fixtureDir,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture.binDir}:${process.env.PATH}`,
      FAKE_CALL_LOG: fixture.callLog,
      ...extraEnv,
    },
  });

  const calls = readFileSync(fixture.callLog, "utf8");
  try {
    rmSync(fixture.fixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }

  return {
    calls,
    output: (result.stdout ?? "") + (result.stderr ?? "") + (result.error ? String(result.error.message) : ""),
    status: result.status,
  };
}

test("stable dry-run preview does not require a pre-authored release notes file", () => {
  const result = runRelease(["stable", "--skip-verify", "--dry-run"]);

  assert.equal(result.status, 42, result.output);
  assert.match(result.output, /==> Release plan/);
  assert.match(result.output, /==> Step 2\/7: Building workspace artifacts/);
  assert.doesNotMatch(result.output, /stable release notes file is required/);
  assert.match(result.calls, /^pnpm build$/m);
});

test("stable publish still requires release notes before publish work starts", () => {
  const result = runRelease(["stable", "--skip-verify"]);

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /stable release notes file is required/);
  assert.doesNotMatch(result.output, /==> Step 2\/7: Building workspace artifacts/);
  assert.doesNotMatch(result.calls, /^pnpm /m);
});

test("nightly dry-run publishes under the nightly identity without release notes", () => {
  const result = runRelease(["nightly", "--skip-verify", "--dry-run"]);

  assert.equal(result.status, 42);
  assert.match(result.output, /\[fixture\] require_channel_tag_at_head canary/);
  assert.match(result.output, /Nightly version: 2026\.710\.0-nightly\.0/);
  assert.match(result.output, /Dist-tag: nightly/);
  assert.match(result.output, /Git tag: nightly\/v2026\.710\.0-nightly\.0/);
  assert.doesNotMatch(result.output, /stable release notes file is required/);
  assert.match(result.calls, /^pnpm build$/m);
});

test("nightly refuses commits that never shipped a canary", () => {
  const result = runRelease(["nightly", "--skip-verify", "--dry-run"], {
    FAKE_MISSING_CHANNEL_TAG: "canary",
  });

  assert.equal(result.status, 1);
  assert.match(result.output, /HEAD has no canary\/v\* tag/);
  assert.doesNotMatch(result.calls, /^pnpm /m);
});

test("nightly refuses commits that already shipped as a nightly", () => {
  const result = runRelease(["nightly", "--skip-verify", "--dry-run"], {
    FAKE_PRESENT_CHANNEL_TAG: "nightly",
  });

  assert.equal(result.status, 1);
  assert.match(result.output, /HEAD already shipped as nightly\/v/);
  assert.doesNotMatch(result.calls, /^pnpm /m);
});

test("beta dry-run publishes under the beta identity without release notes", () => {
  const result = runRelease(["beta", "--skip-verify", "--dry-run"]);

  assert.equal(result.status, 42);
  assert.match(result.output, /\[fixture\] require_channel_tag_at_head nightly/);
  assert.match(result.output, /Beta version: 2026\.710\.0-beta\.0/);
  assert.match(result.output, /Dist-tag: beta/);
  assert.match(result.output, /Git tag: beta\/v2026\.710\.0-beta\.0/);
  assert.doesNotMatch(result.output, /stable release notes file is required/);
  assert.match(result.calls, /^pnpm build$/m);
});

test("beta refuses commits that already shipped as a beta", () => {
  const result = runRelease(["beta", "--skip-verify", "--dry-run"], {
    FAKE_PRESENT_CHANNEL_TAG: "beta",
  });

  assert.equal(result.status, 1);
  assert.match(result.output, /HEAD already shipped as beta\/v/);
  assert.doesNotMatch(result.calls, /^pnpm /m);
});

test("beta --from-candidate waives the nightly requirement but keeps the duplicate guard", () => {
  const result = runRelease(["beta", "--from-candidate", "--skip-verify", "--dry-run"], {
    FAKE_MISSING_CHANNEL_TAG: "nightly",
  });

  assert.equal(result.status, 42);
  assert.doesNotMatch(result.output, /require_channel_tag_at_head nightly/);
  assert.match(result.output, /\[fixture\] require_channel_tag_absent_at_head beta/);
  assert.match(result.output, /Beta version: 2026\.710\.0-beta\.0/);
  assert.match(result.calls, /^pnpm build$/m);
});

test("--from-candidate is rejected outside the beta channel", () => {
  const result = runRelease(["nightly", "--from-candidate", "--skip-verify", "--dry-run"]);

  assert.equal(result.status, 1);
  assert.match(result.output, /--from-candidate only applies to the beta channel/);
  assert.doesNotMatch(result.calls, /^pnpm /m);
});

test("beta refuses commits that never shipped a nightly", () => {
  const result = runRelease(["beta", "--skip-verify", "--dry-run"], {
    FAKE_MISSING_CHANNEL_TAG: "nightly",
  });

  assert.equal(result.status, 1);
  assert.match(result.output, /HEAD has no nightly\/v\* tag/);
  assert.doesNotMatch(result.calls, /^pnpm /m);
});

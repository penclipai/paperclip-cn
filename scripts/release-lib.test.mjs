import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

function toBashPath(value) {
  const normalized = value.replace(/\\/g, "/");
  const driveMatch = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!driveMatch) return normalized;
  return `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function toGitBashPath(value) {
  const normalized = value.replace(/\\/g, "/");
  const driveMatch = normalized.match(/^([A-Za-z]):\/(.*)$/);
  return driveMatch ? `/${driveMatch[1].toLowerCase()}/${driveMatch[2]}` : normalized;
}

const bashToolPath = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const repoRoot = toBashPath(fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, ""));
const releaseWorkflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8")
  .replace(/\r\n/g, "\n");
const releaseScript = readFileSync(new URL("./release.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const oidcNpmShim = readFileSync(new URL("./npm-publish-oidc.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const oidcNpmShimPath = fileURLToPath(new URL("./npm-publish-oidc.sh", import.meta.url));
const previewFunction = releaseScript.match(/preview_publish_payloads\(\) \{[\s\S]*?\n\}\n\nrelease_info ""/)?.[0]
  ?.replace(/\n\nrelease_info ""$/, "");

function workflowVerifyBudget() {
  return {
    verifyAttempts: Number(releaseWorkflow.match(/^  NPM_PUBLISH_VERIFY_ATTEMPTS: "(\d+)"$/m)?.[1]),
    verifyDelaySeconds: Number(releaseWorkflow.match(/^  NPM_PUBLISH_VERIFY_DELAY_SECONDS: "(\d+)"$/m)?.[1]),
  };
}

function writeExecutable(path, body) {
  writeFileSync(path, body, { mode: 0o755 });
}

function runPublishHelper({
  pnpmMode,
  npmVersionExists = false,
  distTag = "canary",
  callerPipefail = true,
  publishTool = "pnpm",
  githubActions = false,
  nodeAuthToken = "",
  waitForRegistry = false,
  npmVersionExistsAfterChecks = 0,
  verifyAttempts = 1,
  verifyDelaySeconds = 0,
  visibilityPackages = null,
}) {
  const fixtureDir = mkdtempSync(join(tmpdir(), "paperclip-release-lib-"));
  const binDir = join(fixtureDir, "bin");
  const stateDir = join(fixtureDir, "state");
  const callLog = join(fixtureDir, "calls.log");
  mkdirSync(binDir);
  mkdirSync(stateDir);
  writeFileSync(callLog, "");

  writeExecutable(
    join(binDir, "pnpm"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'npm_config_npm_path=%s\\n' "\${npm_config_npm_path:-}" >> "$FAKE_CALL_LOG"
printf 'pnpm %s\\n' "$*" >> "$FAKE_CALL_LOG"
case "$PNPM_MODE" in
  success)
    echo "published"
    exit 0
    ;;
  tlog-then-success)
    if [ ! -f "$FAKE_STATE_DIR/pnpm-called" ]; then
      touch "$FAKE_STATE_DIR/pnpm-called"
      echo "npm error code TLOG_CREATE_ENTRY_ERROR"
      echo "npm error error creating tlog entry - (409) an equivalent entry already exists in the transparency log with UUID abc"
      exit 1
    fi
    case " $* " in
      *" --provenance=false "*)
        echo "published without provenance"
        exit 0
        ;;
      *)
        echo "retry did not disable provenance"
        exit 1
        ;;
    esac
    ;;
  tlog-always-fails)
    echo "npm error code TLOG_CREATE_ENTRY_ERROR"
    echo "npm error error creating tlog entry - (409) an equivalent entry already exists in the transparency log with UUID abc"
    exit 1
    ;;
  non-tlog-failure)
    echo "npm error code E500"
    exit 1
    ;;
esac
exit 1
`,
  );

  writeExecutable(
    join(binDir, "npm"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'npm %s\\n' "$*" >> "$FAKE_CALL_LOG"
if [ "$1" = "view" ]; then
  if [ "\${NPM_VIEW_CROSS:-}" = "true" ]; then
    # Cross-visibility mode: a package resolves only after every OTHER
    # package has been polled at least once. Mutually dependent visibility
    # can only converge when the polls run concurrently.
    spec="$2"
    name="\${spec%@*}"
    safe="$(printf '%s' "$name" | tr '/@' '__')"
    touch "$FAKE_STATE_DIR/seen-$safe"
    all_seen=true
    for other in $CROSS_PACKAGES; do
      osafe="$(printf '%s' "$other" | tr '/@' '__')"
      [ "$osafe" = "$safe" ] && continue
      [ -f "$FAKE_STATE_DIR/seen-$osafe" ] || all_seen=false
    done
    if [ "$all_seen" = "true" ]; then
      echo "1.2.3"
      exit 0
    fi
    exit 1
  fi
  checks=0
  if [ -f "$FAKE_STATE_DIR/view-checks" ]; then
    read -r checks < "$FAKE_STATE_DIR/view-checks"
  fi
  checks=$((checks + 1))
  echo "$checks" > "$FAKE_STATE_DIR/view-checks"
  if [ "$NPM_VERSION_EXISTS" = "true" ] ||
    { [ "$NPM_VERSION_EXISTS_AFTER_CHECKS" -gt 0 ] && [ "$checks" -ge "$NPM_VERSION_EXISTS_AFTER_CHECKS" ]; }; then
    echo "1.2.3"
    exit 0
  fi
fi
if [ "$1" = "publish" ]; then
  case "$PNPM_MODE" in
    success)
      echo "published"
      exit 0
      ;;
    tlog-then-success)
      if [ ! -f "$FAKE_STATE_DIR/npm-called" ]; then
        touch "$FAKE_STATE_DIR/npm-called"
        echo "npm error code TLOG_CREATE_ENTRY_ERROR"
        echo "npm error error creating tlog entry - (409) an equivalent entry already exists in the transparency log with UUID abc"
        exit 1
      fi
      case " $* " in
        *" --provenance=false "*)
          echo "published without provenance"
          exit 0
          ;;
      esac
      ;;
    tlog-always-fails)
      echo "npm error code TLOG_CREATE_ENTRY_ERROR"
      echo "npm error error creating tlog entry - (409) an equivalent entry already exists in the transparency log with UUID abc"
      exit 1
      ;;
    non-tlog-failure)
      echo "npm error code E500"
      exit 1
      ;;
  esac
fi
exit 1
`,
  );

  writeExecutable(
    join(binDir, "npx"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'npx %s\n' "$*" >> "$FAKE_CALL_LOG"
[ "$1" = "--yes" ] && shift
case "$1" in
  npm@10.9.7|npm@11.18.0) shift ;;
esac
exec npm "$@"
`,
  );

  const shellOptions = callerPipefail ? "set -euo pipefail" : "set -eu";
  // The cross-visibility concurrency test needs real (fractional-second)
  // sleeps so slower-starting sibling polls get a chance to run; every other
  // test records virtual waiting so registry-delay tests stay fast/offline.
  const sleepStub = visibilityPackages
    ? ""
    : `sleep() { printf 'sleep %s\\n' "$*" >> "$FAKE_CALL_LOG"; }`;
  const packageInfo = (
    visibilityPackages ?? ["@penclipai/example"]
  )
    .map((name) => `packages/example\t${name}\t1.2.3`)
    .join("\n");
  const script = `
${shellOptions}
export PATH=${shellQuote(`${toBashPath(binDir)}:${bashToolPath}`)}
export FAKE_CALL_LOG=${shellQuote(toBashPath(callLog))}
export FAKE_STATE_DIR=${shellQuote(toBashPath(stateDir))}
export NPM_VERSION_EXISTS=${shellQuote(npmVersionExists ? "true" : "false")}
export PNPM_MODE=${shellQuote(pnpmMode)}
export REPO_ROOT=${shellQuote(toBashPath(fixtureDir))}
export GITHUB_ACTIONS=${shellQuote(githubActions ? "true" : "")}
export NODE_AUTH_TOKEN=${shellQuote(nodeAuthToken)}
source "${repoRoot}/scripts/release-lib.sh"
${sleepStub}
${
  visibilityPackages
    ? `PACKAGE_INFO="$(printf '${packageInfo}')"
wait_for_npm_package_versions "$VERIFY_ATTEMPTS" "$VERIFY_DELAY_SECONDS" "$PACKAGE_INFO"`
    : waitForRegistry
      ? `publish_package_to_npm ${distTag} @penclipai/example 1.2.3 ${publishTool}
PACKAGE_INFO="$(printf '${packageInfo}')"
wait_for_npm_package_versions "$VERIFY_ATTEMPTS" "$VERIFY_DELAY_SECONDS" "$PACKAGE_INFO"`
      : `publish_package_to_npm ${distTag} @penclipai/example 1.2.3 ${publishTool}`
}
`;

  let status = 0;
  let output = "";
  try {
    output = execFileSync("bash", ["-c", script], {
      cwd: fixtureDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        FAKE_CALL_LOG: toBashPath(callLog),
        FAKE_STATE_DIR: toBashPath(stateDir),
        NPM_VERSION_EXISTS: npmVersionExists ? "true" : "false",
        NPM_VERSION_EXISTS_AFTER_CHECKS: String(npmVersionExistsAfterChecks),
        VERIFY_ATTEMPTS: String(verifyAttempts),
        VERIFY_DELAY_SECONDS: String(verifyDelaySeconds),
        NPM_VIEW_CROSS: visibilityPackages ? "true" : "false",
        CROSS_PACKAGES: (visibilityPackages ?? []).join(" "),
        PNPM_MODE: pnpmMode,
        REPO_ROOT: toBashPath(fixtureDir),
        GITHUB_ACTIONS: githubActions ? "true" : "",
        NODE_AUTH_TOKEN: nodeAuthToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    status = error.status ?? 1;
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }

  return {
    calls: readFileSync(callLog, "utf8"),
    output,
    status,
  };
}

test("publish_package_to_npm returns after a successful pnpm publish", () => {
  const result = runPublishHelper({ pnpmMode: "success" });

  assert.equal(result.status, 0);
  assert.match(result.calls, /^pnpm publish --no-git-checks --tag canary --access public$/m);
  assert.doesNotMatch(result.calls, /npm view/);
  assert.doesNotMatch(result.calls, /--provenance=false/);
});

test("the controlled OIDC npm shim pins npm 11.18.0 and forwards pnpm publish arguments", () => {
  assert.match(oidcNpmShim, /^exec npx --yes npm@11\.18\.0 "\$@"$/m);
});

test("pnpm 9 executes the OIDC npm path with its packed manifest and lifecycle ownership intact", {
  skip: process.platform === "win32" && "POSIX executable npm-path integration runs on Ubuntu CI",
}, () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "paperclip-oidc-npm-path-"));
  const fakeBinDir = join(fixtureDir, "runtime-bin");
  const captureDir = join(fixtureDir, "capture");
  const archiveDir = join(fixtureDir, "archive");
  const lifecycleLog = join(fixtureDir, "lifecycle.log");
  const npxArgs = join(captureDir, "npx-args.log");
  const publishedArchive = join(captureDir, "published.tgz");
  mkdirSync(fakeBinDir, { recursive: true });
  mkdirSync(captureDir);
  mkdirSync(archiveDir);
  mkdirSync(join(fixtureDir, "src"));
  writeFileSync(join(fixtureDir, "src", "index.cjs"), "module.exports = 'source';\n");
  mkdirSync(join(fixtureDir, "dist"));
  writeFileSync(join(fixtureDir, "dist", "index.cjs"), "module.exports = 'published';\n");
  writeFileSync(join(fixtureDir, "lifecycle.cjs"), [
    "const { appendFileSync } = require('node:fs');",
    "appendFileSync(process.env.LIFECYCLE_LOG, process.argv[2] + '\\n');",
    "",
  ].join("\n"));
  writeFileSync(join(fixtureDir, "package.json"), JSON.stringify({
    name: "@penclipai/oidc-npm-path-fixture",
    version: "1.2.3",
    main: "src/index.cjs",
    files: ["src", "dist", "lifecycle.cjs"],
    scripts: {
      prepublishOnly: "node lifecycle.cjs prepublishOnly",
      prepack: "node lifecycle.cjs prepack",
      prepare: "node lifecycle.cjs prepare",
      postpack: "node lifecycle.cjs postpack",
      publish: "node lifecycle.cjs publish",
      postpublish: "node lifecycle.cjs postpublish",
    },
    publishConfig: {
      access: "public",
      exports: {
        ".": "./dist/index.cjs",
      },
      main: "dist/index.cjs",
      tag: "canary",
    },
  }, null, 2));
  const pnpmLauncher = execFileSync("sh", ["-c", "command -v pnpm"], { encoding: "utf8" }).trim();
  const pnpmCliPath = readFileSync(pnpmLauncher, "utf8").match(/\/(?:[^\s]+\/)*pnpm\.cjs/)?.[0];
  assert.ok(pnpmCliPath, "the POSIX pnpm launcher must resolve to its pnpm.cjs entrypoint");
  const fakeNodePath = join(fakeBinDir, "node");
  copyFileSync(process.execPath, fakeNodePath);
  chmodSync(fakeNodePath, 0o755);
  const pnpmVersion = execFileSync(fakeNodePath, [pnpmCliPath, "--version"], { encoding: "utf8" }).trim();
  assert.match(pnpmVersion, /^9\./, "this integration fixture must exercise pnpm 9");

  // pnpm's runNpm prepends dirname(process.execPath) ahead of the inherited PATH.
  writeExecutable(join(fakeBinDir, "npx"), "#!/usr/bin/env bash\nset -euo pipefail\n[ \"$#\" -ge 5 ]\n[ \"$1\" = \"--yes\" ]\n[ \"$2\" = \"npm@11.18.0\" ]\n[ \"$3\" = \"publish\" ]\n[ \"$4\" = \"--ignore-scripts\" ]\nprintf '%s\\n' \"$@\" > \"$FAKE_NPX_ARGS\"\ncp \"$5\" \"$FAKE_PUBLISHED_ARCHIVE\"\n");

  execFileSync(fakeNodePath, [pnpmCliPath,
    "publish",
    "--no-git-checks",
    "--tag",
    "canary",
    "--access",
    "public",
  ], {
    cwd: fixtureDir,
    encoding: "utf8",
    env: {
      ...process.env,
      FAKE_NPX_ARGS: npxArgs,
      FAKE_PUBLISHED_ARCHIVE: publishedArchive,
      LIFECYCLE_LOG: lifecycleLog,
      npm_config_npm_path: oidcNpmShimPath,
    },
  });

  assert.deepEqual(readFileSync(npxArgs, "utf8").trim().split("\n"), [
    "--yes",
    "npm@11.18.0",
    "publish",
    "--ignore-scripts",
    "penclipai-oidc-npm-path-fixture-1.2.3.tgz",
    "--no-git-checks",
    "--tag",
    "canary",
    "--access",
    "public",
  ]);
  assert.equal(readFileSync(npxArgs, "utf8").includes(oidcNpmShimPath), false);
  assert.deepEqual(readFileSync(lifecycleLog, "utf8").trim().split("\n"), [
    "prepublishOnly",
    "prepack",
    "prepare",
    "postpack",
    "publish",
    "postpublish",
  ]);
  assert.equal(readFileSync(lifecycleLog, "utf8").match(/^prepack$/gm)?.length, 1);

  execFileSync("tar", ["-xzf", publishedArchive, "-C", archiveDir]);
  const packedManifest = JSON.parse(readFileSync(join(archiveDir, "package", "package.json"), "utf8"));
  assert.deepEqual(packedManifest.exports, { ".": "./dist/index.cjs" });
  assert.equal(packedManifest.main, "dist/index.cjs");
  assert.equal(packedManifest.publishConfig.access, "public");
  assert.equal(packedManifest.publishConfig.tag, "canary");
  assert.equal(readFileSync(join(archiveDir, "package", "dist", "index.cjs"), "utf8"), "module.exports = 'published';\n");
});

test("publish_package_to_npm uses the pinned OIDC npm configuration for an ordinary tokenless GitHub Actions publish", () => {
  const result = runPublishHelper({ pnpmMode: "success", githubActions: true });

  assert.equal(result.status, 0);
  assert.match(result.calls, /^npm_config_npm_path=.+\/scripts\/npm-publish-oidc\.sh$/m);
  assert.match(result.calls, /^pnpm publish --no-git-checks --tag canary --access public$/m);
  assert.doesNotMatch(result.calls, /^pnpm --npm-path /m);
  assert.doesNotMatch(result.calls, /^npx /m);
});

test("publish_package_to_npm keeps the local token path unchanged", () => {
  const result = runPublishHelper({ pnpmMode: "success", githubActions: true, nodeAuthToken: "local-token" });

  assert.equal(result.status, 0);
  assert.match(result.calls, /^npm_config_npm_path=$/m);
  assert.match(result.calls, /^pnpm publish --no-git-checks --tag canary --access public$/m);
  assert.doesNotMatch(result.calls, /--npm-path/);
});

test("publish_package_to_npm uses trusted publishing from the bundled staging directory", () => {
  const result = runPublishHelper({ pnpmMode: "success", publishTool: "npm" });

  assert.equal(result.status, 0);
  assert.match(
    result.calls,
    /^npx --yes npm@11\.18\.0 publish --tag canary --access public --ignore-scripts --loglevel verbose$/m,
  );
  assert.match(
    result.calls,
    /^npm publish --tag canary --access public --ignore-scripts --loglevel verbose$/m,
  );
  assert.doesNotMatch(result.calls, / pack /);
  assert.doesNotMatch(result.calls, /^pnpm publish/m);
});

test("publish_package_to_npm keeps bundled staging on its existing pinned npm path in GitHub Actions", () => {
  const result = runPublishHelper({ pnpmMode: "success", publishTool: "npm", githubActions: true });

  assert.equal(result.status, 0);
  assert.match(result.calls, /^npx --yes npm@11\.18\.0 publish --tag canary --access public --ignore-scripts --loglevel verbose$/m);
  assert.doesNotMatch(result.calls, /--npm-path/);
});

test("publish_package_to_npm retries bundled directory tlog failures without provenance", () => {
  const result = runPublishHelper({ pnpmMode: "tlog-then-success", publishTool: "npm" });

  assert.equal(result.status, 0);
  assert.match(result.calls, /^npm view @penclipai\/example@1\.2\.3 version$/m);
  assert.match(
    result.calls,
    /^npm publish --tag canary --access public --provenance=false --ignore-scripts --loglevel verbose$/m,
  );
});

test("publish_package_to_npm retries duplicate tlog failures without provenance", () => {
  const result = runPublishHelper({ pnpmMode: "tlog-then-success" });

  assert.equal(result.status, 0);
  assert.match(result.calls, /^npm view @penclipai\/example@1\.2\.3 version$/m);
  assert.match(
    result.calls,
    /^pnpm publish --no-git-checks --tag canary --access public --provenance=false$/m,
  );
});

test("publish_package_to_npm keeps the pinned OIDC npm configuration on a provenance retry", () => {
  const result = runPublishHelper({ pnpmMode: "tlog-then-success", githubActions: true });

  assert.equal(result.status, 0);
  assert.equal(result.calls.match(/^npm_config_npm_path=.+\/scripts\/npm-publish-oidc\.sh$/gm)?.length, 2);
  assert.match(result.calls, /^pnpm publish --no-git-checks --tag canary --access public --provenance=false$/m);
});

test("publish_package_to_npm treats a duplicate tlog failure as complete when npm exposes the version", () => {
  const result = runPublishHelper({ pnpmMode: "tlog-always-fails", npmVersionExists: true });

  assert.equal(result.status, 0);
  assert.match(result.calls, /^npm view @penclipai\/example@1\.2\.3 version$/m);
  assert.doesNotMatch(result.calls, /--provenance=false/);
});

test("publish_package_to_npm does not retry unrelated publish failures", () => {
  const result = runPublishHelper({ pnpmMode: "non-tlog-failure" });

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.calls, /npm view/);
  assert.doesNotMatch(result.calls, /--provenance=false/);
});

test("publish_package_to_npm does not mask failures when caller has no pipefail", () => {
  const result = runPublishHelper({ pnpmMode: "non-tlog-failure", callerPipefail: false });

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.calls, /npm view/);
  assert.doesNotMatch(result.calls, /--provenance=false/);
});

test("publish_package_to_npm does not retry stable publishes without provenance", () => {
  const result = runPublishHelper({ pnpmMode: "tlog-then-success", distTag: "latest" });

  assert.notEqual(result.status, 0);
  assert.match(result.calls, /^npm view @penclipai\/example@1\.2\.3 version$/m);
  assert.doesNotMatch(result.calls, /--provenance=false/);
});

test("wait_for_npm_package_versions confirms registry visibility after a publish", () => {
  const result = runPublishHelper({
    pnpmMode: "success",
    npmVersionExists: true,
    waitForRegistry: true,
  });

  assert.equal(result.status, 0);
  assert.match(result.calls, /^pnpm publish --no-git-checks --tag canary --access public$/m);
  assert.match(result.calls, /^npm view @penclipai\/example@1\.2\.3 version$/m);
});

test("wait_for_npm_package_versions blocks the release and names the straggler", () => {
  const result = runPublishHelper({ pnpmMode: "success", waitForRegistry: true });

  assert.notEqual(result.status, 0);
  assert.match(result.calls, /^npm view @penclipai\/example@1\.2\.3 version$/m);
  assert.match(result.output, /did not become registry-visible: @penclipai\/example@1\.2\.3/);
});

test("wait_for_npm_package_versions polls every package concurrently", () => {
  // In cross-visibility mode each fake package resolves only after the OTHER
  // package has been polled at least once. Waiting out one package's full
  // budget before polling the next can never satisfy the first package;
  // only concurrent polling converges.
  const result = runPublishHelper({
    pnpmMode: "success",
    visibilityPackages: ["@penclipai/alpha", "@penclipai/beta"],
    verifyAttempts: 50,
    verifyDelaySeconds: 0.2,
  });

  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /@penclipai\/alpha@1\.2\.3 is registry-visible/);
  assert.match(result.output, /@penclipai\/beta@1\.2\.3 is registry-visible/);
});

test("the workflow budget tolerates the observed 15-minute 20-second registry delay", () => {
  const budget = workflowVerifyBudget();
  assert.ok(budget.verifyDelaySeconds > 0);
  const delayedCheck = Math.ceil((15 * 60 + 20) / budget.verifyDelaySeconds) + 1;
  const result = runPublishHelper({
    pnpmMode: "success",
    waitForRegistry: true,
    npmVersionExistsAfterChecks: delayedCheck,
    ...budget,
  });

  assert.equal(result.status, 0, result.output);
  assert.equal(result.calls.match(/^pnpm publish /gm)?.length, 1);
  assert.equal(result.calls.match(/^npm view /gm)?.length, delayedCheck);
  assert.deepEqual(
    result.calls.split("\n").filter((call) => call.startsWith("sleep ")),
    Array(delayedCheck - 1).fill(`sleep ${budget.verifyDelaySeconds}`),
  );
});

test("the workflow budget does not delay an immediately visible publish", () => {
  const result = runPublishHelper({
    pnpmMode: "success",
    npmVersionExists: true,
    waitForRegistry: true,
    ...workflowVerifyBudget(),
  });

  assert.equal(result.status, 0, result.output);
  assert.equal(result.calls.match(/^npm view /gm)?.length, 1);
  assert.doesNotMatch(result.calls, /^sleep /m);
});

test("the workflow budget fails closed after the last registry check", () => {
  const budget = workflowVerifyBudget();
  assert.ok(budget.verifyAttempts > 0);
  const result = runPublishHelper({
    pnpmMode: "success",
    waitForRegistry: true,
    npmVersionExistsAfterChecks: budget.verifyAttempts + 1,
    ...budget,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /did not become registry-visible/);
  assert.equal(result.calls.match(/^pnpm publish /gm)?.length, 1);
  assert.equal(result.calls.match(/^npm view /gm)?.length, budget.verifyAttempts);
  assert.equal(result.calls.match(/^sleep /gm)?.length, budget.verifyAttempts - 1);
});

test("every publish job budgets for build time and four delayed packages", () => {
  const { verifyAttempts, verifyDelaySeconds } = workflowVerifyBudget();
  const pollingSeconds = (verifyAttempts - 1) * verifyDelaySeconds;
  const requiredSeconds = 30 * 60 + 4 * pollingSeconds;

  for (const job of ["publish_canary", "publish_nightly", "publish_beta", "publish_stable"]) {
    const body = releaseWorkflow.split(`\n  ${job}:\n`)[1]?.split(/\n  [a-z_]+:\n/)[0] ?? "";
    const timeoutMinutes = Number(body.match(/^    timeout-minutes: (\d+)$/m)?.[1]);
    assert.ok(timeoutMinutes * 60 > requiredSeconds, `${job} must leave time beyond build and polling`);
  }
});

test("dry-run preview isolates Hermes while retaining safe package parallelism and preserves complete failure output", { skip: process.platform === "win32" && !existsSync("C:\\Program Files\\Git\\bin\\bash.exe") }, () => {
  assert.ok(previewFunction, "release.sh must expose the preview batch function for the behavior fixture");
  const fixtureDir = mkdtempSync(join(tmpdir(), "paperclip-release-preview-"));
  const binDir = join(fixtureDir, "bin");
  const stateDir = join(fixtureDir, "state");
  const tempDir = join(fixtureDir, "tmp");
  for (const dir of [binDir, stateDir, tempDir]) mkdirSync(dir);
  for (const dir of ["packages/one", "packages/two", "packages/adapters/hermes", "packages/three", "packages/fail", "packages/bundled", "packages/prepare-fail", "packages/tool-fail"]) mkdirSync(join(fixtureDir, dir), { recursive: true });
  const calls = join(stateDir, "calls.log");
  writeFileSync(calls, "");
  writeExecutable(join(binDir, "pnpm"), `#!/usr/bin/env bash
set -euo pipefail
pkg="$(basename "$PWD")"
printf '%s\n' "$pkg" >> "$FAKE_CALLS"
touch "$FAKE_STATE/pnpm-called-$pkg"
wait_for_file() {
  local target="$1" deadline=$((SECONDS + 10))
  while [ ! -f "$target" ]; do
    if [ "$SECONDS" -ge "$deadline" ]; then echo "BARRIER_TIMEOUT:$pkg"; exit 90; fi
    sleep 0.02
  done
}
if [ "$pkg" = "hermes" ]; then
  if [ "$FAKE_PHASE" = "unsafe" ]; then
    wait_for_file "$FAKE_STATE/ready-one"
    wait_for_file "$FAKE_STATE/ready-two"
    if compgen -G "$FAKE_STATE/active-one" > /dev/null && compgen -G "$FAKE_STATE/active-two" > /dev/null; then
      echo "HERMES_OVERLAPPED"
      touch "$FAKE_STATE/release-ordinary"
      exit 91
    fi
    echo "HERMES_BARRIER_BROKEN"
    exit 93
  fi
  if compgen -G "$FAKE_STATE/active-*" > /dev/null; then echo "HERMES_OVERLAPPED"; exit 91; fi
else
  touch "$FAKE_STATE/active-$pkg"
  trap 'rm -f "$FAKE_STATE/active-$pkg"' EXIT
  if [ "$pkg" = "one" ] || [ "$pkg" = "two" ]; then
    touch "$FAKE_STATE/ready-$pkg"
    if [ "$FAKE_PHASE" = "unsafe" ]; then
      wait_for_file "$FAKE_STATE/release-ordinary"
    else
      other=two; [ "$pkg" = "two" ] && other=one
      wait_for_file "$FAKE_STATE/ready-$other"
      touch "$FAKE_STATE/others-overlapped"
    fi
  fi
fi
if [ "$pkg" = "fail" ]; then
  printf 'FAIL-FIRST-LINE\\nFAIL-SECOND-LINE\\nFAIL-THIRD-LINE\\nFAIL-FOURTH-LINE\\nFAIL-FIFTH-LINE\\n'
  exit 47
fi
printf '%s line-1\\n%s line-2\\n%s line-3\\n%s line-4\\n%s line-5\\n' "$pkg" "$pkg" "$pkg" "$pkg" "$pkg"
`);
  writeExecutable(join(binDir, "node"), `#!/usr/bin/env bash
set -euo pipefail
case "$2" in
  */packages/prepare-fail)
    printf 'PREP-FIRST-LINE\\nPREP-SECOND-LINE\\nPREP-THIRD-LINE\\nPREP-FOURTH-LINE\\nPREP-FIFTH-LINE\\n'
    exit 49
    ;;
esac
mkdir -p "\${!#}"
`);
  const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
  const bashFixture = process.platform === "win32" ? toGitBashPath(fixtureDir) : fixtureDir;
  const bashBin = process.platform === "win32" ? toGitBashPath(binDir) : binDir;
  const bashState = process.platform === "win32" ? toGitBashPath(stateDir) : stateDir;
  const bashTemp = process.platform === "win32" ? toGitBashPath(tempDir) : tempDir;
  const bashCalls = process.platform === "win32" ? toGitBashPath(calls) : calls;
  const packageInfo = "packages/one\tone\t1\npackages/two\ttwo\t1\npackages/adapters/hermes\thermes\t1\npackages/three\tthree\t1";
  const script = `set -euo pipefail
export REPO_ROOT=${shellQuote(bashFixture)} DIST_TAG=canary TMPDIR=${shellQuote(bashTemp)} PATH=${shellQuote(`${bashBin}:${bashToolPath}`)} FAKE_STATE=${shellQuote(bashState)} FAKE_CALLS=${shellQuote(bashCalls)}
release_info() { printf '%s\\n' "$*"; }
package_publish_tool() { case "$PWD" in */tool-fail) return 17 ;; */bundled|*/prepare-fail) printf 'npm\\n' ;; *) printf 'pnpm\\n' ;; esac; }
run_bundled_npm_pack() { touch "$FAKE_STATE/bundle-pack-called"; printf 'BUNDLE-FIRST-LINE\\nBUNDLE-SECOND-LINE\\nBUNDLE-THIRD-LINE\\nBUNDLE-FOURTH-LINE\\nBUNDLE-FIFTH-LINE\\n'; return 48; }
${previewFunction}
unsafe_preview() {
  local package_info="$1" pkg_dir _pkg_name _pkg_version failed=0
  local -a pids=()
  while IFS=$'\t' read -r pkg_dir _pkg_name _pkg_version; do
    (
      cd "$REPO_ROOT/$pkg_dir"
      pnpm publish --dry-run --no-git-checks --tag "$DIST_TAG"
    ) &
    pids+=($!)
  done <<< "$package_info"
  for pid in "\${pids[@]}"; do wait "$pid" || failed=1; done
  return "$failed"
}
set +e
export FAKE_PHASE=unsafe
unsafe_preview ${shellQuote(packageInfo)}
unsafe_status=$?
set -e
printf 'UNSAFE_STATUS=%s\\n' "$unsafe_status"
rm -f "$FAKE_STATE"/active-* "$FAKE_STATE"/ready-* "$FAKE_STATE/release-ordinary" "$FAKE_STATE/others-overlapped"
export FAKE_PHASE=safe
preview_publish_payloads ${shellQuote(packageInfo)}
if preview_publish_payloads ${shellQuote("packages/missing\tmissing\t1")}; then missing_status=0; else missing_status=$?; fi
if preview_publish_payloads ${shellQuote("packages/tool-fail\ttool-fail\t1")}; then tool_status=0; else tool_status=$?; fi
set +e
preview_publish_payloads ${shellQuote("packages/fail\tfail\t1")}
failure_status=$?
preview_publish_payloads ${shellQuote("packages/bundled\tbundled\t1")}
bundle_failure_status=$?
rm -f "$FAKE_STATE/bundle-pack-called"
preview_publish_payloads ${shellQuote("packages/prepare-fail\tprepare-fail\t1")}
prepare_failure_status=$?
set -e
printf 'FAILURE_STATUS=%s\\n' "$failure_status"
printf 'BUNDLE_FAILURE_STATUS=%s\\n' "$bundle_failure_status"
printf 'PREPARE_FAILURE_STATUS=%s\\n' "$prepare_failure_status"
printf 'MISSING_STATUS=%s\\n' "$missing_status"
printf 'TOOL_STATUS=%s\\n' "$tool_status"
`;
  let output = "";
  try {
    output = execFileSync(bash, ["-lc", script], { encoding: "utf8", cwd: fixtureDir, env: { ...process.env } });
  } catch (error) {
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    assert.fail(output);
  }
  assert.ok(existsSync(join(stateDir, "others-overlapped")), output);
  assert.match(output, /HERMES_OVERLAPPED/);
  assert.match(output, /UNSAFE_STATUS=1/);
  const safeOutput = output.split("UNSAFE_STATUS=1")[1] ?? "";
  assert.doesNotMatch(safeOutput, /HERMES_OVERLAPPED|PACKAGE_OVERLAPPED_HERMES/);
  assert.match(output, /hermes line-3\nhermes line-4\nhermes line-5/);
  assert.doesNotMatch(output, /hermes line-1/);
  assert.match(output, /FAIL-FIRST-LINE[\s\S]*FAIL-FIFTH-LINE/);
  assert.match(output, /FAILURE_STATUS=1/);
  assert.match(output, /BUNDLE-FIRST-LINE[\s\S]*BUNDLE-FIFTH-LINE/);
  assert.match(output, /BUNDLE_FAILURE_STATUS=1/);
  assert.match(output, /PREP-FIRST-LINE[\s\S]*PREP-FIFTH-LINE/);
  assert.match(output, /PREPARE_FAILURE_STATUS=1/);
  assert.match(output, /MISSING_STATUS=1/);
  assert.match(output, /TOOL_STATUS=1/);
  assert.equal(existsSync(join(stateDir, "bundle-pack-called")), false, "failed package preparation must not run npm pack");
  assert.equal(existsSync(join(stateDir, "pnpm-called-tool-fail")), false, "failed tool resolution must not run pnpm");
  assert.doesNotMatch(readFileSync(calls, "utf8"), /^missing$/m, "failed directory change must not run pnpm");
  assert.doesNotMatch(readFileSync(calls, "utf8"), /npm/);
});

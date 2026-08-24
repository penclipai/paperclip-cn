import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
const bashRepoRoot = execFileSync("bash", ["-c", "pwd"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();
const scriptPath = join(repoRoot, "scripts", "release-registry-versions.mjs");

function writeExecutable(path, body) {
  writeFileSync(path, body, { mode: 0o755 });
}

function makeFixture() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "paperclip-release-registry-"));
  const bashFixtureDir = execFileSync("bash", ["-c", "pwd"], {
    cwd: fixtureDir,
    encoding: "utf8",
  }).trim();
  const binDir = join(fixtureDir, "bin");
  const callLog = join(fixtureDir, "calls.log");
  mkdirSync(binDir);
  writeFileSync(callLog, "");

  writeFileSync(
    join(binDir, "npm.cjs"),
    `const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_CALL_LOG, \`npm \${args.join(" ")}\\n\`);
const target = args[1] ?? "";
if (target.startsWith("@paperclipai/present@")) {
  process.stdout.write(\`\${target.slice(target.lastIndexOf("@") + 1)}\\n\`);
} else if (target.startsWith("@paperclipai/absent@")) {
  process.exitCode = 1;
} else if (target === "@paperclipai/present") {
  process.stdout.write('["1.0.0","2026.707.0","2026.707.1","2026.707.1-canary.4"]\\n');
} else {
  process.exitCode = 1;
}
`,
  );
  writeExecutable(join(binDir, "npm"), '#!/usr/bin/env bash\nexec node "$(dirname "$0")/npm.cjs" "$@"\n');
  if (process.platform === "win32") {
    writeFileSync(join(binDir, "npm.cmd"), '@echo off\r\nnode "%~dp0npm.cjs" %*\r\n');
  }

  return {
    fixtureDir,
    bashFixtureDir,
    binDir,
    bashBinDir: `${bashFixtureDir}/bin`,
    callLog,
    bashCallLog: `${bashFixtureDir}/calls.log`,
  };
}

function runScript(args, { binDir, callLog }, extraEnv = {}) {
  let status = 0;
  let stdout = "";
  let stderr = "";
  try {
    stdout = execFileSync("node", [scriptPath, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH}`,
        FAKE_CALL_LOG: callLog,
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    status = error.status ?? 1;
    stdout = error.stdout ?? "";
    stderr = error.stderr ?? "";
  }
  return { status, stdout, stderr, calls: readFileSync(callLog, "utf8") };
}

function runReleaseLibHelper(
  fnCall,
  { fixtureDir, bashFixtureDir, bashBinDir, callLog, bashCallLog },
  extraEnv = {},
) {
  const bashExtraEnv = Object.fromEntries(
    Object.entries(extraEnv).map(([key, value]) => [
      key,
      typeof value === "string" && value.startsWith(fixtureDir)
        ? `${bashFixtureDir}${value.slice(fixtureDir.length).replaceAll("\\", "/")}`
        : value,
    ]),
  );
  const shellQuote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;
  const exportLines = Object.entries({
    FAKE_CALL_LOG: bashCallLog,
    REPO_ROOT: bashRepoRoot,
    ...bashExtraEnv,
  })
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join("\n");
  const script = `
set -euo pipefail
${exportLines}
export PATH="${bashBinDir}:$PATH"
source "${bashRepoRoot}/scripts/release-lib.sh"
${fnCall}
`;
  let status = 0;
  let output = "";
  try {
    output = execFileSync("bash", ["-c", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    status = error.status ?? 1;
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  return { status, output, calls: readFileSync(callLog, "utf8") };
}

test("fetch prints a JSON version map and treats missing packages as empty", () => {
  const fixture = makeFixture();
  const result = runScript(["fetch", "@paperclipai/present", "@paperclipai/missing"], fixture);

  assert.equal(result.status, 0);
  const map = JSON.parse(result.stdout);
  assert.deepEqual(map["@paperclipai/present"], [
    "1.0.0",
    "2026.707.0",
    "2026.707.1",
    "2026.707.1-canary.4",
  ]);
  assert.deepEqual(map["@paperclipai/missing"], []);
  assert.match(result.calls, /^npm view @paperclipai\/present versions --json$/m);
  assert.match(result.calls, /^npm view @paperclipai\/missing versions --json$/m);
});

test("assert-absent succeeds when no package has the version", () => {
  const fixture = makeFixture();
  const result = runScript(
    ["assert-absent", "2026.707.2", "@paperclipai/absent", "@paperclipai/absent"],
    fixture,
  );

  assert.equal(result.status, 0);
  assert.match(result.calls, /^npm view @paperclipai\/absent@2026\.707\.2 version$/m);
});

test("assert-absent fails and names packages that already have the version", () => {
  const fixture = makeFixture();
  const result = runScript(
    ["assert-absent", "2026.707.2", "@paperclipai/present", "@paperclipai/absent"],
    fixture,
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm version @paperclipai\/present@2026\.707\.2 already exists\./);
  assert.doesNotMatch(result.stderr, /@paperclipai\/absent@/);
});

test("invalid concurrency fails instead of skipping registry checks", () => {
  const fixture = makeFixture();
  const result = runScript(["assert-absent", "2026.707.2", "@paperclipai/present"], fixture, {
    RELEASE_REGISTRY_CONCURRENCY: "0",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /RELEASE_REGISTRY_CONCURRENCY must be a positive integer\./);
  assert.equal(result.calls, "");
});

test("next_stable_version reads RELEASE_PACKAGE_VERSIONS_FILE without calling npm", () => {
  const fixture = makeFixture();
  const versionsFile = join(fixture.fixtureDir, "versions.json");
  writeFileSync(
    versionsFile,
    JSON.stringify({
      "@paperclipai/a": ["2026.707.0", "2026.707.1", "2026.707.1-canary.4"],
      "@paperclipai/b": [],
    }),
  );

  const result = runReleaseLibHelper(
    'next_stable_version 2026-07-07 "@paperclipai/a" "@paperclipai/b"',
    fixture,
    { RELEASE_PACKAGE_VERSIONS_FILE: versionsFile },
  );

  assert.equal(result.status, 0);
  assert.equal(result.output, "2026.707.2");
  assert.doesNotMatch(result.calls, /npm view/);
});

test("next_canary_version reads RELEASE_PACKAGE_VERSIONS_FILE without calling npm", () => {
  const fixture = makeFixture();
  const versionsFile = join(fixture.fixtureDir, "versions.json");
  writeFileSync(
    versionsFile,
    JSON.stringify({
      "@paperclipai/a": ["2026.707.0", "2026.707.1", "2026.707.1-canary.4"],
    }),
  );

  const result = runReleaseLibHelper('next_canary_version 2026.707.1 "@paperclipai/a"', fixture, {
    RELEASE_PACKAGE_VERSIONS_FILE: versionsFile,
  });

  assert.equal(result.status, 0);
  assert.equal(result.output, "2026.707.1-canary.5");
  assert.doesNotMatch(result.calls, /npm view/);
});

test("next_stable_version falls back to npm view without a versions file", () => {
  const fixture = makeFixture();
  const result = runReleaseLibHelper('next_stable_version 2026-07-07 "@paperclipai/present"', fixture);

  assert.equal(result.status, 0);
  assert.equal(result.output, "2026.707.2");
  assert.match(result.calls, /^npm view @paperclipai\/present versions --json$/m);
});

test("next_prerelease_version counts per channel so nightly numbering ignores canaries", () => {
  const fixture = makeFixture();
  const versionsFile = join(fixture.fixtureDir, "versions.json");
  writeFileSync(
    versionsFile,
    JSON.stringify({
      "@paperclipai/a": ["2026.707.1-canary.4", "2026.707.1-nightly.0", "2026.707.1-nightly.1"],
    }),
  );

  const result = runReleaseLibHelper(
    'next_prerelease_version nightly 2026.707.1 "@paperclipai/a"',
    fixture,
    { RELEASE_PACKAGE_VERSIONS_FILE: versionsFile },
  );

  assert.equal(result.status, 0);
  assert.equal(result.output, "2026.707.1-nightly.2");
  assert.doesNotMatch(result.calls, /npm view/);
});

test("next_prerelease_version counts beta numbering independently of other channels", () => {
  const fixture = makeFixture();
  const versionsFile = join(fixture.fixtureDir, "versions.json");
  writeFileSync(
    versionsFile,
    JSON.stringify({
      "@paperclipai/a": ["2026.707.1-canary.4", "2026.707.1-nightly.3", "2026.707.1-beta.0"],
    }),
  );

  const result = runReleaseLibHelper(
    'next_prerelease_version beta 2026.707.1 "@paperclipai/a"',
    fixture,
    { RELEASE_PACKAGE_VERSIONS_FILE: versionsFile },
  );

  assert.equal(result.status, 0);
  assert.equal(result.output, "2026.707.1-beta.1");
  assert.doesNotMatch(result.calls, /npm view/);
});

test("next_prerelease_version rejects unknown channels", () => {
  const fixture = makeFixture();
  const result = runReleaseLibHelper(
    'next_prerelease_version weekly 2026.707.1 "@paperclipai/a"',
    fixture,
  );

  assert.equal(result.status, 1);
  assert.match(result.output, /unknown prerelease channel: weekly/);
});

test("prerelease_tag_name namespaces tags by channel", () => {
  const fixture = makeFixture();
  const result = runReleaseLibHelper("prerelease_tag_name nightly 2026.707.1-nightly.2", fixture);

  assert.equal(result.status, 0);
  assert.equal(result.output.trim(), "nightly/v2026.707.1-nightly.2");
});

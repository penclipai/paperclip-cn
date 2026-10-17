import assert from "node:assert/strict";
import test from "node:test";

import {
  PLACEHOLDER_VERSION,
  buildPlaceholderFiles,
  inspectNpmPackage,
  parseArgs,
  printNextSteps,
  promptOtp,
  resolveNpmInvocation,
  runNpm,
  validatePackageName,
  waitForPackageVisible,
} from "./bootstrap-npm-package.mjs";

test("parseArgs recognizes the publish flag", () => {
  assert.deepEqual(parseArgs(["@penclipai/adapter-kimi-local", "--publish"]), {
    help: false,
    packageName: "@penclipai/adapter-kimi-local",
    publish: true,
  });
});

test("parseArgs defaults to a dry run", () => {
  assert.deepEqual(parseArgs(["@penclipai/adapter-kimi-local"]), {
    help: false,
    packageName: "@penclipai/adapter-kimi-local",
    publish: false,
  });
});

test("parseArgs rejects a second package name", () => {
  assert.throws(() => parseArgs(["@penclipai/a", "@penclipai/b"]), /exactly one package name/);
});

test("parseArgs rejects unknown options", () => {
  assert.throws(() => parseArgs(["@penclipai/a", "--skip-build"]), /unknown option/);
  assert.throws(() => parseArgs(["@penclipai/a", "--otp", "123456"]), /unknown option/);
});

test("validatePackageName accepts @penclipai scoped names", () => {
  validatePackageName("@penclipai/adapter-kimi-local");
  validatePackageName("@penclipai/plugin-workspace-diff");
});

test("validatePackageName rejects names outside the @penclipai scope", () => {
  assert.throws(() => validatePackageName("left-pad"), /@penclipai scope/);
  assert.throws(() => validatePackageName("@evil/adapter-kimi-local"), /@penclipai scope/);
  assert.throws(() => validatePackageName("@penclipai/UPPER"), /@penclipai scope/);
});

test("buildPlaceholderFiles produces a publishable manifest at the placeholder version", () => {
  const files = buildPlaceholderFiles("@penclipai/adapter-kimi-local");
  const manifest = JSON.parse(files["package.json"]);

  assert.equal(manifest.name, "@penclipai/adapter-kimi-local");
  assert.equal(manifest.version, PLACEHOLDER_VERSION);
  assert.equal(manifest.publishConfig.access, "public");
  assert.deepEqual(manifest.files, ["index.js"]);
  assert.match(manifest.description, /[Pp]laceholder/);
});

test("buildPlaceholderFiles entry point throws with a pointer to the repo", () => {
  const files = buildPlaceholderFiles("@penclipai/adapter-kimi-local");

  assert.match(files["index.js"], /^throw new Error\(/);
  assert.match(files["index.js"], /placeholder/);
  assert.match(files["index.js"], /github\.com\/penclipai\/paperclip-cn/);
  // The entry point must be valid JS: evaluating it should throw our message,
  // not a SyntaxError.
  assert.throws(() => new Function(files["index.js"])(), /placeholder that reserves/);
});

test("buildPlaceholderFiles README explains the placeholder", () => {
  const files = buildPlaceholderFiles("@penclipai/adapter-kimi-local");
  assert.match(files["README.md"], /placeholder publish/);
  assert.match(files["README.md"], /release-bootstrap CI gate/);
  assert.match(files["README.md"], /penclipai\/paperclip-cn/);
});

test("resolveNpmInvocation prefers the npm CLI beside the Windows Node executable", () => {
  const nodeDir = "C:\\Program Files\\nodejs";
  const npmCli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
  const shellNpmCli = "C:\\shell\\npm-cli.js";

  assert.deepEqual(resolveNpmInvocation({
    platform: "win32",
    execPath: `${nodeDir}\\node.exe`,
    env: { Path: nodeDir, npm_execpath: shellNpmCli },
    exists: (candidate) => candidate === npmCli || candidate === shellNpmCli,
  }), {
    command: `${nodeDir}\\node.exe`,
    argsPrefix: [npmCli],
  });
});

test("resolveNpmInvocation fails clearly when Windows has no npm CLI", () => {
  assert.throws(
    () => resolveNpmInvocation({
      platform: "win32",
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      env: { Path: "C:\\empty" },
      exists: () => false,
    }),
    /npm executable not found/,
  );
});

test("runNpm preserves publish arguments, cwd, and environment through the Windows npm CLI", () => {
  const invocation = {
    command: "C:\\Program Files\\nodejs\\node.exe",
    argsPrefix: ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js"],
  };
  const env = { PATH: "C:\\Program Files\\nodejs", npm_config_otp: "test-only" };
  let call;

  const result = runNpm(
    ["deprecate", "@penclipai/example@0.0.0", "placeholder note with spaces"],
    { cwd: "C:\\staging directory", env },
    {
      resolveInvocation: () => invocation,
      spawn: (command, args, options) => {
        call = { command, args, options };
        return { status: 0, stdout: "", stderr: "" };
      },
    },
  );

  assert.equal(result.status, 0);
  assert.deepEqual(call.command, invocation.command);
  assert.deepEqual(call.args, [...invocation.argsPrefix, "deprecate", "@penclipai/example@0.0.0", "placeholder note with spaces"]);
  assert.equal(call.options.cwd, "C:\\staging directory");
  assert.equal(call.options.env, env);
  assert.equal(call.options.env.npm_config_otp, "test-only");
  assert.doesNotMatch(call.args.join("\u0000"), /test-only/);
});

test("resolveNpmInvocation keeps the Linux npm command", () => {
  assert.deepEqual(resolveNpmInvocation({ platform: "linux" }), {
    command: "npm",
    argsPrefix: [],
  });
});

test("inspectNpmPackage uses the resolved npm CLI and keeps expected E404 quiet", () => {
  const invocation = {
    command: "C:\\Program Files\\nodejs\\node.exe",
    argsPrefix: ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js"],
  };
  let call;

  const state = inspectNpmPackage("@penclipai/new-package", {
    resolveInvocation: () => invocation,
    spawn: (command, args, options) => {
      call = { command, args, options };
      return { status: 1, stdout: "", stderr: "npm error code E404" };
    },
  });

  assert.deepEqual(state, { exists: false });
  assert.deepEqual(call.command, invocation.command);
  assert.deepEqual(call.args, [...invocation.argsPrefix, "view", "@penclipai/new-package", "version", "--json"]);
  assert.deepEqual(call.options.stdio, ["ignore", "pipe", "pipe"]);
});

test("printNextSteps keeps CI token publishing enabled", () => {
  let output = "";
  const write = process.stdout.write;
  process.stdout.write = (chunk) => {
    output += chunk;
    return true;
  };
  try {
    printNextSteps("@penclipai/new-package");
  } finally {
    process.stdout.write = write;
  }

  assert.match(output, /Keep token publishing enabled/);
  assert.match(output, /npm-canary and npm-stable environment tokens/);
  assert.doesNotMatch(output, /disallow tokens/);
});

test("promptOtp re-prompts until a non-empty code is entered", async () => {
  const answers = ["", "   ", " 123456 "];
  const rl = { question: async () => answers.shift() ?? "" };

  assert.equal(await promptOtp(rl, "publish"), "123456");
  assert.equal(answers.length, 0);
});

test("waitForPackageVisible requires consecutive sightings before reporting success", async () => {
  const states = [{ exists: false }, { exists: true }, { exists: false }, { exists: true }, { exists: true }];
  let sleeps = 0;

  const visible = await waitForPackageVisible("@penclipai/x", {
    attempts: 10,
    consecutive: 2,
    inspect: () => states.shift() ?? { exists: true },
    sleep: async () => {
      sleeps += 1;
    },
  });

  assert.equal(visible, true);
  // Five inspections happened; sleeps run between attempts, not before the first.
  assert.equal(sleeps, 4);
});

test("waitForPackageVisible times out when the package never appears", async () => {
  const visible = await waitForPackageVisible("@penclipai/x", {
    attempts: 3,
    consecutive: 2,
    inspect: () => ({ exists: false }),
    sleep: async () => {},
  });

  assert.equal(visible, false);
});

test("waitForPackageVisible treats registry errors as misses and keeps polling", async () => {
  let calls = 0;
  const visible = await waitForPackageVisible("@penclipai/x", {
    attempts: 6,
    consecutive: 2,
    inspect: () => {
      calls += 1;
      if (calls <= 2) throw new Error("transient registry error");
      return { exists: true };
    },
    sleep: async () => {},
  });

  assert.equal(visible, true);
  assert.equal(calls, 4);
});

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

if (
  path.basename(process.execPath).toLowerCase() === "git.exe"
  || path.basename(process.argv[0] ?? "").toLowerCase() === "git.exe"
) {
  const commandArgs = [
    ...process.execArgv.filter((arg) => !arg.startsWith("--require")),
    path.basename(process.argv[1] ?? ""),
    ...process.argv.slice(2),
  ];
  const cwdIndex = commandArgs.indexOf("-C");
  const cwd = cwdIndex === -1 ? process.cwd() : commandArgs[cwdIndex + 1];
  const once = path.join(cwd, ".git", "bootstrap-fail-once");
  const always = path.join(cwd, ".git", "bootstrap-fail-always");
  if (commandArgs.includes("--ignored") && (fs.existsSync(once) || fs.existsSync(always))) {
    if (fs.existsSync(once)) fs.unlinkSync(once);
    // The product's 10-second scan deadline terminates this Windows child
    // process. Atomics.wait keeps Node from advancing to its parsed faux
    // script name before that real process timeout happens.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);
    process.exit(1);
  } else {
    const realGit = process.env.BOOTSTRAP_REAL_GIT;
    if (!realGit || !path.isAbsolute(realGit) || !fs.existsSync(realGit)) {
      console.error("BOOTSTRAP_REAL_GIT must be an existing absolute path to git.exe for the Windows workspace-bootstrap shim.");
      process.exit(1);
    }
    const result = spawnSync(realGit, commandArgs, { stdio: "inherit" });
    process.exit(result.status ?? 1);
  }
}

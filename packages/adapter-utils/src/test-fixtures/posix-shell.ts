import { existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const gitBashCandidates = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
];

/**
 * Test-only adapter for fake remote sandboxes. Production sandbox commands
 * remain POSIX; this runs their scripts through Git Bash when the test host is
 * Windows.
 */
export function prepareTestPosixShell(input: {
  command: string;
  args?: string[];
  env?: Record<string, string> | NodeJS.ProcessEnv;
}): { command: string; args: string[]; env: Record<string, string> } {
  const isShell = input.command === "sh" || input.command === "bash" || input.command === "/bin/sh" || input.command === "/bin/bash";
  const args = [...(input.args ?? [])];
  const env = Object.fromEntries(
    Object.entries(input.env ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  if (!isShell || process.platform !== "win32") {
    return { command: input.command, args, env };
  }

  const command = gitBashCandidates.find(existsSync) ?? input.command;
  // Keep a fixture's explicit remote PATH byte-for-byte intact. Otherwise
  // provide the minimal host path Git Bash needs, without copying arbitrary
  // host environment values (which can also exceed Windows' spawn limit).
  if (env.PATH === undefined && env.Path === undefined) {
    env.PATH = [
      "C:\\Program Files\\Git\\usr\\bin",
      "C:\\Program Files\\Git\\bin",
      process.env.PATH ?? process.env.Path ?? "",
    ].filter(Boolean).join(path.delimiter);
  }
  for (const key of ["SystemRoot", "SYSTEMROOT", "ComSpec", "COMSPEC", "PATHEXT", "TEMP", "TMP"]) {
    if (env[key] === undefined && typeof process.env[key] === "string") env[key] = process.env[key];
  }

  if ((args[0] === "-c" || args[0] === "-lc") && typeof args[1] === "string") {
    args[1] = args[1]
      .replace(/'([A-Za-z]):\\([^']*)'/g, (_match, drive: string, rest: string) => `'/${drive.toLowerCase()}/${rest.replace(/\\/g, "/")}'`)
      .replace(/"([A-Za-z]):\\([^"]*)"/g, (_match, drive: string, rest: string) => `"/${drive.toLowerCase()}/${rest.replace(/\\/g, "/")}"`)
      .replace(/(?<![\w/\\.-])([A-Za-z]):\\([^'"\s]*)/g, (_match, drive: string, rest: string) => `/${drive.toLowerCase()}/${rest.replace(/\\/g, "/")}`)
      .replace(/'([A-Za-z]):\/([^']*)'/g, (_match, drive: string, rest: string) => `'/${drive.toLowerCase()}/${rest}'`)
      .replace(/"([A-Za-z]):\/([^"]*)"/g, (_match, drive: string, rest: string) => `"/${drive.toLowerCase()}/${rest}"`)
      .replace(/(?<![\w/\\.-])([A-Za-z]):\/([^'"\s]*)/g, (_match, drive: string, rest: string) => `/${drive.toLowerCase()}/${rest}`);
    // The fake launch script starts a Node wrapper after assigning the
    // simulated remote PATH. Resolve its bootstrap tools explicitly so
    // PATH-retention tests do not leak Git Bash paths to the child process.
    const nodePath = process.execPath
      .replace(/^([A-Za-z]):[\\/]/, (_match, drive: string) => `/${drive.toLowerCase()}/`)
      .replace(/\\/g, "/");
    args[1] = args[1].replace(/\bnohup\s+node(?=\s)/g, `/usr/bin/nohup '${nodePath}'`);
    args[1] = args[1].replace(/(^|\n)node(?=\s)/g, `$1'${nodePath}'`);
    // command-managed-runtime derives this parent from a POSIX dirname before
    // the physical Windows path is translated, yielding `mkdir -p '.'` for a
    // nested upload target. Repair only that generated base64 staging shape.
    args[1] = args[1].replace(
      /mkdir -p '\.' && (base64 -d >) '([^']+)'/g,
      (_match, operation: string, target: string) => `mkdir -p '${path.posix.dirname(target)}' && ${operation} '${target}'`,
    );
    args[1] = args[1].replace(
      /mkdir -p '\.' && rm -f '([^']+)' && : > '\1'/g,
      (_match, target: string) => `mkdir -p '${path.posix.dirname(target)}' && rm -f '${target}' && : > '${target}'`,
    );
    // Git Bash truncates long `-c` command strings well below Windows' native
    // command-line limit. Fake remote fixtures use generated base64 upload
    // scripts, so materialize only those long scripts in a private temp file.
    // The remote command and environment contract remain unchanged.
    if (args[1].length > 8_000) {
      const scriptPath = path.join(os.tmpdir(), `paperclip-test-shell-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sh`);
      writeFileSync(scriptPath, `trap '/usr/bin/rm -f "$0"' EXIT\n${args[1]}`, { encoding: "utf8", mode: 0o600 });
      args.splice(0, 2, scriptPath);
    }
  }
  return { command, args, env };
}

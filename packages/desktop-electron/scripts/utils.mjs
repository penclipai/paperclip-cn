#!/usr/bin/env node

import { chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

export function resolvePnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

export function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    shell: options.shell ?? false,
    stdio: options.stdio ?? "inherit",
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.signal) {
    console.error(`Command terminated by signal ${result.signal}: ${command}`);
    process.exit(1);
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

export function runNodeScript(scriptPath, args = [], options = {}) {
  runChecked(process.execPath, [scriptPath, ...args], options);
}

export function runPnpm(args, options = {}) {
  if (process.platform === "win32") {
    runChecked(process.env.comspec ?? "cmd.exe", ["/d", "/s", "/c", resolvePnpmCommand(), ...args], options);
    return;
  }

  runChecked(resolvePnpmCommand(), args, options);
}

export function killProcessTree(pid, options = {}) {
  if (!pid || Number.isNaN(pid)) {
    return;
  }

  if (process.platform === "win32") {
    const result = spawnSync(
      process.env.comspec ?? "cmd.exe",
      ["/d", "/s", "/c", "taskkill", "/PID", String(pid), "/T", "/F"],
      {
        cwd: options.cwd,
        stdio: options.stdio ?? "ignore",
        windowsHide: true,
      },
    );

    if (result.error) {
      throw result.error;
    }

    return;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Process already exited.
  }
}

export function bestEffortChmod(targetPath, mode = 0o755) {
  if (process.platform === "win32") return;

  try {
    chmodSync(targetPath, mode);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

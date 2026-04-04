#!/usr/bin/env node

import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { killProcessTree, runPnpm } from "./utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageDir, "../..");
const require = createRequire(import.meta.url);
const electronBin =
  process.platform === "win32"
    ? require("electron")
    : path.resolve(packageDir, "node_modules", ".bin", "electron");
const mainScript = path.resolve(packageDir, "dist", "main.js");
const forwardedArgs = process.argv.slice(2);
const electronArgs =
  forwardedArgs[0] === "--" ? forwardedArgs.slice(1) : forwardedArgs;

console.log("[desktop-electron] Building desktop shell...");
runPnpm(["--dir", repoRoot, "--filter", "@penclipai/server...", "build"], { cwd: repoRoot });
runPnpm(["--dir", packageDir, "build"], { cwd: packageDir });

console.log("[desktop-electron] Launching Electron...");
const child = spawn(electronBin, [...electronArgs, mainScript], {
  cwd: packageDir,
  stdio: "inherit",
  env: {
    ...process.env,
    PAPERCLIP_DESKTOP_DEV: "true",
  },
});

let shuttingDown = false;

function exitForSignal(signal) {
  if (signal === "SIGINT") {
    process.exit(130);
  }
  if (signal === "SIGTERM") {
    process.exit(143);
  }
  process.exit(1);
}

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  killProcessTree(child.pid, { cwd: packageDir });
  exitForSignal(signal);
}

child.on("exit", (code, signal) => {
  if (shuttingDown) {
    return;
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

process.once("SIGINT", () => {
  shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  shutdown("SIGTERM");
});

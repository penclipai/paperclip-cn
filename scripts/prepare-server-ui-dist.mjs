#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const uiDist = path.join(repoRoot, "ui", "dist");
const serverUiDist = path.join(repoRoot, "server", "ui-dist");

console.log("  -> Building @penclipai/ui...");
const buildResult = spawnSync("pnpm", ["--dir", repoRoot, "--filter", "@penclipai/ui", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

if (!fs.existsSync(path.join(uiDist, "index.html"))) {
  console.error(`Error: UI build output missing at ${path.join(uiDist, "index.html")}`);
  process.exit(1);
}

fs.rmSync(serverUiDist, { recursive: true, force: true });
fs.cpSync(uiDist, serverUiDist, { recursive: true, force: true });
console.log("  -> Copied ui/dist to server/ui-dist");

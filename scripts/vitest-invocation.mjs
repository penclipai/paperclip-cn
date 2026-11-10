import path from "node:path";

import { resolvePnpmInvocation } from "./pnpm-invocation.mjs";

// cmd.exe limits the command string passed to /c to 8,191 characters. Keep
// enough headroom for quoting and wrapper arguments when exact test-line
// filters make a Vitest invocation long.
export const windowsPnpmVitestCommandBudget = 7_000;

function quoteCmdArg(value) {
  if (/^[A-Za-z0-9_/:=.,@+\\-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

export function measurePnpmVitestCommand(vitestArgs) {
  return ["pnpm", "exec", "vitest", ...vitestArgs].map(quoteCmdArg).join(" ").length;
}

export function resolveVitestInvocation(vitestArgs, {
  platform = process.platform,
  repoRoot = process.cwd(),
  execPath = process.execPath,
  resolvePnpm = resolvePnpmInvocation,
} = {}) {
  if (platform === "win32" && measurePnpmVitestCommand(vitestArgs) > windowsPnpmVitestCommandBudget) {
    return {
      command: execPath,
      args: [path.join(repoRoot, "node_modules", "vitest", "vitest.mjs"), ...vitestArgs],
      spawnOptions: {},
    };
  }
  return resolvePnpm(["exec", "vitest", ...vitestArgs]);
}

import path from "node:path";

function quoteCmdArg(value) {
  if (/^[A-Za-z0-9_/:=.,@+\\-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

/** Resolve pnpm without parsing a native standalone executable as JavaScript. */
export function resolvePnpmInvocation(args, {
  npmExecPath = process.env.npm_execpath,
  platform = process.platform,
  execPath = process.execPath,
  env = process.env,
} = {}) {
  const extension = npmExecPath ? path.extname(npmExecPath).toLowerCase() : "";
  if (npmExecPath && /pnpm/i.test(path.basename(npmExecPath))) {
    if ([".js", ".cjs", ".mjs"].includes(extension)) {
      return { command: execPath, args: [npmExecPath, ...args], spawnOptions: {} };
    }
    if (extension === ".exe") {
      return { command: npmExecPath, args, spawnOptions: {} };
    }
  }

  if (platform === "win32") {
    return {
      command: env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", `"${["pnpm", ...args].map(quoteCmdArg).join(" ")}"`],
      spawnOptions: { windowsVerbatimArguments: true },
    };
  }

  return { command: "pnpm", args, spawnOptions: {} };
}

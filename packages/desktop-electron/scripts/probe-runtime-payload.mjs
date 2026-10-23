#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspectRuntimePayload, runtimePayloadInternals } from "./runtime-payload.mjs";

function requiredOption(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}.`);
  return args[index + 1];
}

export async function probeRuntimePayload({ runtimeRoot, platform, arch, description }) {
  const payload = inspectRuntimePayload({ runtimeRoot, platform, arch });
  if (!payload.supported) {
    if (platform !== "win32" || arch !== "x64") throw new Error("No reviewed native payload policy exists for this desktop target.");
    console.log("[desktop-runtime-payload] Windows x64 payload preserved; Unix OpenCode trimming does not apply.");
    return;
  }
  if (payload.unexpectedPackages.length > 0) throw new Error(`Unexpected OpenCode native packages: ${payload.unexpectedPackages.join(", ")}`);
  if (payload.portableMatchesNative && !payload.portableIsSymlink) throw new Error("Packaging expanded the deduplicated OpenCode portable executable into a second file.");
  const resolverPath = path.resolve(runtimeRoot, "server/dist/vendor/paperclip-runner/drivers/opencode/opencode-server-driver.js");
  const { resolvePinnedOpenCodeCommand } = await import(pathToFileURL(resolverPath).href);
  if (realpathSync(resolvePinnedOpenCodeCommand()) !== realpathSync(payload.nativeExecutable)) throw new Error("The packaged Runner selected a different OpenCode executable.");
  for (const executable of [payload.nativeExecutable, payload.portableExecutable]) {
    const result = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true, shell: false });
    if (result.error || result.status !== 0 || result.stdout.trim() !== runtimePayloadInternals.QUALIFIED_OPENCODE_VERSION) {
      throw new Error(`Packaged OpenCode version probe failed for ${path.relative(runtimeRoot, executable)}.`);
    }
  }
  console.log(`[desktop-runtime-payload] ${platform}/${arch} ${description}: ${payload.nativePackage}, Runner resolution and both executable entrypoints passed.`);
}

async function main() {
  const args = process.argv.slice(2);
  await probeRuntimePayload({
    runtimeRoot: requiredOption(args, "--runtime-root"),
    platform: requiredOption(args, "--platform"),
    arch: requiredOption(args, "--arch"),
    description: requiredOption(args, "--description"),
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : null;
if (invokedPath === import.meta.url) await main();

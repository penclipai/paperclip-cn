import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

const BUSY_EXIT_STATUS = 16;

function isWithinOrEqual(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function boundedStderr(value) {
  const text = String(value ?? "").trim();
  return text ? ` stderr: ${text.slice(-2_000)}` : "";
}

function defaultSleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function assertOwnedReadonlyMount({ temporaryRoot, mountPoint, readonlyMount }) {
  if (!readonlyMount) throw new Error("Refusing to force-detach a mount that was not created readonly.");
  if (lstatSync(temporaryRoot).isSymbolicLink()) throw new Error("Temporary root for installer mount must not be a symbolic link.");
  const root = realpathSync(temporaryRoot);
  const candidate = path.resolve(mountPoint);
  if (!isWithinOrEqual(root, candidate) || candidate === root) {
    throw new Error("Installer mount point must be inside the owned temporary root.");
  }
  const parent = realpathSync(path.dirname(candidate));
  if (!isWithinOrEqual(root, parent)) {
    throw new Error("Installer mount point parent escapes the owned temporary root.");
  }
}

/**
 * Detach a DMG only when the caller created a readonly mount below its own
 * temporary root. Exit 16 is the documented busy case; all other failures
 * fail closed. Force is reserved for a final owned readonly cleanup attempt.
 */
export function detachOwnedReadonlyVolume({
  temporaryRoot,
  mountPoint,
  readonlyMount,
  runCommand,
  retries = 3,
  sleep = defaultSleep,
}) {
  assertOwnedReadonlyMount({ temporaryRoot, mountPoint, readonlyMount });
  if (!Number.isInteger(retries) || retries < 1 || retries > 3) {
    throw new Error("Installer volume detach retries must be between 1 and 3.");
  }
  let lastResult = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const result = runCommand("hdiutil", ["detach", "-quiet", mountPoint]);
    if (!result.error && result.status === 0) return { attempts: attempt, forced: false };
    if (result.status !== BUSY_EXIT_STATUS) {
      throw new Error(`Installer volume detach failed with exit ${String(result.status)}.${boundedStderr(result.stderr)}`);
    }
    lastResult = result;
    if (attempt < retries) sleep(200);
  }
  const forced = runCommand("hdiutil", ["detach", "-quiet", "-force", mountPoint]);
  if (!forced.error && forced.status === 0) return { attempts: retries + 1, forced: true };
  if (forced.status === BUSY_EXIT_STATUS) {
    throw new Error(`Installer volume remained busy after ${retries} detach attempts and an owned readonly force-detach.${boundedStderr(forced.stderr ?? lastResult?.stderr)}`);
  }
  throw new Error(`Installer volume force-detach failed with exit ${String(forced.status)}.${boundedStderr(forced.stderr)}`);
}

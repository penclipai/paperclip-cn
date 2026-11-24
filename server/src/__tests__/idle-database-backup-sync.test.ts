import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearIdleBackupWakeRequired, idleBackupWakeMarker, markIdleBackupWakeRequired, verifyIdleDatabaseBackup } from "../services/idle-database-backup.js";

const temporaryMarkerPattern = /^\.idle-backup-wake-required\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i;
const temporaryMarkerFailurePattern = /^injected \.idle-backup-wake-required\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp fsync failure$/i;
const supportsDirectoryFsync = process.platform !== "win32";
const directorySyncEvents = supportsDirectoryFsync ? ["directory"] : [];
const archiveSyncFailureBoundaries = supportsDirectoryFsync
  ? ["checkpoint.sql.gz", "directory"]
  : ["checkpoint.sql.gz"];
const markerSyncFailureBoundaries = supportsDirectoryFsync
  ? ["temporary marker", "directory"] as const
  : ["temporary marker"] as const;
const syncs = vi.hoisted(() => ({ events: [] as string[], fail: "" as string | RegExp }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args);
    const name = (await handle.stat()).isDirectory() ? "directory" : path.basename(String(args[0]));
    const sync = handle.sync.bind(handle);
    handle.sync = async () => {
      syncs.events.push(name);
      const failureTarget = typeof syncs.fail === "string" ? name : path.resolve(String(args[0]));
      if ((typeof syncs.fail === "string" ? syncs.fail === failureTarget : syncs.fail.test(failureTarget))) {
        throw new Error(`injected ${name} fsync failure`);
      }
      await sync();
    };
    return handle;
  } };
});
let directory: string;
function temporaryMarkerPathPattern(directory: string): RegExp {
  const escapedDirectory = path.resolve(directory).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^${escapedDirectory}[\\\\/]\\.idle-backup-wake-required\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.tmp$`,
    "i",
  );
}
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "backup-sync-")); syncs.events = []; syncs.fail = ""; });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
describe("idle checkpoint persistence barriers", () => {
  it("syncs the marker, archive and directory entries before reporting completion", async () => {
    await markIdleBackupWakeRequired(directory);
    expect(syncs.events).toEqual([expect.stringMatching(temporaryMarkerPattern), ...directorySyncEvents]);
    const archive = path.join(directory, "checkpoint.sql.gz"); await writeFile(archive, gzipSync("SELECT 1;"));
    await verifyIdleDatabaseBackup(archive);
    expect(syncs.events.slice(-(1 + directorySyncEvents.length))).toEqual(["checkpoint.sql.gz", ...directorySyncEvents]);
    const syncCountBeforeClear = syncs.events.length;
    await clearIdleBackupWakeRequired(directory);
    if (supportsDirectoryFsync) expect(syncs.events.at(-1)).toBe("directory");
    else expect(syncs.events).toHaveLength(syncCountBeforeClear);
    await expect(readFile(idleBackupWakeMarker(directory))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(archiveSyncFailureBoundaries)("rejects %s fsync failure and retains the wake obligation", async boundary => {
    await markIdleBackupWakeRequired(directory);
    const archive = path.join(directory, "checkpoint.sql.gz"); await writeFile(archive, gzipSync("SELECT 1;"));
    syncs.fail = boundary;
    await expect(verifyIdleDatabaseBackup(archive)).rejects.toThrow(`injected ${boundary} fsync failure`);
    expect(await readFile(idleBackupWakeMarker(directory), "utf8")).toContain("restarts");
  });
  it.each(markerSyncFailureBoundaries)("rejects marker %s fsync failure", async boundary => {
    const isTemporaryMarker = boundary === "temporary marker";
    syncs.fail = isTemporaryMarker ? temporaryMarkerPathPattern(directory) : boundary;
    const errorPattern = isTemporaryMarker ? temporaryMarkerFailurePattern : /^injected directory fsync failure$/;
    await expect(markIdleBackupWakeRequired(directory)).rejects.toThrow(errorPattern);
  });
});

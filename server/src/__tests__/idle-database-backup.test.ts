import { mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearIdleBackupWakeRequired, idleBackupWakeMarker, markIdleBackupWakeRequired, verifyIdleDatabaseBackup } from "../services/idle-database-backup.js";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "idle-backup-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("idle database backup persistence", () => {
  it("keeps a restart marker until a fresh valid backup is complete", async () => {
    const archive = path.join(directory, "backup.sql.gz");
    await markIdleBackupWakeRequired(directory);
    await writeFile(archive, gzipSync("CREATE TABLE fixture (id integer);\n"));
    await verifyIdleDatabaseBackup(archive);
    // Verification on the sleep path must not remove the wake obligation.
    expect(await readFile(idleBackupWakeMarker(directory), "utf8")).toContain("restarts");
    await clearIdleBackupWakeRequired(directory);
    await expect(readFile(idleBackupWakeMarker(directory))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(archive)).toEqual(gzipSync("CREATE TABLE fixture (id integer);\n"));
  });

  it.each([
    ["empty file", Buffer.alloc(0)], ["empty SQL", gzipSync("")],
    ["truncated gzip", gzipSync("SELECT 1;").subarray(0, -4)],
    ["plain text", Buffer.from("SELECT 1;")],
  ])("rejects %s and retains the restart obligation", async (_label, contents) => {
    await markIdleBackupWakeRequired(directory);
    const archive = path.join(directory, "invalid.sql.gz");
    await writeFile(archive, contents);
    await expect(verifyIdleDatabaseBackup(archive)).rejects.toThrow();
    expect(await readFile(idleBackupWakeMarker(directory), "utf8")).toContain("restarts");
  });

  it("rejects a missing archive and symlinked archive or marker", async () => {
    const archive = path.join(directory, "backup.sql.gz");
    await expect(verifyIdleDatabaseBackup(archive)).rejects.toThrow();
    const target = path.join(directory, "target");
    await writeFile(target, gzipSync("SELECT 1;"));
    await symlink(target, archive);
    await expect(verifyIdleDatabaseBackup(archive)).rejects.toThrow();
    await symlink(target, idleBackupWakeMarker(directory));
    await expect(markIdleBackupWakeRequired(directory)).rejects.toThrow();
    expect(await readFile(target)).toEqual(gzipSync("SELECT 1;"));
  });

  it("replaces a marker symlink at the leaf without writing through it", async () => {
    const target = path.join(directory, "target");
    const staged = path.join(directory, "staged-marker");
    const marker = idleBackupWakeMarker(directory);
    await writeFile(target, gzipSync("SELECT 1;"));
    await writeFile(staged, "Take a fresh database backup after this process restarts.\n");
    await symlink(target, marker);

    await rename(staged, marker);

    expect(await readFile(target)).toEqual(gzipSync("SELECT 1;"));
    expect(await readFile(marker, "utf8")).toContain("restarts");
  });

  it("rejects an archive replaced after its identity is inspected", async () => {
    const archive = path.join(directory, "backup.sql.gz");
    const replacement = path.join(directory, "replacement.sql.gz");
    await writeFile(archive, gzipSync("SELECT 'original';"));
    await writeFile(replacement, gzipSync("SELECT 'replacement';"));

    vi.resetModules();
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let swapped = false;
    vi.doMock("node:fs/promises", () => ({
      ...actualFs,
      open: async (...args: Parameters<typeof actualFs.open>) => {
        if (!swapped && args[0] === archive) {
          swapped = true;
          await rename(replacement, archive);
        }
        return await actualFs.open(...args);
      },
    }));
    try {
      const { verifyIdleDatabaseBackup: verifyWithSwap } = await import("../services/idle-database-backup.js");
      await expect(verifyWithSwap(archive)).rejects.toThrow("changed during verification");
      expect(swapped).toBe(true);
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
    }
  });
});

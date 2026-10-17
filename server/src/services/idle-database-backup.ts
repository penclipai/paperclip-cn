import { constants, createReadStream } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

// The marker survives process replacement on persistent instance storage.
// It contains no credentials or tenant data, and never substitutes for a dump.
export const idleBackupWakeMarker = (directory: string) => path.join(directory, ".idle-backup-wake-required");

async function syncDirectory(directory: string): Promise<void> {
  // Windows cannot fsync a directory handle. File handles below are still
  // synced before the backup checkpoint may authorize idle shutdown.
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function assertNotSymlink(file: string, label: string): Promise<void> {
  const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (info?.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`);
}

type FileIdentity = { dev: bigint; ino: bigint; birthtimeNs: bigint };

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs;
}

async function readBackupArchiveIdentity(backupFile: string): Promise<FileIdentity & { isFile(): boolean; size: bigint }> {
  const info = await lstat(backupFile, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Idle backup archive must be a regular file, not a symbolic link");
  return info;
}

export async function markIdleBackupWakeRequired(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const markerPath = idleBackupWakeMarker(directory);
  // O_NOFOLLOW is ignored by Windows file opens, so reject an existing
  // reparse link before publishing a replacement marker.
  await assertNotSymlink(markerPath, "Idle backup wake marker");
  const temporaryMarkerPath = path.join(directory, `.idle-backup-wake-required.${randomUUID()}.tmp`);
  let published = false;
  try {
    // O_EXCL makes the leaf creation safe on Windows even though its
    // O_NOFOLLOW flag is ineffective there. rename then replaces only the
    // marker leaf if it was swapped after the check; it never writes through it.
    const marker = await open(
      temporaryMarkerPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await marker.writeFile("Take a fresh database backup after this process restarts.\n");
      await marker.sync();
    } finally { await marker.close(); }
    await rename(temporaryMarkerPath, markerPath);
    published = true;
  } finally {
    if (!published) {
      await unlink(temporaryMarkerPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  await syncDirectory(directory);
}

/** Read the entire archive to verify the gzip trailer, then persist its bytes
 * and directory entry before allowing compute to stop. The backup runner
 * retains its in-flight receipt until this function settles. */
export async function verifyIdleDatabaseBackup(backupFile: string): Promise<void> {
  // Bind the path to one descriptor before verification. O_NOFOLLOW is
  // ignored on Windows, so lstat identity checks also reject a swapped link
  // or replacement archive before this function certifies persistence.
  const pathBefore = await readBackupArchiveIdentity(backupFile);
  // Windows only permits fsync on a writable descriptor. This does not mutate
  // the archive, but keeps the file-sync durability gate active on every OS.
  const handle = await open(backupFile, (process.platform === "win32" ? constants.O_RDWR : constants.O_RDONLY) | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile() || stat.size === 0n || !sameFileIdentity(pathBefore, stat)) {
      throw new Error("Idle backup archive changed during verification");
    }
    let bytes = 0;
    await pipeline(
      createReadStream(backupFile, { fd: handle.fd, autoClose: false }),
      createGunzip(),
      new Writable({ write(chunk, _encoding, done) { bytes += chunk.length; done(); } }),
    );
    if (bytes === 0) throw new Error("Idle backup archive contains no SQL");
    await handle.sync();
    const pathAfter = await readBackupArchiveIdentity(backupFile);
    if (!sameFileIdentity(pathBefore, await handle.stat({ bigint: true })) || !sameFileIdentity(pathBefore, pathAfter)) {
      throw new Error("Idle backup archive changed during verification");
    }
  } finally { await handle.close(); }
  await syncDirectory(path.dirname(backupFile));
}

export async function clearIdleBackupWakeRequired(directory: string): Promise<void> {
  await unlink(idleBackupWakeMarker(directory)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await syncDirectory(directory);
}

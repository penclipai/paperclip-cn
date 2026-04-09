import fs from "node:fs";
import { resolveDefaultBackupDir, resolveDefaultEmbeddedPostgresDir, resolveDefaultLogsDir, resolveDefaultSecretsKeyFilePath, resolveDefaultStorageDir, resolveHomeAwarePath } from "./home-paths.js";
import { paperclipConfigSchema, type PaperclipConfig } from "@penclipai/shared";
import { resolvePaperclipConfigPath } from "./paths.js";

const DESKTOP_TEMP_INSTANCE_PATH_RE = /paperclip-desktop-(?:smoke|acceptance)-/i;

function isBrokenDesktopTempPath(value: unknown): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  const resolved = resolveHomeAwarePath(value);
  return DESKTOP_TEMP_INSTANCE_PATH_RE.test(resolved) && !fs.existsSync(resolved);
}

function repairBrokenDesktopTempPaths(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return raw;
  }

  const next = structuredClone(raw as Record<string, unknown>);
  const database = typeof next.database === "object" && next.database !== null && !Array.isArray(next.database)
    ? (next.database as Record<string, unknown>)
    : null;
  const logging = typeof next.logging === "object" && next.logging !== null && !Array.isArray(next.logging)
    ? (next.logging as Record<string, unknown>)
    : null;
  const storage = typeof next.storage === "object" && next.storage !== null && !Array.isArray(next.storage)
    ? (next.storage as Record<string, unknown>)
    : null;
  const storageLocalDisk =
    typeof storage?.localDisk === "object" && storage.localDisk !== null && !Array.isArray(storage.localDisk)
      ? (storage.localDisk as Record<string, unknown>)
      : null;
  const secrets = typeof next.secrets === "object" && next.secrets !== null && !Array.isArray(next.secrets)
    ? (next.secrets as Record<string, unknown>)
    : null;
  const localEncrypted =
    typeof secrets?.localEncrypted === "object" && secrets.localEncrypted !== null && !Array.isArray(secrets.localEncrypted)
      ? (secrets.localEncrypted as Record<string, unknown>)
      : null;
  const backup =
    typeof database?.backup === "object" && database.backup !== null && !Array.isArray(database.backup)
      ? (database.backup as Record<string, unknown>)
      : null;

  if (database && isBrokenDesktopTempPath(database.embeddedPostgresDataDir)) {
    database.embeddedPostgresDataDir = resolveDefaultEmbeddedPostgresDir();
  }
  if (backup && isBrokenDesktopTempPath(backup.dir)) {
    backup.dir = resolveDefaultBackupDir();
  }
  if (logging && isBrokenDesktopTempPath(logging.logDir)) {
    logging.logDir = resolveDefaultLogsDir();
  }
  if (storageLocalDisk && isBrokenDesktopTempPath(storageLocalDisk.baseDir)) {
    storageLocalDisk.baseDir = resolveDefaultStorageDir();
  }
  if (localEncrypted && isBrokenDesktopTempPath(localEncrypted.keyFilePath)) {
    localEncrypted.keyFilePath = resolveDefaultSecretsKeyFilePath();
  }

  return next;
}

export function readConfigFile(): PaperclipConfig | null {
  const configPath = resolvePaperclipConfigPath();

  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return paperclipConfigSchema.parse(repairBrokenDesktopTempPaths(raw));
  } catch {
    return null;
  }
}

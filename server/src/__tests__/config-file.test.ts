import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readConfigFile } from "../config-file.js";

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_ENV = { ...process.env };

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("readConfigFile", () => {
  it("repairs broken desktop temp path fields without discarding the rest of the repo-local config", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-config-file-"));
    const projectDir = path.join(tempDir, "repo");
    fs.mkdirSync(projectDir, { recursive: true });
    process.chdir(projectDir);
    delete process.env.PAPERCLIP_CONFIG;
    delete process.env.PAPERCLIP_HOME;

    writeJson(path.join(projectDir, ".paperclip", "config.json"), {
      $meta: {
        version: 1,
        updatedAt: "2026-04-09T00:00:00.000Z",
        source: "configure",
      },
      database: {
        mode: "embedded-postgres",
        embeddedPostgresDataDir: "C:\\Users\\chenj\\AppData\\Local\\Temp\\paperclip-desktop-smoke-dev-light-aur69x\\runtime\\instances\\default\\db",
        embeddedPostgresPort: 54331,
        backup: {
          enabled: true,
          intervalMinutes: 120,
          retentionDays: 14,
          dir: "C:\\Users\\chenj\\AppData\\Local\\Temp\\paperclip-desktop-smoke-dev-light-aur69x\\runtime\\instances\\default\\data\\backups",
        },
      },
      logging: {
        mode: "file",
        logDir: "C:\\Users\\chenj\\AppData\\Local\\Temp\\paperclip-desktop-smoke-dev-light-aur69x\\runtime\\instances\\default\\logs",
      },
      server: {
        deploymentMode: "local_trusted",
        exposure: "private",
        host: "127.0.0.1",
        port: 3900,
        allowedHostnames: ["localhost"],
        serveUi: true,
      },
      storage: {
        provider: "local_disk",
        localDisk: {
          baseDir: "C:\\Users\\chenj\\AppData\\Local\\Temp\\paperclip-desktop-smoke-dev-light-aur69x\\runtime\\instances\\default\\data\\storage",
        },
        s3: {
          bucket: "paperclip",
          region: "us-east-1",
          prefix: "",
          forcePathStyle: false,
        },
      },
      secrets: {
        provider: "local_encrypted",
        strictMode: false,
        localEncrypted: {
          keyFilePath: "C:\\Users\\chenj\\AppData\\Local\\Temp\\paperclip-desktop-smoke-dev-light-aur69x\\runtime\\instances\\default\\secrets\\master.key",
        },
      },
      telemetry: { enabled: true },
      auth: {
        baseUrlMode: "auto",
        disableSignUp: false,
      },
    });

    const config = readConfigFile();

    expect(config).not.toBeNull();
    expect(config?.server.port).toBe(3900);
    expect(config?.database.embeddedPostgresPort).toBe(54331);
    expect(config?.database.embeddedPostgresDataDir).toBe(
      path.resolve(os.homedir(), ".paperclip", "instances", "default", "db"),
    );
    expect(config?.database.backup.dir).toBe(
      path.resolve(os.homedir(), ".paperclip", "instances", "default", "data", "backups"),
    );
    expect(config?.logging.logDir).toBe(
      path.resolve(os.homedir(), ".paperclip", "instances", "default", "logs"),
    );
    expect(config?.storage.localDisk.baseDir).toBe(
      path.resolve(os.homedir(), ".paperclip", "instances", "default", "data", "storage"),
    );
    expect(config?.secrets.localEncrypted.keyFilePath).toBe(
      path.resolve(os.homedir(), ".paperclip", "instances", "default", "secrets", "master.key"),
    );
  });
});

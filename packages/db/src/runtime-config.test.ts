import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDatabaseTarget } from "./runtime-config.js";

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_ENV = { ...process.env };

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeText(filePath: string, value: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
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

describe("resolveDatabaseTarget", () => {
  it("uses DATABASE_URL from process env first", () => {
    process.env.DATABASE_URL = "postgres://env-user:env-pass@db.example.com:5432/paperclip";

    const target = resolveDatabaseTarget();

    expect(target).toMatchObject({
      mode: "postgres",
      connectionString: "postgres://env-user:env-pass@db.example.com:5432/paperclip",
      source: "DATABASE_URL",
    });
  });

  it("uses DATABASE_URL from repo-local .paperclip/.env", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-db-runtime-"));
    const projectDir = path.join(tempDir, "repo");
    fs.mkdirSync(projectDir, { recursive: true });
    process.chdir(projectDir);
    delete process.env.PAPERCLIP_CONFIG;
    writeJson(path.join(projectDir, ".paperclip", "config.json"), {
      database: { mode: "embedded-postgres", embeddedPostgresPort: 54329 },
    });
    writeText(
      path.join(projectDir, ".paperclip", ".env"),
      'DATABASE_URL="postgres://file-user:file-pass@db.example.com:6543/paperclip"\n',
    );

    const target = resolveDatabaseTarget();

    expect(target).toMatchObject({
      mode: "postgres",
      connectionString: "postgres://file-user:file-pass@db.example.com:6543/paperclip",
      source: "paperclip-env",
    });
  });

  it("uses config postgres connection string when configured", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-db-runtime-"));
    const configPath = path.join(tempDir, "instance", "config.json");
    process.env.PAPERCLIP_CONFIG = configPath;
    writeJson(configPath, {
      database: {
        mode: "postgres",
        connectionString: "postgres://cfg-user:cfg-pass@db.example.com:5432/paperclip",
      },
    });

    const target = resolveDatabaseTarget();

    expect(target).toMatchObject({
      mode: "postgres",
      connectionString: "postgres://cfg-user:cfg-pass@db.example.com:5432/paperclip",
      source: "config.database.connectionString",
    });
  });

  it("falls back to embedded postgres settings from config", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-db-runtime-"));
    const configPath = path.join(tempDir, "instance", "config.json");
    process.env.PAPERCLIP_CONFIG = configPath;
    writeJson(configPath, {
      database: {
        mode: "embedded-postgres",
        embeddedPostgresDataDir: "~/paperclip-test-db",
        embeddedPostgresPort: 55444,
      },
    });

    const target = resolveDatabaseTarget();

    expect(target).toMatchObject({
      mode: "embedded-postgres",
      dataDir: path.resolve(os.homedir(), "paperclip-test-db"),
      port: 55444,
      source: "embedded-postgres@55444",
    });
  });

  it("ignores deleted desktop smoke PAPERCLIP_HOME values", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-db-runtime-"));
    const projectDir = path.join(tempDir, "repo");
    fs.mkdirSync(projectDir, { recursive: true });
    process.chdir(projectDir);
    delete process.env.PAPERCLIP_CONFIG;
    process.env.PAPERCLIP_HOME = "C:\\Users\\chenj\\AppData\\Local\\Temp\\paperclip-desktop-smoke-dev-light-aur69x\\runtime";
    writeJson(path.join(projectDir, ".paperclip", "config.json"), {
      database: {
        mode: "embedded-postgres",
        embeddedPostgresDataDir: "~/project-db",
        embeddedPostgresPort: 54331,
      },
    });

    const target = resolveDatabaseTarget();

    expect(target).toMatchObject({
      mode: "embedded-postgres",
      dataDir: path.resolve(os.homedir(), "project-db"),
      port: 54331,
      source: "embedded-postgres@54331",
    });
  });

  it("preserves a fresh desktop temp PAPERCLIP_HOME inside the active desktop user-data dir", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-db-runtime-"));
    const projectDir = path.join(tempDir, "repo");
    fs.mkdirSync(projectDir, { recursive: true });
    process.chdir(projectDir);
    delete process.env.PAPERCLIP_CONFIG;
    delete process.env.PAPERCLIP_INSTANCE_ID;
    const userDataDir = path.join(os.tmpdir(), "paperclip-desktop-acceptance-dark-12345");
    const runtimeDir = path.join(userDataDir, "runtime");
    process.env.PAPERCLIP_DESKTOP_USER_DATA_DIR = userDataDir;
    process.env.PAPERCLIP_HOME = runtimeDir;

    const target = resolveDatabaseTarget();

    expect(target).toMatchObject({
      mode: "embedded-postgres",
      dataDir: path.resolve(runtimeDir, "instances", "default", "db"),
      port: 54329,
      source: "embedded-postgres@54329",
    });
  });

  it("repairs a broken repo-local embedded postgres path without discarding the rest of the config", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-db-runtime-"));
    const projectDir = path.join(tempDir, "repo");
    fs.mkdirSync(projectDir, { recursive: true });
    process.chdir(projectDir);
    delete process.env.PAPERCLIP_CONFIG;
    delete process.env.PAPERCLIP_HOME;
    writeJson(path.join(projectDir, ".paperclip", "config.json"), {
      database: {
        mode: "embedded-postgres",
        embeddedPostgresDataDir: "C:\\Users\\chenj\\AppData\\Local\\Temp\\paperclip-desktop-smoke-dev-light-aur69x\\runtime\\instances\\default\\db",
        embeddedPostgresPort: 54331,
      },
    });

    const target = resolveDatabaseTarget();

    expect(target).toMatchObject({
      mode: "embedded-postgres",
      dataDir: path.resolve(os.homedir(), ".paperclip", "instances", "default", "db"),
      port: 54331,
      source: "embedded-postgres@54331",
    });
  });
});

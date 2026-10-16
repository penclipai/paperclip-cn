import fs from "node:fs/promises";
import * as fsSync from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import * as envFile from "@penclipai/shared/env-file";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalAgentJwt, verifyLocalAgentJwt } from "../agent-auth-jwt.js";
import { ensureDesktopAgentJwtSecret } from "../desktop-agent-jwt-secret.js";

const TEMP_PREFIX = "paperclip-desktop-agent-jwt-secret-";
const TEMP_MARKER = ".desktop-agent-jwt-secret-test-owner";
const ORIGINAL_ENV = { ...process.env };

type Fixture = {
  root: string;
  canonicalParent: string;
  marker: string;
  configPath: string;
  envPath: string;
};

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

async function createFixture() {
  const canonicalParent = await fs.realpath(os.tmpdir());
  const root = await fs.realpath(await fs.mkdtemp(path.join(canonicalParent, TEMP_PREFIX)));
  const marker = randomUUID();
  await fs.writeFile(path.join(root, TEMP_MARKER), marker, "utf8");
  const configPath = path.join(root, "instance", "config.json");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  return { root, canonicalParent, marker, configPath, envPath: path.join(path.dirname(configPath), ".env") };
}

async function removeFixture(fixture: Fixture) {
  const root = await fs.realpath(fixture.root);
  const relativeRoot = path.relative(fixture.canonicalParent, root);
  if (!path.isAbsolute(root)
    || path.dirname(root) !== fixture.canonicalParent
    || !root.startsWith(fixture.canonicalParent)
    || path.isAbsolute(relativeRoot)
    || relativeRoot === ".."
    || relativeRoot.startsWith(`..${path.sep}`)
    || !path.basename(root).startsWith(TEMP_PREFIX)) {
    throw new Error("refusing to remove an unowned desktop JWT test fixture");
  }

  const rootStats = await fs.lstat(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("refusing to remove a reparse-point desktop JWT test fixture");
  }

  const markerPath = path.join(root, TEMP_MARKER);
  const markerStats = await fs.lstat(markerPath);
  if (!markerStats.isFile() || markerStats.isSymbolicLink() || await fs.readFile(markerPath, "utf8") !== fixture.marker) {
    throw new Error("refusing to remove a desktop JWT test fixture with an invalid owner marker");
  }
  await fs.rm(root, { recursive: true, force: false });
}

function useDesktopConfig(configPath: string) {
  process.env.PAPERCLIP_DESKTOP_MODE = "packaged";
  process.env.PAPERCLIP_CONFIG = configPath;
  delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
  delete process.env.BETTER_AUTH_SECRET;
}

describe("desktop agent JWT secret", () => {
  const cleanupFixtures: Fixture[] = [];

  beforeEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    restoreEnv();
    vi.restoreAllMocks();
    await Promise.all(cleanupFixtures.splice(0).map(removeFixture));
  });

  it("generates a persisted secret that immediately mints and verifies local-agent JWTs", async () => {
    const fixture = await createFixture();
    cleanupFixtures.push(fixture);
    useDesktopConfig(fixture.configPath);
    await fs.writeFile(fixture.envPath, "# preserve this comment\nOTHER_SETTING=kept\n", "utf8");

    const secret = ensureDesktopAgentJwtSecret();

    expect(secret).toMatch(/^[a-f0-9]{64}$/);
    expect(process.env.PAPERCLIP_AGENT_JWT_SECRET).toBe(secret);
    expect(await fs.readFile(fixture.envPath, "utf8")).toContain("# preserve this comment\nOTHER_SETTING=kept\n");
    expect(await fs.readFile(fixture.envPath, "utf8")).toContain(`PAPERCLIP_AGENT_JWT_SECRET=${JSON.stringify(secret)}`);
    const token = createLocalAgentJwt("agent-1", "company-1", "grok_local", "run-1");
    expect(verifyLocalAgentJwt(token!)).toMatchObject({
      sub: "agent-1",
      company_id: "company-1",
      adapter_type: "grok_local",
      run_id: "run-1",
    });
  });

  it("keeps the persisted secret and env file unchanged on a desktop restart", async () => {
    const fixture = await createFixture();
    cleanupFixtures.push(fixture);
    useDesktopConfig(fixture.configPath);
    const first = ensureDesktopAgentJwtSecret();
    const before = await fs.readFile(fixture.envPath, "utf8");

    delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
    const second = ensureDesktopAgentJwtSecret();

    expect(second).toBe(first);
    expect(await fs.readFile(fixture.envPath, "utf8")).toBe(before);
  });

  it.each([
    ["PAPERCLIP_AGENT_JWT_SECRET", "current-agent-secret"],
    ["BETTER_AUTH_SECRET", "current-better-auth-secret"],
  ] as const)("keeps an existing process %s secret", async (key, value) => {
    const fixture = await createFixture();
    cleanupFixtures.push(fixture);
    useDesktopConfig(fixture.configPath);
    process.env[key] = value;

    expect(ensureDesktopAgentJwtSecret()).toBe(value);
    expect(process.env.PAPERCLIP_AGENT_JWT_SECRET).toBe(value);
    await expect(fs.stat(fixture.envPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["PAPERCLIP_AGENT_JWT_SECRET", "file-agent-secret"],
    ["BETTER_AUTH_SECRET", "file-better-auth-secret"],
  ] as const)("uses an existing persisted %s secret", async (key, value) => {
    const fixture = await createFixture();
    cleanupFixtures.push(fixture);
    useDesktopConfig(fixture.configPath);
    await fs.writeFile(fixture.envPath, `OTHER_SETTING=kept\n${key}=${JSON.stringify(value)}\n`, "utf8");

    expect(ensureDesktopAgentJwtSecret()).toBe(value);
    expect(process.env.PAPERCLIP_AGENT_JWT_SECRET).toBe(value);
    expect(await fs.readFile(fixture.envPath, "utf8")).toBe(`OTHER_SETTING=kept\n${key}=${JSON.stringify(value)}\n`);
  });

  it("generates a secret in development desktop mode", async () => {
    const fixture = await createFixture();
    cleanupFixtures.push(fixture);
    process.env.PAPERCLIP_DESKTOP_MODE = "development";
    process.env.PAPERCLIP_CONFIG = fixture.configPath;
    delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
    delete process.env.BETTER_AUTH_SECRET;

    expect(ensureDesktopAgentJwtSecret()).toMatch(/^[a-f0-9]{64}$/);
    await expect(fs.stat(fixture.envPath)).resolves.toMatchObject({ isFile: expect.any(Function) });
  });

  it.each(["production", undefined] as const)("does not read or write a config env file in %s mode", async (mode) => {
    const fixture = await createFixture();
    cleanupFixtures.push(fixture);
    if (mode === undefined) delete process.env.PAPERCLIP_DESKTOP_MODE;
    else process.env.PAPERCLIP_DESKTOP_MODE = mode;
    process.env.PAPERCLIP_CONFIG = fixture.configPath;
    delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
    delete process.env.BETTER_AUTH_SECRET;

    expect(ensureDesktopAgentJwtSecret()).toBeNull();
    await expect(fs.stat(fixture.envPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed when the adjacent env file cannot be read", async () => {
    const fixture = await createFixture();
    cleanupFixtures.push(fixture);
    const blockedConfigParent = path.join(fixture.root, "blocked-parent");
    await fs.writeFile(blockedConfigParent, "not a directory", "utf8");
    useDesktopConfig(path.join(blockedConfigParent, "config.json"));

    expect(() => ensureDesktopAgentJwtSecret()).toThrow();
    expect(process.env.PAPERCLIP_AGENT_JWT_SECRET).toBeUndefined();
  });

  it("fails closed when persisting a generated secret fails", async () => {
    const fixture = await createFixture();
    cleanupFixtures.push(fixture);
    useDesktopConfig(fixture.configPath);
    const write = vi.spyOn(envFile, "writeEnvFileAtomicallyIfChanged").mockImplementation(() => {
      throw new Error("simulated write failure");
    });

    expect(() => ensureDesktopAgentJwtSecret()).toThrow("simulated write failure");
    expect(process.env.PAPERCLIP_AGENT_JWT_SECRET).toBeUndefined();
    expect(write).toHaveBeenCalledOnce();
    expect(fsSync.existsSync(fixture.envPath)).toBe(false);
  });
});

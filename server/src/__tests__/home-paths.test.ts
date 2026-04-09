import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePaperclipHomeDir } from "../home-paths.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("resolvePaperclipHomeDir", () => {
  it("preserves a fresh desktop temp PAPERCLIP_HOME inside the active desktop user-data dir", () => {
    const userDataDir = path.join(os.tmpdir(), "paperclip-desktop-acceptance-dark-12345");
    const runtimeDir = path.join(userDataDir, "runtime");
    process.env.PAPERCLIP_DESKTOP_USER_DATA_DIR = userDataDir;
    process.env.PAPERCLIP_HOME = runtimeDir;

    expect(resolvePaperclipHomeDir()).toBe(path.resolve(runtimeDir));
  });

  it("still ignores broken inherited desktop temp homes outside the current desktop user-data dir", () => {
    const currentUserDataDir = path.join(os.tmpdir(), "paperclip-desktop-acceptance-dark-12345");
    const staleRuntimeDir = path.join(os.tmpdir(), "paperclip-desktop-smoke-dev-light-stale", "runtime");
    process.env.PAPERCLIP_DESKTOP_USER_DATA_DIR = currentUserDataDir;
    process.env.PAPERCLIP_HOME = staleRuntimeDir;

    expect(resolvePaperclipHomeDir()).toBe(path.resolve(os.homedir(), ".paperclip"));
  });
});

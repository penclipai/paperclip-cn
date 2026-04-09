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
    process.env.PAPERCLIP_DESKTOP_USER_DATA_DIR = "C:\\Users\\chenj\\AppData\\Local\\Temp\\paperclip-desktop-acceptance-dark-12345";
    process.env.PAPERCLIP_HOME = "C:\\Users\\chenj\\AppData\\Local\\Temp\\paperclip-desktop-acceptance-dark-12345\\runtime";

    expect(resolvePaperclipHomeDir()).toBe(
      path.resolve("C:\\Users\\chenj\\AppData\\Local\\Temp\\paperclip-desktop-acceptance-dark-12345\\runtime"),
    );
  });

  it("still ignores broken inherited desktop temp homes outside the current desktop user-data dir", () => {
    process.env.PAPERCLIP_DESKTOP_USER_DATA_DIR = "C:\\Users\\chenj\\AppData\\Local\\Temp\\paperclip-desktop-acceptance-dark-12345";
    process.env.PAPERCLIP_HOME = "C:\\Users\\chenj\\AppData\\Local\\Temp\\paperclip-desktop-smoke-dev-light-stale\\runtime";

    expect(resolvePaperclipHomeDir()).toBe(path.resolve(os.homedir(), ".paperclip"));
  });
});

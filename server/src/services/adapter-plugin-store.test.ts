import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addAdapterPlugin, getDisabledAdapterTypes, getPausedAdapterOverrides, removeAdapterPlugin, setAdapterOverridePaused, setAdapterDisabled } from "./adapter-plugin-store.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "paperclip-adapter-settings-"));
  vi.stubEnv("PAPERCLIP_HOME", home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

it("keeps pause state across a fresh store import without changing legacy disabled settings", async () => {
  writeFileSync(join(home, "adapter-settings.json"), JSON.stringify({ disabledTypes: ["process"] }));
  expect(getPausedAdapterOverrides()).toEqual([]);
  expect(setAdapterOverridePaused("claude_local", true)).toBe(true);
  vi.resetModules();
  const restarted = await import("./adapter-plugin-store.js");
  expect(restarted.getPausedAdapterOverrides()).toEqual(["claude_local"]);
  expect(restarted.getDisabledAdapterTypes()).toEqual(["process"]);
  expect(restarted.setAdapterOverridePaused("claude_local", true)).toBe(false);
  restarted.setAdapterDisabled("codex_local", true);
  expect(restarted.getPausedAdapterOverrides()).toEqual(["claude_local"]);
});

it("removes pause state on uninstall so a later installation starts active", () => {
  const record = { packageName: "custom-adapter", type: "claude_local", installedAt: new Date(0).toISOString() };
  addAdapterPlugin(record);
  setAdapterDisabled("process", true);
  setAdapterOverridePaused(record.type, true);
  expect(removeAdapterPlugin(record.type)).toBe(true);
  addAdapterPlugin(record);
  expect(getPausedAdapterOverrides()).toEqual([]);
  expect(getDisabledAdapterTypes()).toEqual(["process"]);
  expect(JSON.parse(readFileSync(join(home, "adapter-settings.json"), "utf8")).pausedOverrides).toEqual([]);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { collectDesktopLocales } from "./desktop-locales.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("packaged native messages match both reviewed UI catalogs and exclude unrelated text", () => {
  const locales = collectDesktopLocales(repoRoot);
  assert.ok(Object.keys(locales.en).length >= 28);
  assert.deepEqual(Object.keys(locales.en), Object.keys(locales["zh-CN"]));
  for (const [locale, messages] of Object.entries(locales)) {
    const ui = JSON.parse(fs.readFileSync(path.join(repoRoot, "ui/public/locales", locale, "common.json"), "utf8"));
    for (const [key, text] of Object.entries(messages)) {
      assert.ok(key.startsWith("desktop."));
      assert.equal(text, ui[key]);
    }
    assert.equal(messages["common.cancel"], undefined);
  }
});

test("missing, empty, or mismatched native translations stop packaging", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-locale-test-"));
  try {
    const write = (locale, messages) => {
      const dir = path.join(root, "ui/public/locales", locale);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "common.json"), JSON.stringify(messages));
    };
    write("en", { "desktop.test": "Test" });
    write("zh-CN", {});
    assert.throws(() => collectDesktopLocales(root), /Missing desktop messages/);
    write("zh-CN", { "desktop.test": " " });
    assert.throws(() => collectDesktopLocales(root), /Missing desktop messages/);
    write("zh-CN", { "desktop.other": "测试" });
    assert.throws(() => collectDesktopLocales(root), /locale keys differ/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

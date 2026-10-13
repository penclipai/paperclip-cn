import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  buildCatalog,
  checkCatalog,
  englishHash,
  readCatalog,
  reviewKeys,
  sourceRelativePathForKey,
} from "./i18n-catalog.mjs";

function fixture(entries = {}, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "paperclip-i18n-catalog-"));
  for (const [relative, value] of Object.entries(files)) write(root, relative, value);
  for (const [key, entry] of Object.entries(entries)) {
    const relative = sourceRelativePathForKey(key);
    const file = join(root, relative);
    const source = JSON.stringify({ [key]: entry }, null, 2) + "\n";
    if (statOrNull(file)) {
      const prior = JSON.parse(readFileSync(file, "utf8"));
      prior[key] = entry;
      write(root, relative, JSON.stringify(prior, null, 2) + "\n");
    } else write(root, relative, source);
  }
  return root;
}

function write(root, relative, contents) {
  const target = join(root, relative);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, contents, "utf8");
}

function statOrNull(file) {
  try { return statSync(file); } catch { return null; }
}

function entry(en, zh = en, reviewed = englishHash(en)) {
  return { en, "zh-CN": zh, reviewedEnglishHash: reviewed };
}

test("maps semantic and source-text keys to stable source paths", () => {
  assert.equal(sourceRelativePathForKey("common.save"), "ui/locales-src/semantic/domain-common.json");
  assert.equal(sourceRelativePathForKey("scheduleDescription.dayOfMonthOrdinal"), "ui/locales-src/semantic/domain-scheduledescription.json");
  assert.equal(sourceRelativePathForKey("Save changes"), "ui/locales-src/source-text/s.json");
  assert.equal(sourceRelativePathForKey("…"), "ui/locales-src/source-text/other.json");
  assert.equal(englishHash("Save"), "1509f561f2416598629b886ad7d3c05a7e221e4e0675c84bbff4ee6d9e03913d");
});

test("builds sorted common catalogs and check is read-only", async (t) => {
  const root = fixture({
    "Save changes": entry("Save changes", "保存更改"),
    "common.cancel": entry("Cancel", "取消"),
    "common.alpha": entry("Alpha", "阿尔法"),
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = await buildCatalog({ root });
  assert.equal(result.keyCount, 3);
  assert.equal(readFileSync(join(root, "ui/public/locales/en/common.json"), "utf8"), [
    "{", '  "Save changes": "Save changes",', '  "common.alpha": "Alpha",', '  "common.cancel": "Cancel"', "}", "",
  ].join("\n"));
  const output = join(root, "ui/public/locales/en/common.json");
  const original = readFileSync(output, "utf8");
  write(root, "ui/public/locales/en/common.json", original.replace("Alpha", "WRONG"));
  await assert.rejects(checkCatalog({ root }), /out of date/);
  assert.match(readFileSync(output, "utf8"), /WRONG/);
  await buildCatalog({ root });
  await checkCatalog({ root });
});

test("reviews only requested keys while checks still require all entries", async (t) => {
  const root = fixture({ "common.save": entry("Save", "保存", null), "common.cancel": entry("Cancel", "取消", null) });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  await assert.rejects(readCatalog({ root }), /unreviewed/);
  await assert.rejects(reviewKeys({ root, keys: ["missing.key"] }), /does not exist/);
  const reviewed = await reviewKeys({ root, keys: ["common.save"] });
  assert.equal(reviewed.entries.get("common.save").reviewedEnglishHash, englishHash("Save"));
  assert.equal(reviewed.entries.get("common.cancel").reviewedEnglishHash, null);
  await assert.rejects(readCatalog({ root }), /unreviewed/);
  await assert.rejects(buildCatalog({ root }), /unreviewed/);
  await reviewKeys({ root, keys: ["common.cancel"] });
  const catalog = await readCatalog({ root });
  assert.equal(catalog.entries.get("common.save").reviewedEnglishHash, englishHash("Save"));
  assert.equal(catalog.entries.get("common.cancel").reviewedEnglishHash, englishHash("Cancel"));
});

test("CLI accepts pnpm's separator before review keys and rejects irrelevant flags", async (t) => {
  const root = fixture({ "common.save": entry("Save", "保存", null) });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = fileURLToPath(new URL("./i18n-catalog.mjs", import.meta.url));
  execFileSync(process.execPath, [script, "review", "--root", root, "--", "--key", "common.save"], { encoding: "utf8" });
  await readCatalog({ root });
  assert.throws(() => execFileSync(process.execPath, [script, "build", "--root", root, "--key", "common.save"], { encoding: "utf8", stdio: "pipe" }), /build accepts only --root/);
  assert.throws(() => execFileSync(process.execPath, [script, "review", "--root", root, "--artifact-root", "x", "--key", "common.save"], { encoding: "utf8", stdio: "pipe" }), /review does not accept --artifact-root/);
});

test("rejects duplicate JSON keys, cross-file keys, incorrect ownership, and invalid records", async (t) => {
  const duplicate = fixture({}, {
    "ui/locales-src/semantic/domain-common.json": '{\n  "common.save": {"en":"Save","zh-CN":"保存","reviewedEnglishHash":"x"},\n  "common.s\\u0061ve": {"en":"Save","zh-CN":"保存","reviewedEnglishHash":"x"}\n}\n',
  });
  const nestedDuplicate = fixture({}, {
    "ui/locales-src/semantic/domain-common.json": '{\n  "common.save": {"en":"Save","en":"Save","zh-CN":"保存","reviewedEnglishHash":"x"}\n}\n',
  });
  const cross = fixture({}, {
    "ui/locales-src/semantic/domain-common.json": JSON.stringify({ "common.save": entry("Save", "保存") }, null, 2),
    "ui/locales-src/source-text/s.json": JSON.stringify({ "common.save": entry("Save", "保存") }, null, 2),
  });
  const ownership = fixture({}, {
    "ui/locales-src/source-text/s.json": JSON.stringify({ "common.save": entry("Save", "保存") }, null, 2),
  });
  const invalid = fixture({ "common.save": { en: "Save", "zh-CN": "保存" } });
  const invalidHash = fixture({ "common.save": { ...entry("Save", "保存"), reviewedEnglishHash: "not-a-hash" } });
  t.after(() => [duplicate, nestedDuplicate, cross, ownership, invalid, invalidHash].forEach((root) => rmSync(root, { recursive: true, force: true })));
  await assert.rejects(readCatalog({ root: duplicate, requireReviewed: false }), /duplicate JSON key/);
  await assert.rejects(readCatalog({ root: nestedDuplicate, requireReviewed: false }), /duplicate JSON key "en"/);
  await assert.rejects(readCatalog({ root: cross, requireReviewed: false }), /duplicate catalog key/);
  await assert.rejects(readCatalog({ root: ownership, requireReviewed: false }), /must be stored/);
  await assert.rejects(readCatalog({ root: invalid, requireReviewed: false }), /reviewedEnglishHash/);
  await assert.rejects(readCatalog({ root: invalidHash, requireReviewed: false }), /SHA-256/);
});

test("preserves arbitrary flat keys without prototype pollution", async (t) => {
  const root = fixture({}, {
    "ui/locales-src/source-text/p.json": `{\n  "__proto__": ${JSON.stringify(entry("Prototype", "原型"))}\n}\n`,
    "ui/locales-src/source-text/c.json": JSON.stringify({ constructor: entry("Constructor", "构造函数") }, null, 2),
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const catalog = await readCatalog({ root });
  assert.equal(Object.getPrototypeOf(catalog.dictionaries.en), null);
  assert.equal(catalog.dictionaries.en["__proto__"], "Prototype");
  assert.equal(catalog.dictionaries.en.constructor, "Constructor");
  await buildCatalog({ root });
  assert.match(readFileSync(join(root, "ui/public/locales/en/common.json"), "utf8"), /"__proto__": "Prototype"/);
});

test("validates interpolation contracts including the single approved exception", async (t) => {
  const allowed = fixture({
    "scheduleDescription.dayOfMonthOrdinal": entry("Day {{ordinal}}", "第 {{count}} 天"),
    "common.hello": entry("Hi {{name}}", "你好 {{name}}"),
  });
  const rejected = fixture({ "common.hello": entry("Hi {{name}}", "你好 {{person}}") });
  const wrongException = fixture({ "scheduleDescription.dayOfMonthOrdinal": entry("Day {{ordinal}}", "第 {{ordinal}} 天") });
  t.after(() => [allowed, rejected, wrongException].forEach((root) => rmSync(root, { recursive: true, force: true })));
  await readCatalog({ root: allowed });
  await assert.rejects(readCatalog({ root: rejected }), /placeholder/);
  await assert.rejects(readCatalog({ root: wrongException }), /approved placeholder exception/);
});

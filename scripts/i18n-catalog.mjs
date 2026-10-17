import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const SOURCE_ROOT = ["ui", "locales-src"];
const DEFAULT_ARTIFACT_ROOT = ["ui", "public", "locales"];
const SEMANTIC_KEY = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_-]+)+$/;
const ORDINAL_KEY = "scheduleDescription.dayOfMonthOrdinal";

export function englishHash(en) {
  return createHash("sha256").update(en, "utf8").digest("hex");
}

export function sourceRelativePathForKey(key) {
  if (SEMANTIC_KEY.test(key)) return `ui/locales-src/semantic/domain-${key.slice(0, key.indexOf(".")).toLowerCase()}.json`;
  const first = [...key].find((character) => /[A-Za-z]/.test(character));
  return `ui/locales-src/source-text/${first ? first.toLowerCase() : "other"}.json`;
}

function compareOrdinal(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function isPlainObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function resolved(root, value) { return path.isAbsolute(value) ? value : path.join(root, value); }
function repoRelative(root, file) { return path.relative(root, file).split(path.sep).join("/"); }

function duplicateJsonKeys(text, file) {
  let position = 0;
  const whitespace = () => { while (/\s/.test(text[position] ?? "")) position++; };
  const fail = (message) => { throw new Error(`${repoRelative(process.cwd(), file)}: ${message}`); };
  const string = () => {
    const start = position;
    if (text[position++] !== '"') fail("expected JSON string");
    let escaped = false;
    while (position < text.length) {
      const character = text[position++];
      if (escaped) { escaped = false; continue; }
      if (character === "\\") { escaped = true; continue; }
      if (character === '"') return JSON.parse(text.slice(start, position));
      if (character.charCodeAt(0) < 0x20) fail("invalid JSON string");
    }
    fail("unterminated JSON string");
  };
  const literal = () => {
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(position));
    if (!match) fail("invalid JSON value");
    position += match[0].length;
  };
  const value = () => {
    whitespace();
    if (text[position] === '"') { string(); return; }
    if (text[position] === "{") { object(); return; }
    if (text[position] === "[") { array(); return; }
    literal();
  };
  const object = () => {
    position++;
    whitespace();
    const keys = new Set();
    if (text[position] === "}") { position++; return; }
    while (true) {
      whitespace();
      const key = string();
      if (keys.has(key)) fail(`duplicate JSON key ${JSON.stringify(key)}`);
      keys.add(key);
      whitespace();
      if (text[position++] !== ":") fail("expected ':' after JSON key");
      value();
      whitespace();
      if (text[position] === "}") { position++; return; }
      if (text[position++] !== ",") fail("expected ',' after JSON object entry");
    }
  };
  const array = () => {
    position++;
    whitespace();
    if (text[position] === "]") { position++; return; }
    while (true) {
      value(); whitespace();
      if (text[position] === "]") { position++; return; }
      if (text[position++] !== ",") fail("expected ',' after JSON array entry");
    }
  };
  whitespace(); value(); whitespace();
  if (position !== text.length) fail("unexpected trailing JSON content");
}

async function listJsonFiles(directory) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error?.code === "ENOENT") throw new Error(`missing catalog source directory: ${directory}`); throw error; }
  const results = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await listJsonFiles(file));
    else if (entry.isFile() && entry.name.endsWith(".json")) results.push(file);
  }
  return results.sort(compareOrdinal);
}

function placeholders(value) {
  const values = [];
  for (const match of value.matchAll(/{{\s*([^{}\s]+)\s*}}/g)) values.push(match[1]);
  return values.sort(compareOrdinal);
}
function sameArray(left, right) { return left.length === right.length && left.every((value, index) => value === right[index]); }

function validateEntry(key, value, file, requireReviewed) {
  if (!isPlainObject(value) || Object.keys(value).length !== 3 || !("en" in value) || !("zh-CN" in value) || !("reviewedEnglishHash" in value)) {
    throw new Error(`${file}: ${JSON.stringify(key)} must contain exactly en, zh-CN, and reviewedEnglishHash`);
  }
  if (typeof value.en !== "string" || typeof value["zh-CN"] !== "string") throw new Error(`${file}: ${JSON.stringify(key)} must provide string en and zh-CN values`);
  if (!(typeof value.reviewedEnglishHash === "string" || value.reviewedEnglishHash === null)) throw new Error(`${file}: ${JSON.stringify(key)} reviewedEnglishHash must be a string or null`);
  if (typeof value.reviewedEnglishHash === "string" && !/^[a-f0-9]{64}$/.test(value.reviewedEnglishHash)) throw new Error(`${file}: ${JSON.stringify(key)} reviewedEnglishHash must be a SHA-256 hex digest`);
  if (requireReviewed && value.reviewedEnglishHash !== englishHash(value.en)) throw new Error(`${file}: ${JSON.stringify(key)} has an unreviewed English value`);
  const en = placeholders(value.en), zh = placeholders(value["zh-CN"]);
  if (key === ORDINAL_KEY) {
    if (!sameArray(en, ["ordinal"]) || !sameArray(zh, ["count"])) throw new Error(`${file}: ${JSON.stringify(key)} must use the approved placeholder exception [ordinal] / [count]`);
  } else if (!sameArray(en, zh)) throw new Error(`${file}: ${JSON.stringify(key)} has mismatched placeholder parameters`);
}

function serialized(dictionary) {
  const keys = Object.keys(dictionary).sort(compareOrdinal);
  if (keys.length === 0) return "{}\n";
  return `{\n${keys.map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(dictionary[key], null, 2).replace(/\n/g, "\n  ")}`).join(",\n")}\n}\n`;
}

export async function readCatalog({ root, requireReviewed = true }) {
  const absoluteRoot = path.resolve(root);
  const sourceDirectory = path.join(absoluteRoot, ...SOURCE_ROOT);
  const files = await listJsonFiles(sourceDirectory);
  const entries = new Map(), keyFiles = new Map(), fileEntries = new Map();
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    duplicateJsonKeys(text, file);
    let object;
    try { object = JSON.parse(text); } catch (error) { throw new Error(`${repoRelative(absoluteRoot, file)}: invalid JSON: ${error.message}`); }
    if (!isPlainObject(object)) throw new Error(`${repoRelative(absoluteRoot, file)}: catalog source must be a JSON object`);
    const relative = repoRelative(absoluteRoot, file);
    const keys = [];
    for (const [key, value] of Object.entries(object)) {
      if (entries.has(key)) throw new Error(`${relative}: duplicate catalog key ${JSON.stringify(key)} also defined in ${keyFiles.get(key)}`);
      if (sourceRelativePathForKey(key) !== relative) throw new Error(`${relative}: ${JSON.stringify(key)} must be stored in ${sourceRelativePathForKey(key)}`);
      validateEntry(key, value, relative, requireReviewed);
      entries.set(key, value); keyFiles.set(key, relative); keys.push(key);
    }
    fileEntries.set(file, keys);
  }
  const dictionaries = { en: Object.create(null), "zh-CN": Object.create(null) };
  for (const [key, value] of entries) { dictionaries.en[key] = value.en; dictionaries["zh-CN"][key] = value["zh-CN"]; }
  return { entries, dictionaries, keyFiles, keyCount: entries.size, sourceFileCount: files.length, fileEntries };
}

function artifactPath(root, artifactRoot, locale) {
  return path.join(resolved(root, artifactRoot ?? path.join(...DEFAULT_ARTIFACT_ROOT)), locale, "common.json");
}

export async function checkCatalog({ root, artifactRoot }) {
  const catalog = await readCatalog({ root });
  for (const locale of ["en", "zh-CN"]) {
    const target = artifactPath(root, artifactRoot, locale);
    let current;
    try { current = await fs.readFile(target, "utf8"); } catch (error) { if (error?.code === "ENOENT") throw new Error(`catalog artifact out of date: missing ${target}`); throw error; }
    if (current !== serialized(catalog.dictionaries[locale])) throw new Error(`catalog artifact out of date: ${target}`);
  }
  return catalog;
}

export async function buildCatalog({ root }) {
  const catalog = await readCatalog({ root });
  for (const locale of ["en", "zh-CN"]) {
    const target = artifactPath(root, undefined, locale), expected = serialized(catalog.dictionaries[locale]);
    let current;
    try { current = await fs.readFile(target, "utf8"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    if (current !== expected) { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, expected, "utf8"); }
  }
  return catalog;
}

export async function reviewKeys({ root, keys }) {
  if (!Array.isArray(keys) || keys.length === 0) throw new Error("review requires at least one --key");
  const catalog = await readCatalog({ root, requireReviewed: false });
  const requested = [...new Set(keys)];
  for (const key of requested) if (!catalog.entries.has(key)) throw new Error(`catalog key does not exist: ${key}`);
  const byFile = new Map();
  for (const key of requested) {
    const relative = catalog.keyFiles.get(key), file = path.join(path.resolve(root), ...relative.split("/"));
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(key);
  }
  for (const [file, fileKeys] of byFile) {
    const source = JSON.parse(await fs.readFile(file, "utf8"));
    for (const key of fileKeys) source[key].reviewedEnglishHash = englishHash(source[key].en);
    await fs.writeFile(file, serialized(source), "utf8");
  }
  return readCatalog({ root, requireReviewed: false });
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!command || !["build", "check", "review"].includes(command)) throw new Error("usage: node scripts/i18n-catalog.mjs build|check|review [--root <root>] [--artifact-root <dir>] [--key <key>]");
  const options = { command, root: process.cwd(), keys: [] };
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (flag === "--") continue;
    const value = rest[++index];
    if (!["--root", "--artifact-root", "--key"].includes(flag) || value === undefined) throw new Error(`invalid argument: ${flag}`);
    if (flag === "--root") options.root = value;
    else if (flag === "--artifact-root") options.artifactRoot = value;
    else options.keys.push(value);
  }
  if (command === "build" && (options.artifactRoot !== undefined || options.keys.length > 0)) throw new Error("build accepts only --root");
  if (command === "check" && options.keys.length > 0) throw new Error("check does not accept --key");
  if (command === "review" && options.artifactRoot !== undefined) throw new Error("review does not accept --artifact-root");
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.command === "build") await buildCatalog(options);
  else if (options.command === "check") await checkCatalog(options);
  else await reviewKeys(options);
}

if (import.meta.main) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

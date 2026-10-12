#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SyntaxKind } from "typescript/unstable/ast";
import * as is from "typescript/unstable/ast/is";

import { withTypeScriptSourceFiles } from "../../../../scripts/typescript-ast-session.mjs";

const DEFAULT_LOCALES = ["en", "zh-CN"];
const DEFAULT_SCAN_DIRS = ["ui/src", "server/src", "packages", "cli/src", "scripts"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const EXCLUDED_DIR_NAMES = new Set([
  ".git",
  ".omx",
  ".stage",
  ".vite",
  "coverage",
  "data",
  "diagnostics",
  "dist",
  "node_modules",
  "playwright-report",
  "release",
  "storybook-static",
  "test-results",
  "tmp",
  "ui-dist",
]);

const TEST_FILE_PATTERN = /(?:^|[/\\])(?:__tests__|tests)(?:[/\\]|$)|(?:\.|-)test\.[cm]?[jt]sx?$|(?:\.|-)spec\.[cm]?[jt]sx?$/i;
const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/;
const LATIN_PATTERN = /[A-Za-z]/;
const I18NEXT_VARIANT_SUFFIX_PATTERN = /_(zero|one|two|few|many|other)$/;

function usage() {
  return `Usage:
  node .agents/skills/paperclip-cn-fork-maintenance/scripts/i18n-key-audit.mjs snapshot --out <file> [--root <repo>] [--include-tests]
  node .agents/skills/paperclip-cn-fork-maintenance/scripts/i18n-key-audit.mjs compare --before <file> --after <file>
`;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command,
    includeTests: false,
    scanDirs: [...DEFAULT_SCAN_DIRS],
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--include-tests") {
      options.includeTests = true;
      continue;
    }
    if (arg === "--scan-dir") {
      const value = rest[++index];
      assert(value, "--scan-dir requires a value");
      options.scanDirs.push(value);
      continue;
    }
    if (arg.startsWith("--")) {
      const value = rest[++index];
      assert(value, `${arg} requires a value`);
      options[arg.slice(2)] = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function normalizePathForOutput(filePath) {
  return filePath.split(path.sep).join("/");
}

function toRepoRelative(repoRoot, filePath) {
  return normalizePathForOutput(path.relative(repoRoot, filePath));
}

function indexToLineColumn(text, index) {
  let line = 1;
  let lineStart = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) {
      line += 1;
      lineStart = cursor + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}

function hashValue(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function flattenCatalog(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? { [prefix]: value } : {};
  }

  const entries = {};
  for (const [key, child] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      Object.assign(entries, flattenCatalog(child, nextPrefix));
    } else {
      entries[nextPrefix] = child;
    }
  }
  return entries;
}

function findDuplicateKeys(text, file, sourceFile) {
  const duplicates = new Map();

  function propertyName(name) {
    if (is.isIdentifier(name) || is.isStringLiteral(name) || is.isNumericLiteral(name)) {
      return name.text;
    }
    return undefined;
  }

  function locationFor(node) {
    return {
      file,
      ...indexToLineColumn(text, node.getStart(sourceFile) + 1),
    };
  }

  function visitObject(node, prefix = "") {
    const seen = new Map();

    for (const property of node.properties) {
      if (!is.isPropertyAssignment(property)) continue;
      const name = propertyName(property.name);
      if (name === undefined) continue;
      const key = prefix ? `${prefix}.${name}` : name;
      const location = locationFor(property.name);

      if (seen.has(name)) {
        if (!duplicates.has(key)) {
          duplicates.set(key, [seen.get(name)]);
        }
        duplicates.get(key).push(location);
      } else {
        seen.set(name, location);
      }
    }

    for (const property of node.properties) {
      if (!is.isPropertyAssignment(property)) continue;
      const name = propertyName(property.name);
      if (name === undefined) continue;
      if (is.isObjectLiteralExpression(property.initializer)) {
        visitObject(property.initializer, prefix ? `${prefix}.${name}` : name);
      }
    }
  }

  const rootStatement = sourceFile.statements.find(is.isExpressionStatement);
  if (rootStatement && is.isObjectLiteralExpression(rootStatement.expression)) {
    visitObject(rootStatement.expression);
  }

  return [...duplicates.entries()].map(([key, locations]) => ({ key, locations }));
}

function localeCatalogFile(repoRoot, locale) {
  return path.join(repoRoot, "ui", "public", "locales", locale, "common.json");
}

function readLocaleCatalog(repoRoot, locale, sourceFile) {
  const absoluteFile = path.join(repoRoot, "ui", "public", "locales", locale, "common.json");
  const file = toRepoRelative(repoRoot, absoluteFile);
  const text = sourceFile.text;
  const duplicates = findDuplicateKeys(text, file, sourceFile).map((duplicate) => ({
    locale,
    key: duplicate.key,
    locations: duplicate.locations,
  }));

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const parseError = new Error(`Invalid JSON in ${file}: ${error.message}`);
    parseError.file = file;
    throw parseError;
  }

  const flattened = flattenCatalog(parsed);
  const definitions = {};
  for (const [key, value] of Object.entries(flattened)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const keyPattern = new RegExp(`^\\s*"${escapedKey}"\\s*:`, "m");
    const match = keyPattern.exec(text);
    const position = match
      ? indexToLineColumn(text, match.index + match[0].indexOf(`"${key}"`) + 1)
      : { line: 1, column: 1 };

    definitions[key] = {
      file,
      line: position.line,
      column: position.column,
      value,
      valueHash: hashValue(String(value)),
    };
  }

  return { locale, file, definitions, duplicates };
}

async function collectSourceFiles(repoRoot, scanDirs, includeTests) {
  const files = [];

  async function walk(absoluteDir) {
    let entries;
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      const absolutePath = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      if (!includeTests && TEST_FILE_PATTERN.test(absolutePath)) continue;
      files.push(absolutePath);
    }
  }

  for (const dir of scanDirs) {
    await walk(path.resolve(repoRoot, dir));
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function calleeName(expression) {
  if (!expression) return undefined;
  if (is.isIdentifier(expression)) return expression.text;
  if (is.isPropertyAccessExpression(expression)) {
    const prefix = calleeName(expression.expression);
    return prefix ? `${prefix}.${expression.name.text}` : expression.name.text;
  }
  return undefined;
}

function isTranslationCallee(name) {
  return name === "t" || name === "td" || name === "translateInstant" || name === "i18n.t" || Boolean(name?.endsWith(".t"));
}

function literalValue(node) {
  if (is.isStringLiteral(node) || is.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function shouldSkipLiteral(node) {
  const parent = node.parent;
  return (
    is.isImportDeclaration(parent) ||
    is.isExportDeclaration(parent) ||
    is.isExternalModuleReference(parent)
  );
}

function usageContext(node) {
  const parent = node.parent;

  if (is.isCallExpression(parent)) {
    const name = calleeName(parent.expression);
    const argIndex = parent.arguments.findIndex((arg) => arg === node);
    return {
      kind: isTranslationCallee(name) && argIndex === 0 ? "translation-call" : "call-argument",
      callee: name,
      argumentIndex: argIndex,
    };
  }

  if (is.isJsxAttribute(parent)) {
    return {
      kind: "jsx-attribute",
      attribute: parent.name.getText(),
    };
  }

  if (is.isPropertyAssignment(parent)) {
    return {
      kind: "property-assignment",
      property: parent.name.getText(),
    };
  }

  if (is.isVariableDeclaration(parent)) {
    return {
      kind: "variable-initializer",
      name: parent.name.getText(),
    };
  }

  return { kind: SyntaxKind[parent.kind] ?? "unknown" };
}

function buildVariantBaseMap(keySet) {
  const map = new Map();
  for (const key of keySet) {
    const base = key.replace(I18NEXT_VARIANT_SUFFIX_PATTERN, "");
    if (base === key) continue;
    if (!map.has(base)) map.set(base, []);
    map.get(base).push(key);
  }

  for (const variants of map.values()) {
    variants.sort((left, right) => left.localeCompare(right));
  }

  return map;
}

function scanSourceFile(repoRoot, absoluteFile, sourceFile, keySet, variantBaseMap) {
  const file = toRepoRelative(repoRoot, absoluteFile);
  const usages = [];
  const dynamicWarnings = [];

  function locationFor(node) {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    return {
      file,
      line: position.line + 1,
      column: position.character + 1,
    };
  }

  function visit(node) {
    const value = literalValue(node);
    if (value !== undefined && !shouldSkipLiteral(node)) {
      const matchedKeys = keySet.has(value)
        ? [value, ...(variantBaseMap.get(value) ?? [])]
        : (variantBaseMap.get(value) ?? []);
      for (const key of matchedKeys) {
        const context = usageContext(node);
        usages.push({
          key,
          ...locationFor(node),
          context: key === value
            ? context
            : { ...context, matchKind: "i18next-variant", matchedFrom: value },
        });
      }
    }

    if (is.isCallExpression(node)) {
      const name = calleeName(node.expression);
      const firstArg = node.arguments[0];
      if (isTranslationCallee(name) && firstArg && literalValue(firstArg) === undefined) {
        dynamicWarnings.push({
          ...locationFor(firstArg),
          callee: name,
          expression: firstArg.getText(sourceFile).slice(0, 160),
        });
      }
    }

    node.forEachChild(visit);
  }

  visit(sourceFile);
  return { usages, dynamicWarnings };
}

function buildKeyRecords(localeResults, usages) {
  const keys = {};

  for (const localeResult of localeResults) {
    for (const [key, definition] of Object.entries(localeResult.definitions)) {
      keys[key] ??= { definitions: {}, usages: [], usageCount: 0, missingLocales: [] };
      keys[key].definitions[localeResult.locale] = definition;
    }
  }

  for (const usage of usages) {
    keys[usage.key] ??= { definitions: {}, usages: [], usageCount: 0, missingLocales: [] };
    keys[usage.key].usages.push({
      file: usage.file,
      line: usage.line,
      column: usage.column,
      context: usage.context,
    });
  }

  for (const key of Object.keys(keys)) {
    keys[key].usageCount = keys[key].usages.length;
    keys[key].missingLocales = DEFAULT_LOCALES.filter((locale) => !keys[key].definitions[locale]);
  }

  return Object.fromEntries(Object.entries(keys).sort(([left], [right]) => left.localeCompare(right)));
}

function computeParity(keys) {
  const missingByLocale = Object.fromEntries(DEFAULT_LOCALES.map((locale) => [locale, []]));

  for (const [key, record] of Object.entries(keys)) {
    for (const locale of record.missingLocales) {
      missingByLocale[locale].push(key);
    }
  }

  for (const locale of DEFAULT_LOCALES) {
    missingByLocale[locale].sort((left, right) => left.localeCompare(right));
  }

  return {
    missingByLocale,
    missingCount: Object.values(missingByLocale).reduce((count, keysForLocale) => count + keysForLocale.length, 0),
  };
}

export async function buildSnapshot({
  root = process.cwd(),
  includeTests = false,
  scanDirs = DEFAULT_SCAN_DIRS,
} = {}) {
  const repoRoot = path.resolve(root);
  const generatedAt = new Date().toISOString();
  const sourceFiles = await collectSourceFiles(repoRoot, scanDirs, includeTests);
  const localeFiles = DEFAULT_LOCALES.map((locale) => localeCatalogFile(repoRoot, locale));
  const { localeResults, usages, dynamicTranslationCallWarnings } = withTypeScriptSourceFiles(
    [...localeFiles, ...sourceFiles],
    (sourceFileFor) => {
      const localeResults = DEFAULT_LOCALES.map((locale, index) =>
        readLocaleCatalog(repoRoot, locale, sourceFileFor(localeFiles[index])),
      );
      const keySet = new Set(localeResults.flatMap((result) => Object.keys(result.definitions)));
      const variantBaseMap = buildVariantBaseMap(keySet);
      const usages = [];
      const dynamicTranslationCallWarnings = [];

      for (const sourceFile of sourceFiles) {
        const result = scanSourceFile(
          repoRoot,
          sourceFile,
          sourceFileFor(sourceFile),
          keySet,
          variantBaseMap,
        );
        usages.push(...result.usages);
        dynamicTranslationCallWarnings.push(...result.dynamicWarnings);
      }

      return { localeResults, usages, dynamicTranslationCallWarnings };
    },
  );

  usages.sort((left, right) =>
    left.key.localeCompare(right.key) ||
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.column - right.column,
  );
  dynamicTranslationCallWarnings.sort((left, right) =>
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.column - right.column,
  );

  const keys = buildKeyRecords(localeResults, usages);
  const duplicates = localeResults.flatMap((result) => result.duplicates);
  const parity = computeParity(keys);
  const unusedKeys = Object.entries(keys)
    .filter(([, record]) => record.usageCount === 0)
    .map(([key]) => key)
    .sort((left, right) => left.localeCompare(right));
  const summary = {
    generatedAt,
    repoRoot: normalizePathForOutput(repoRoot),
    locales: Object.fromEntries(
      localeResults.map((result) => [
        result.locale,
        {
          file: result.file,
          keyCount: Object.keys(result.definitions).length,
          duplicateKeyCount: result.duplicates.length,
        },
      ]),
    ),
    keyCount: Object.keys(keys).length,
    usedKeyCount: Object.values(keys).filter((record) => record.usageCount > 0).length,
    unusedKeyCount: unusedKeys.length,
    usageCount: usages.length,
    scannedFileCount: sourceFiles.length,
    duplicateKeyCount: duplicates.length,
    missingTranslationCount: parity.missingCount,
    dynamicTranslationCallWarningCount: dynamicTranslationCallWarnings.length,
    includeTests,
  };

  return {
    version: 1,
    summary,
    keys,
    definitions: Object.fromEntries(localeResults.map((result) => [result.locale, result.definitions])),
    usages,
    unusedKeys,
    duplicates,
    parity,
    dynamicTranslationCallWarnings,
  };
}

function definitionValue(snapshot, key, locale) {
  return snapshot.keys?.[key]?.definitions?.[locale]?.value;
}

function hasDefinition(snapshot, key, locale) {
  return Object.prototype.hasOwnProperty.call(snapshot.keys?.[key]?.definitions ?? {}, locale);
}

function allKeys(snapshot) {
  return new Set(Object.keys(snapshot.keys ?? {}));
}

function isLikelyEnglishFallback(value) {
  return typeof value === "string" && !CJK_PATTERN.test(value) && LATIN_PATTERN.test(value);
}

export function compareSnapshots(before, after) {
  const beforeKeys = allKeys(before);
  const afterKeys = allKeys(after);
  const removedKeys = [...beforeKeys].filter((key) => !afterKeys.has(key)).sort((left, right) => left.localeCompare(right));
  const addedKeys = [...afterKeys].filter((key) => !beforeKeys.has(key)).sort((left, right) => left.localeCompare(right));
  const removedDefinitions = [];
  const newMissingParity = [];
  const usageChanges = [];
  const changedValues = [];
  const suspiciousZhFallbacks = [];

  for (const key of [...beforeKeys].sort((left, right) => left.localeCompare(right))) {
    for (const locale of DEFAULT_LOCALES) {
      if (hasDefinition(before, key, locale) && !hasDefinition(after, key, locale)) {
        removedDefinitions.push({ key, locale });
      }
    }
  }

  for (const key of [...afterKeys].sort((left, right) => left.localeCompare(right))) {
    for (const locale of DEFAULT_LOCALES) {
      const beforeMissing = !hasDefinition(before, key, locale);
      const afterMissing = !hasDefinition(after, key, locale);
      const existedBefore = beforeKeys.has(key);
      const addedOrRegressed = !existedBefore || !beforeMissing;
      if (afterMissing && addedOrRegressed) {
        newMissingParity.push({ key, locale });
      }
    }

    const beforeUsage = before.keys?.[key]?.usageCount ?? 0;
    const afterUsage = after.keys?.[key]?.usageCount ?? 0;
    if (beforeUsage !== afterUsage) {
      usageChanges.push({ key, before: beforeUsage, after: afterUsage, delta: afterUsage - beforeUsage });
    }

    for (const locale of DEFAULT_LOCALES) {
      if (!hasDefinition(before, key, locale) || !hasDefinition(after, key, locale)) continue;
      const beforeValue = definitionValue(before, key, locale);
      const afterValue = definitionValue(after, key, locale);
      if (beforeValue !== afterValue) {
        changedValues.push({ key, locale, beforeHash: hashValue(String(beforeValue)), afterHash: hashValue(String(afterValue)) });
      }
    }

    const beforeZh = definitionValue(before, key, "zh-CN");
    const afterZh = definitionValue(after, key, "zh-CN");
    const afterEn = definitionValue(after, key, "en");
    if (
      typeof beforeZh === "string" &&
      typeof afterZh === "string" &&
      CJK_PATTERN.test(beforeZh) &&
      isLikelyEnglishFallback(afterZh) &&
      (afterZh === afterEn || !CJK_PATTERN.test(afterZh))
    ) {
      suspiciousZhFallbacks.push({
        key,
        beforeHash: hashValue(beforeZh),
        afterHash: hashValue(afterZh),
        matchesEnglish: afterZh === afterEn,
      });
    }
  }

  const duplicateKeys = after.duplicates ?? [];
  const failures = [
    ...removedKeys.map((key) => ({ type: "removed-key", key })),
    ...removedDefinitions.map((item) => ({ type: "removed-definition", ...item })),
    ...newMissingParity.map((item) => ({ type: "new-missing-parity", ...item })),
    ...duplicateKeys.map((item) => ({ type: "duplicate-key", key: item.key, locale: item.locale })),
    ...suspiciousZhFallbacks.map((item) => ({ type: "suspicious-zh-fallback", key: item.key })),
  ];

  return {
    version: 1,
    summary: {
      beforeGeneratedAt: before.summary?.generatedAt,
      afterGeneratedAt: after.summary?.generatedAt,
      beforeKeyCount: before.summary?.keyCount ?? beforeKeys.size,
      afterKeyCount: after.summary?.keyCount ?? afterKeys.size,
      addedKeyCount: addedKeys.length,
      removedKeyCount: removedKeys.length,
      removedDefinitionCount: removedDefinitions.length,
      newMissingParityCount: newMissingParity.length,
      duplicateKeyCount: duplicateKeys.length,
      suspiciousZhFallbackCount: suspiciousZhFallbacks.length,
      usageChangeCount: usageChanges.length,
      changedValueCount: changedValues.length,
      failureCount: failures.length,
    },
    addedKeys,
    removedKeys,
    removedDefinitions,
    newMissingParity,
    duplicateKeys,
    suspiciousZhFallbacks,
    usageChanges,
    changedValues,
    failures,
  };
}

async function readJsonFile(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function printSnapshotSummary(snapshot, out) {
  const lines = [
    "i18n key snapshot",
    `- output: ${out ?? "stdout"}`,
    `- keys: ${snapshot.summary.keyCount}`,
    `- unused keys: ${snapshot.summary.unusedKeyCount}`,
    `- static usages: ${snapshot.summary.usageCount}`,
    `- scanned files: ${snapshot.summary.scannedFileCount}`,
    `- duplicate keys: ${snapshot.summary.duplicateKeyCount}`,
    `- missing translations: ${snapshot.summary.missingTranslationCount}`,
    `- dynamic translation call warnings: ${snapshot.summary.dynamicTranslationCallWarningCount}`,
  ];
  console.error(lines.join(os.EOL));
}

function printCompareSummary(comparison) {
  const lines = [
    "i18n key snapshot comparison",
    `- before keys: ${comparison.summary.beforeKeyCount}`,
    `- after keys: ${comparison.summary.afterKeyCount}`,
    `- added keys: ${comparison.summary.addedKeyCount}`,
    `- removed keys: ${comparison.summary.removedKeyCount}`,
    `- removed definitions: ${comparison.summary.removedDefinitionCount}`,
    `- new missing parity: ${comparison.summary.newMissingParityCount}`,
    `- duplicate keys: ${comparison.summary.duplicateKeyCount}`,
    `- suspicious zh-CN fallbacks: ${comparison.summary.suspiciousZhFallbackCount}`,
    `- usage changes: ${comparison.summary.usageChangeCount}`,
  ];
  console.error(lines.join(os.EOL));

  for (const failure of comparison.failures.slice(0, 20)) {
    console.error(`FAIL ${failure.type}: ${failure.locale ? `${failure.locale} ` : ""}${failure.key}`);
  }
  if (comparison.failures.length > 20) {
    console.error(`FAIL ... ${comparison.failures.length - 20} more`);
  }
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.command === "snapshot") {
    const snapshot = await buildSnapshot({
      root: options.root ?? process.cwd(),
      includeTests: options.includeTests,
      scanDirs: options.scanDirs,
    });

    if (options.out) {
      await mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
      await writeFile(options.out, `${JSON.stringify(snapshot, null, 2)}\n`);
    } else {
      console.log(JSON.stringify(snapshot, null, 2));
    }

    printSnapshotSummary(snapshot, options.out);
    return snapshot.duplicates.length > 0 ? 1 : 0;
  }

  if (options.command === "compare") {
    assert(options.before, "compare requires --before <file>");
    assert(options.after, "compare requires --after <file>");
    const before = await readJsonFile(options.before);
    const after = await readJsonFile(options.after);
    const comparison = compareSnapshots(before, after);
    if (options.out) {
      await mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
      await writeFile(options.out, `${JSON.stringify(comparison, null, 2)}\n`);
    }
    printCompareSummary(comparison);
    return comparison.failures.length > 0 ? 1 : 0;
  }

  console.error(usage());
  return 2;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  runCli().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}

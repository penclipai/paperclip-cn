#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
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

async function readTranslationCatalog(repoRoot) {
  const definitions = {};
  for (const locale of DEFAULT_LOCALES) {
    const absoluteFile = path.join(repoRoot, "ui", "src", "i18n", "locales", `${locale}.json`);
    try {
      const parsed = JSON.parse(await readFile(absoluteFile, "utf8"));
      Object.assign(definitions, flattenCatalog(parsed));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw new Error(`Invalid JSON in ${toRepoRelative(repoRoot, absoluteFile)}: ${error.message}`);
    }
  }
  return definitions;
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
function usageContext(node, classifyCall) {
  const parent = node.parent;

  if (is.isCallExpression(parent)) {
    const argIndex = parent.arguments.findIndex((arg) => arg === node);
    const candidate = classifyCall(parent);
    const translation = candidate?.keyIndex === argIndex ? candidate : undefined;
    return {
      kind: translation ? "translation-call" : "reference-lead",
      callee: calleeName(parent.expression),
      argumentIndex: argIndex,
      ...(translation ? { catalog: translation.catalog, binding: translation.binding } : {}),
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

function bindingNames(name, names = []) {
  if (!name) return names;
  if (is.isIdentifier(name)) names.push(name.text);
  if (is.isObjectBindingPattern(name) || is.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (element && is.isBindingElement(element)) bindingNames(element.name, names);
    }
  }
  return names;
}

function importedBindingName(specifier) {
  return specifier.propertyName?.text ?? specifier.name.text;
}

function knownI18nModule(moduleName, sourceFile) {
  if (moduleName === "react-i18next") return { kind: "react-hook", catalog: "common" };
  if (moduleName === "i18next") return { kind: "i18next", catalog: "common" };
  if (moduleName === "@/i18n") return { kind: "common", catalog: "common" };
  if (moduleName === "@/i18n/index") return { kind: "legacy", catalog: "translation" };

  if (!moduleName.startsWith(".")) return undefined;
  const base = path.resolve(path.dirname(sourceFile.fileName), moduleName);
  const extension = path.extname(base);
  const candidates = extension
    ? [base, `${base.slice(0, -extension.length)}.ts`, `${base.slice(0, -extension.length)}.tsx`]
    : [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const normalized = normalizePathForOutput(candidate).toLowerCase();
    if (normalized.endsWith("/ui/src/i18n.ts")) return { kind: "common", catalog: "common" };
    if (normalized.endsWith("/ui/src/i18n/index.ts")) return { kind: "legacy", catalog: "translation" };
    if (normalized.endsWith("/server/src/i18n.ts")) return { kind: "server", catalog: "common" };
    if (normalized.endsWith("/server/src/request-localization.ts")) return { kind: "request", catalog: "common" };
  }
  return undefined;
}

function isLexicalScopeBoundary(node) {
  return is.isBlock(node) || Boolean(node.parameters) || [
    SyntaxKind.CaseBlock,
    SyntaxKind.ForStatement,
    SyntaxKind.ForInStatement,
    SyntaxKind.ForOfStatement,
    SyntaxKind.CatchClause,
  ].includes(node.kind);
}

function isVarDeclaration(node, sourceFile) {
  return is.isVariableDeclaration(node) && /^var\b/.test(node.parent?.getText(sourceFile).trimStart() ?? "");
}

function functionOrSourceDeclaresVar(scope, name, sourceFile) {
  let found = false;
  function visit(node, isRoot = false) {
    if (found) return;
    if (!isRoot && node.parameters) return;
    if (isVarDeclaration(node, sourceFile) && bindingNames(node.name).includes(name)) {
      found = true;
      return;
    }
    node.forEachChild((child) => visit(child));
  }
  visit(scope, true);
  return found;
}

function scopeDeclaresName(scope, name, sourceFile) {
  if (scope.parameters?.some((parameter) => bindingNames(parameter.name).includes(name))) return true;
  if ((scope.parameters || scope === sourceFile) && functionOrSourceDeclaresVar(scope, name, sourceFile)) return true;
  let found = false;
  function visit(node, isRoot = false) {
    if (found) return;
    if ((is.isFunctionDeclaration(node) || is.isClassDeclaration(node)) && node.name?.text === name) {
      found = true;
      return;
    }
    if (is.isVariableDeclaration(node) && bindingNames(node.name).includes(name)) {
      found = true;
      return;
    }
    if (is.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause;
      if (clause.name?.text === name) {
        found = true;
        return;
      }
      const named = clause.namedBindings;
      if (named && is.isNamedImports(named) && named.elements.some((element) => element.name.text === name)) {
        found = true;
        return;
      }
    }
    if (!isRoot && isLexicalScopeBoundary(node)) return;
    node.forEachChild((child) => visit(child));
  }
  visit(scope, true);
  return found;
}

function isLexicallyBound(node, name, sourceFile) {
  for (let current = node.parent; current; current = current.parent) {
    if (current === sourceFile || isLexicalScopeBoundary(current)) {
      if (scopeDeclaresName(current, name, sourceFile)) return true;
    }
    if (current === sourceFile) break;
  }
  return false;
}

function namespaceSelection(expression, sourceFile) {
  if (!expression) return undefined;
  if (is.isIdentifier(expression) && expression.text === "undefined" && !isLexicallyBound(expression, "undefined", sourceFile)) {
    return { catalog: "common" };
  }
  if (expression.kind === SyntaxKind.NullKeyword) return { catalog: "common" };
  const namespace = literalValue(expression);
  if (namespace === "common" || namespace === "translation") return { catalog: namespace };
  return { unresolvedNamespace: expression?.getText(sourceFile).slice(0, 160) ?? "unknown" };
}

function namespaceFromOptions(expression, sourceFile) {
  if (!expression || !is.isObjectLiteralExpression(expression)) return undefined;
  for (const property of expression.properties) {
    if (!is.isPropertyAssignment(property)) continue;
    if (property.name.getText(sourceFile) !== "ns") continue;
    return namespaceSelection(property.initializer, sourceFile);
  }
  return undefined;
}

function hasCountOption(call, keyIndex, sourceFile) {
  const options = call.arguments[keyIndex + 1];
  if (!options || !is.isObjectLiteralExpression(options)) return false;
  return options.properties.some((property) =>
    (is.isPropertyAssignment(property) || is.isShorthandPropertyAssignment(property)) && property.name.getText(sourceFile) === "count",
  );
}

function collectTranslationBindings(sourceFile) {
  const direct = new Map();
  const hooks = new Map();
  const instances = new Map();

  function add(map, name, binding) {
    const entries = map.get(name) ?? [];
    entries.push(binding);
    map.set(name, entries);
  }

  function lexicalScope(node) {
    const functionScoped = isVarDeclaration(node, sourceFile);
    for (let current = node.parent; current && current !== sourceFile; current = current.parent) {
      if (functionScoped ? Boolean(current.parameters) : isLexicalScopeBoundary(current)) return current;
    }
    return sourceFile;
  }

  function addLocalBindings(node, scope) {
    for (const name of bindingNames(node.name)) {
      addLocal(name, scope);
    }
  }

  function addLocal(name, scope) {
    const binding = { kind: "local", scope };
    add(direct, name, binding);
    add(instances, name, binding);
  }

  for (const statement of sourceFile.statements) {
    if (!is.isImportDeclaration(statement) || !is.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = knownI18nModule(statement.moduleSpecifier.text, sourceFile);
    const clause = statement.importClause;
    if (!module || !clause) continue;
    if (clause.name && (module.kind === "i18next" || module.kind === "common" || module.kind === "legacy")) {
      add(instances, clause.name.text, { catalog: module.catalog, binding: `instance:${clause.name.text}`, keyIndex: 0, scope: sourceFile, namespaceAware: module.kind === "i18next", pluralAware: true });
    }
    const named = clause.namedBindings;
    if (!named || !is.isNamedImports(named)) continue;
    for (const specifier of named.elements) {
      const imported = importedBindingName(specifier);
      const local = specifier.name.text;
      if (module.kind === "react-hook" && imported === "useTranslation") {
        add(hooks, local, { catalog: "common", binding: `hook:${local}`, scope: sourceFile, namespaceAware: true });
      } else if (module.kind === "legacy" && imported === "useTranslation") {
        add(hooks, local, { catalog: "translation", binding: `hook:${local}`, scope: sourceFile });
      } else if ((module.kind === "common" || module.kind === "legacy") && ["translateInstant", "t", "td"].includes(imported)) {
        add(direct, local, { catalog: module.catalog, binding: `import:${local}`, keyIndex: 0, scope: sourceFile, pluralAware: true });
      } else if (module.kind === "i18next" && ["t", "translate"].includes(imported)) {
        add(direct, local, { catalog: "common", binding: `import:${local}`, keyIndex: 0, scope: sourceFile, namespaceAware: true, pluralAware: true });
      } else if (module.kind === "i18next" && imported === "i18n") {
        add(instances, local, { catalog: "common", binding: `instance:${local}`, keyIndex: 0, scope: sourceFile, namespaceAware: true, pluralAware: true });
      } else if (module.kind === "server" && imported === "translate") {
        add(direct, local, { catalog: "common", binding: `import:${local}`, keyIndex: 1, scope: sourceFile, pluralAware: false });
      } else if (module.kind === "request" && imported === "translateRequest") {
        add(direct, local, { catalog: "common", binding: `import:${local}`, keyIndex: 1, scope: sourceFile, pluralAware: false });
      }
    }
  }

  function visit(node) {
    if (is.isVariableDeclaration(node)) {
      const hookCall = node.initializer && is.isCallExpression(node.initializer)
        ? selectBinding(hooks.get(calleeName(node.initializer.expression)), node, sourceFile)
        : undefined;
      if (hookCall && is.isObjectBindingPattern(node.name)) {
        const namespace = hookCall.namespaceAware ? namespaceSelection(node.initializer.arguments[0], sourceFile) : undefined;
        for (const element of node.name.elements) {
          if (!is.isBindingElement(element)) continue;
          const property = element.propertyName?.text ?? element.name.getText(sourceFile);
          for (const local of bindingNames(element.name)) {
            if (property === "t") {
              add(direct, local, {
                catalog: namespace?.catalog ?? hookCall.catalog,
                binding: "hook:t",
                keyIndex: 0,
                scope: lexicalScope(node),
                namespaceAware: true,
                pluralAware: true,
                ...(namespace?.unresolvedNamespace ? { unresolvedNamespace: namespace.unresolvedNamespace } : {}),
              });
            } else {
              add(direct, local, { kind: "local", scope: lexicalScope(node) });
            }
          }
        }
      } else {
        addLocalBindings(node, lexicalScope(node));
      }
    } else if ((is.isFunctionDeclaration(node) || is.isClassDeclaration(node)) && node.name) {
      addLocal(node.name.text, lexicalScope(node));
      if (is.isFunctionDeclaration(node)) {
        for (const parameter of node.parameters) addLocalBindings(parameter, node);
      }
    } else if ((is.isArrowFunction(node) || is.isFunctionExpression(node) || is.isMethodDeclaration(node)) && node.parameters) {
      for (const parameter of node.parameters) addLocalBindings(parameter, node);
    }
    node.forEachChild(visit);
  }
  visit(sourceFile);
  return { direct, instances };
}

function selectBinding(candidates, node, sourceFile) {
  if (!candidates) return undefined;
  for (let current = node.parent; current; current = current.parent) {
    const inScope = candidates.filter((candidate) => candidate.scope === current);
    if (inScope.length > 0) return inScope.at(-1);
    if (current === sourceFile) break;
  }
  return undefined;
}

function classifyTranslationCall(call, bindings, sourceFile) {
  function withNamespace(binding, callee) {
    if (!binding || binding.kind === "local") return undefined;
    if (binding.unresolvedNamespace) return { ...binding, callee };
    const namespace = binding.namespaceAware ? namespaceFromOptions(call.arguments[binding.keyIndex + 1], sourceFile) : undefined;
    return {
      ...binding,
      ...(namespace?.catalog ? { catalog: namespace.catalog } : {}),
      ...(namespace?.unresolvedNamespace ? { unresolvedNamespace: namespace.unresolvedNamespace } : {}),
      callee,
    };
  }
  const expression = call.expression;
  if (is.isIdentifier(expression)) {
    const binding = selectBinding(bindings.direct.get(expression.text), call, sourceFile);
    return withNamespace(binding, expression.text);
  }
  if (is.isPropertyAccessExpression(expression) && expression.name.text === "t" && is.isIdentifier(expression.expression)) {
    const binding = selectBinding(bindings.instances.get(expression.expression.text), call, sourceFile);
    return withNamespace(binding, `${expression.expression.text}.t`);
  }
  return undefined;
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

function scanSourceFile(repoRoot, absoluteFile, sourceFile, catalogs) {
  const file = toRepoRelative(repoRoot, absoluteFile);
  const usages = [];
  const dynamicWarnings = [];
  const unresolvedTranslationCallWarnings = [];
  const undefinedStaticTranslationCallFindings = [];
  const bindings = collectTranslationBindings(sourceFile);

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
      const { keySet, variantBaseMap } = catalogs.common;
      const matchedKeys = keySet.has(value) ? [value, ...(variantBaseMap.get(value) ?? [])] : (variantBaseMap.get(value) ?? []);
      for (const key of matchedKeys) {
        const context = usageContext(node, (call) => classifyTranslationCall(call, bindings, sourceFile));
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
      const translation = classifyTranslationCall(node, bindings, sourceFile);
      const keyArg = translation ? node.arguments[translation.keyIndex] : undefined;
      if (translation?.unresolvedNamespace) {
        unresolvedTranslationCallWarnings.push({
          ...locationFor(keyArg ?? node),
          binding: translation.binding,
          callee: translation.callee,
          namespace: translation.unresolvedNamespace,
        });
      } else if (translation && keyArg && literalValue(keyArg) === undefined) {
        dynamicWarnings.push({
          ...locationFor(keyArg),
          catalog: translation.catalog,
          binding: translation.binding,
          callee: translation.callee,
          expression: keyArg.getText(sourceFile).slice(0, 160),
        });
      } else if (translation && keyArg && literalValue(keyArg) !== undefined) {
        const key = literalValue(keyArg);
        const catalog = catalogs[translation.catalog];
        const hasRuntimeVariant = translation.pluralAware && hasCountOption(node, translation.keyIndex, sourceFile) && catalog?.variantBaseMap.has(key);
        if (key && !catalog?.keySet.has(key) && !hasRuntimeVariant) {
          undefinedStaticTranslationCallFindings.push({
            ...locationFor(keyArg),
            catalog: translation.catalog,
            key,
            binding: translation.binding,
            callee: translation.callee,
          });
        }
      }
    }

    node.forEachChild(visit);
  }

  visit(sourceFile);
  return { usages, dynamicWarnings, unresolvedTranslationCallWarnings, undefinedStaticTranslationCallFindings };
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
  const translationDefinitions = await readTranslationCatalog(repoRoot);
  const { localeResults, usages, dynamicTranslationCallWarnings, unresolvedTranslationCallWarnings, undefinedStaticTranslationCallFindings } = withTypeScriptSourceFiles(
    [...localeFiles, ...sourceFiles],
    (sourceFileFor) => {
      const localeResults = DEFAULT_LOCALES.map((locale, index) =>
        readLocaleCatalog(repoRoot, locale, sourceFileFor(localeFiles[index])),
      );
      const keySet = new Set(localeResults.flatMap((result) => Object.keys(result.definitions)));
      const translationKeySet = new Set(Object.keys(translationDefinitions));
      const catalogs = {
        common: { keySet, variantBaseMap: buildVariantBaseMap(keySet) },
        translation: { keySet: translationKeySet, variantBaseMap: buildVariantBaseMap(translationKeySet) },
      };
      const usages = [];
      const dynamicTranslationCallWarnings = [];
      const unresolvedTranslationCallWarnings = [];
      const undefinedStaticTranslationCallFindings = [];

      for (const sourceFile of sourceFiles) {
        const result = scanSourceFile(
          repoRoot,
          sourceFile,
          sourceFileFor(sourceFile),
          catalogs,
        );
        usages.push(...result.usages);
        dynamicTranslationCallWarnings.push(...result.dynamicWarnings);
        unresolvedTranslationCallWarnings.push(...result.unresolvedTranslationCallWarnings);
        undefinedStaticTranslationCallFindings.push(...result.undefinedStaticTranslationCallFindings);
      }

      return { localeResults, usages, dynamicTranslationCallWarnings, unresolvedTranslationCallWarnings, undefinedStaticTranslationCallFindings };
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
  unresolvedTranslationCallWarnings.sort((left, right) =>
    left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column,
  );
  undefinedStaticTranslationCallFindings.sort((left, right) =>
    left.catalog.localeCompare(right.catalog) ||
    left.key.localeCompare(right.key) ||
    left.file.localeCompare(right.file) ||
    left.binding.localeCompare(right.binding) ||
    left.callee.localeCompare(right.callee),
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
    unresolvedTranslationCallWarningCount: unresolvedTranslationCallWarnings.length,
    undefinedStaticTranslationCallCount: undefinedStaticTranslationCallFindings.length,
    includeTests,
  };

  return {
    version: 2,
    summary,
    keys,
    definitions: Object.fromEntries(localeResults.map((result) => [result.locale, result.definitions])),
    usages,
    unusedKeys,
    duplicates,
    parity,
    dynamicTranslationCallWarnings,
    unresolvedTranslationCallWarnings,
    undefinedStaticTranslationCallFindings,
    catalogs: {
      common: { keyCount: Object.keys(keys).length },
      translation: { keyCount: Object.keys(translationDefinitions).length },
    },
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

function translationFindingIdentity(finding) {
  return [finding.catalog, finding.key, finding.file, finding.binding, finding.callee].join("\u0000");
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
  const undefinedStaticTranslationCallBaselineUnavailable = !Array.isArray(before.undefinedStaticTranslationCallFindings);
  const afterUndefinedStaticTranslationCalls = after.undefinedStaticTranslationCallFindings ?? [];
  const beforeUndefinedStaticCalls = new Set((before.undefinedStaticTranslationCallFindings ?? []).map(translationFindingIdentity));
  const newUndefinedStaticTranslationCalls = undefinedStaticTranslationCallBaselineUnavailable
    ? []
    : afterUndefinedStaticTranslationCalls
      .filter((finding) => !beforeUndefinedStaticCalls.has(translationFindingIdentity(finding)))
      .sort((left, right) => translationFindingIdentity(left).localeCompare(translationFindingIdentity(right)));

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
    ...newUndefinedStaticTranslationCalls.map((item) => ({ type: "undefined-static-translation-call", ...item })),
  ];

  return {
    version: 2,
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
      undefinedStaticTranslationCallBaselineUnavailable,
      undefinedStaticTranslationCallCount: afterUndefinedStaticTranslationCalls.length,
      newUndefinedStaticTranslationCallCount: newUndefinedStaticTranslationCalls.length,
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
    undefinedStaticTranslationCallFindings: afterUndefinedStaticTranslationCalls,
    newUndefinedStaticTranslationCalls,
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
    `- unresolved translation call warnings: ${snapshot.summary.unresolvedTranslationCallWarningCount}`,
    `- undefined static translation calls: ${snapshot.summary.undefinedStaticTranslationCallCount}`,
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
    `- undefined static translation calls: ${comparison.summary.undefinedStaticTranslationCallCount}`,
    `- new undefined static translation calls: ${comparison.summary.newUndefinedStaticTranslationCallCount}`,
    `- undefined-call baseline unavailable: ${comparison.summary.undefinedStaticTranslationCallBaselineUnavailable}`,
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

#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as is from "typescript/unstable/ast/is";

import { withTypeScriptSourceFiles } from "../../../../scripts/typescript-ast-session.mjs";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git", ".omx", ".stage", ".vite", "coverage", "dist", "node_modules", "playwright-report", "storybook-static", "test-results",
]);
const EXCLUDED_FILE_PATTERN = /(?:^|[/\\])(?:__tests__|tests|lab|design|perf)(?:[/\\]|$)|(?:UxLab|DesignGuide|TaskChatLab|LongThreadPerf|test|spec|stories|perf)\.[cm]?[jt]sx?$/i;
const VISIBLE_ATTRIBUTE_NAMES = new Set(["aria-label", "aria-description", "alt", "label", "placeholder", "title"]);
const CONFIG_PROPERTY_NAMES = new Set(["label", "title", "description"]);
const TECHNICAL_TAG_NAMES = new Set(["code", "kbd", "pre", "samp", "script", "style"]);

function usage() {
  return "Usage: node .agents/skills/paperclip-cn-fork-maintenance/scripts/i18n-visible-text-audit.mjs [--root <repo>] --out <file>";
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function indexToLocation(sourceText, index) {
  let line = 1;
  let lineStart = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (sourceText.charCodeAt(cursor) === 10) {
      line += 1;
      lineStart = cursor + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}

function nodeText(sourceFile, node) {
  return node.getText(sourceFile);
}

function normalizedText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function isTechnicalText(value) {
  const text = normalizedText(value);
  return !text
    || /^https?:\/\//i.test(text)
    || /^(?:[A-Za-z]:)?[/\\]/.test(text)
    || /^(?:pnpm|npm|yarn|bun|git|cd)\s/.test(text)
    || /^(?:[A-Z][A-Z0-9]*_)+[A-Z0-9_]+(?:=[^\s]+)?$/.test(text);
}

function propertyName(node) {
  if (is.isIdentifier(node) || is.isStringLiteral(node) || is.isNumericLiteral(node)) return node.text;
  return undefined;
}

function jsxTagName(node) {
  if (!node) return undefined;
  if (is.isIdentifier(node)) return node.text;
  return nodeText(node.getSourceFile(), node);
}

function isTechnicalJsxContext(node) {
  let current = node.parent;
  while (current) {
    if (is.isJsxElement(current) && TECHNICAL_TAG_NAMES.has(jsxTagName(current.openingElement.tagName)?.toLowerCase())) return true;
    current = current.parent;
  }
  return false;
}

function jsxAttributeName(node) {
  return node && is.isJsxAttribute(node) ? node.name.text : undefined;
}

function isIgnoredAttributeContext(node) {
  let current = node;
  while (current) {
    if (is.isJsxAttribute(current)) {
      const name = jsxAttributeName(current);
      return !VISIBLE_ATTRIBUTE_NAMES.has(name) || name === "href" || name === "src";
    }
    if (is.isJsxExpression(current) || is.isParenthesizedExpression(current) || is.isAsExpression(current)) {
      current = current.parent;
      continue;
    }
    return false;
  }
  return false;
}

function isTranslationCall(node) {
  let current = node.parent;
  while (current) {
    if (is.isCallExpression(current)) {
      const expression = current.expression;
      const name = is.isIdentifier(expression) ? expression.text : undefined;
      if (name === "t" || name === "translateInstant") return true;
    }
    if (is.isSourceFile(current)) return false;
    current = current.parent;
  }
  return false;
}

function expressionValue(node, sourceFile) {
  if (is.isStringLiteral(node) || is.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (is.isTemplateExpression(node)) {
    const source = nodeText(sourceFile, node);
    return source.startsWith("`") && source.endsWith("`") ? source.slice(1, -1) : source;
  }
  return undefined;
}

function expressionKind(node) {
  if (is.isTemplateExpression(node)) return "template";
  return "conditional";
}

async function collectSourceFiles(root) {
  const results = [];
  const excluded = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORY_NAMES.has(entry.name)) await visit(absolute);
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      const relative = normalizePath(path.relative(root, absolute));
      if (EXCLUDED_FILE_PATTERN.test(relative)) {
        excluded.push(relative);
      } else {
        results.push(absolute);
      }
    }
  }
  await visit(path.join(root, "ui", "src"));
  return { files: results.sort(), excludedFiles: excluded.sort() };
}

function candidateFor(sourceFile, sourceText, root, node, kind, value, context) {
  const text = normalizedText(value);
  if (isTechnicalText(text) || !/[A-Za-z]/.test(text)) return undefined;
  const start = node.getStart(sourceFile);
  return {
    file: normalizePath(path.relative(root, sourceFile.fileName)),
    ...indexToLocation(sourceText, start),
    text,
    kind,
    context,
  };
}

function visibleContextFor(node) {
  let current = node.parent;
  while (current) {
    if (is.isJsxAttribute(current)) {
      const name = jsxAttributeName(current);
      return VISIBLE_ATTRIBUTE_NAMES.has(name) ? `attribute:${name}` : undefined;
    }
    if (is.isPropertyAssignment(current)) {
      const name = propertyName(current.name);
      return CONFIG_PROPERTY_NAMES.has(name) ? `config:${name}` : undefined;
    }
    if (is.isJsxExpression(current)) {
      return isIgnoredAttributeContext(current) || isTechnicalJsxContext(current) ? undefined : "jsx-expression";
    }
    if (is.isSourceFile(current)) return undefined;
    current = current.parent;
  }
  return undefined;
}

function collectCandidates(root, sourceFile, sourceText) {
  const candidates = [];
  const uncertainCandidates = [];
  const seen = new Set();
  function add(target, node, kind, value, context) {
    if (isTechnicalJsxContext(node) || isIgnoredAttributeContext(node) || isTranslationCall(node)) return;
    const candidate = candidateFor(sourceFile, sourceText, root, node, kind, value, context);
    if (!candidate) return;
    const identity = `${candidate.file}:${candidate.line}:${candidate.column}:${candidate.kind}:${candidate.text}`;
    if (!seen.has(identity)) {
      seen.add(identity);
      target.push(candidate);
    }
  }
  function visit(node) {
    if (is.isJsxText(node)) {
      add(candidates, node, "jsx-text", node.text, "jsx");
    }
    if (is.isJsxAttribute(node) && VISIBLE_ATTRIBUTE_NAMES.has(jsxAttributeName(node))) {
      const initializer = node.initializer;
      if (initializer && is.isStringLiteral(initializer)) add(candidates, initializer, `attribute:${jsxAttributeName(node)}`, initializer.text, `attribute:${jsxAttributeName(node)}`);
      if (initializer && is.isJsxExpression(initializer) && initializer.expression) {
        const value = expressionValue(initializer.expression, sourceFile);
        if (value !== undefined) add(candidates, initializer.expression, `attribute:${jsxAttributeName(node)}`, value, `attribute:${jsxAttributeName(node)}`);
      }
    }
    if (is.isConditionalExpression(node)) {
      const context = visibleContextFor(node);
      for (const branch of [node.whenTrue, node.whenFalse]) {
        const value = expressionValue(branch, sourceFile);
        if (value !== undefined) {
          add(context ? candidates : uncertainCandidates, branch, expressionKind(branch), value, context ?? "implementation-conditional");
        }
      }
    }
    if (is.isPropertyAssignment(node) && CONFIG_PROPERTY_NAMES.has(propertyName(node.name))) {
      const value = expressionValue(node.initializer, sourceFile);
      if (value !== undefined) add(candidates, node.initializer, `config:${propertyName(node.name)}`, value, `config:${propertyName(node.name)}`);
    }
    node.forEachChild(visit);
  }
  visit(sourceFile);
  return { candidates, uncertainCandidates };
}

export async function buildVisibleTextInventory({ root = process.cwd() } = {}) {
  const repoRoot = path.resolve(root);
  const { files, excludedFiles } = await collectSourceFiles(repoRoot);
  const sourceTexts = await Promise.all(files.map((file) => readFile(file, "utf8")));
  const perFile = withTypeScriptSourceFiles(files, (sourceFileFor) => files.map((file, index) =>
    collectCandidates(repoRoot, sourceFileFor(file), sourceTexts[index]),
  ));
  const candidates = perFile.flatMap((result) => result.candidates);
  const uncertainCandidates = perFile.flatMap((result) => result.uncertainCandidates);
  candidates.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column || left.kind.localeCompare(right.kind));
  uncertainCandidates.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column || left.kind.localeCompare(right.kind));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: { fileCount: files.length, excludedFileCount: excludedFiles.length, candidateCount: candidates.length, uncertainCandidateCount: uncertainCandidates.length },
    excludedFiles,
    candidates,
    uncertainCandidates,
  };
}

function parseArgs(argv) {
  const options = { root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--root" || arg === "--out") {
      const value = argv[++index];
      assert(value, `${arg} requires a value`);
      options[arg.slice(2)] = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  assert(options.out, "--out is required");
  return options;
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const inventory = await buildVisibleTextInventory({ root: options.root });
  const out = path.resolve(options.out);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(inventory, null, 2)}\n`);
  return inventory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error.stack || error.message);
    console.error(usage());
    process.exitCode = 1;
  });
}

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep, win32 } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const uiRequire = createRequire(join(repositoryRoot, "ui", "package.json"));
const storybookManifestPath = uiRequire.resolve("@storybook/react-vite/package.json");
const storybookManifest = readManifest(storybookManifestPath);
const storybookRequire = createRequire(storybookManifestPath);
const docgenEntryPath = resolveStorybookDependencyEntry("@joshwooding/vite-plugin-react-docgen-typescript");
const docgenManifestPath = findManifest(docgenEntryPath, "@joshwooding/vite-plugin-react-docgen-typescript");
const docgenManifest = readManifest(docgenManifestPath);
const docgenRequire = createRequire(docgenEntryPath);
const globEntryPath = docgenRequire.resolve("glob");
const globManifestPath = findManifest(globEntryPath, "glob");
const globManifest = readManifest(globManifestPath);
const globRequire = createRequire(globEntryPath);
const minimatchEntryPath = globRequire.resolve("minimatch");
const minimatchManifestPath = findManifest(minimatchEntryPath, "minimatch");
const minimatchManifest = readManifest(minimatchManifestPath);
const { globSync } = globRequire("glob");
const { GLOBSTAR, Minimatch, escape, minimatch, unescape } = globRequire("minimatch");

test("Storybook docgen resolves the patched glob and minimatch APIs", () => {
  assert.equal(nodeAtLeast(24, 11), true, "this dependency chain is supported on the repository's Node >=24.11.0 floor");
  assert.equal(storybookManifest.version, "10.5.10");
  assert.equal(storybookRequire.resolve("@storybook/react-vite/package.json"), storybookManifestPath);
  assert.equal(storybookManifest.dependencies["@joshwooding/vite-plugin-react-docgen-typescript"], "^0.7.0");
  assert.equal(docgenManifest.version, "0.7.0");
  assertResolvedVersion("glob", globManifest.version, "13.0.6");
  assertResolvedVersion("glob@13.0.6 > minimatch", minimatchManifest.version, "11.0.4");
  assert.equal(typeof globSync, "function");
  assert.equal(typeof minimatch, "function");
  assert.equal(typeof Minimatch, "function");
  assert.equal(typeof escape, "function");
  assert.equal(typeof unescape, "function");
  assert.equal(typeof GLOBSTAR, "symbol");
});

test("glob 13 retains Storybook docgen brace, ignore, and dot-file behavior", () => {
  withFixture((fixture) => {
    assert.deepEqual(
      matchedRelativeFiles(fixture, "src/**/*.{ts,tsx}", { ignore: "**/*.test.ts" }),
      ["src/a.ts", "src/a.tsx", "src/nested/b.ts"],
    );
    assert.deepEqual(
      matchedRelativeFiles(fixture, "src/**/*.{ts,tsx}", { dot: true, ignore: "**/*.test.ts" }),
      ["src/.hidden.ts", "src/a.ts", "src/a.tsx", "src/nested/b.ts"],
    );
  });
});

test("glob 13 supports Windows-style relative and absolute patterns", {
  skip: process.platform !== "win32" && "requires Windows path parsing",
}, () => {
  withFixture((fixture) => {
    assert.deepEqual(
      matchedRelativeFiles(fixture, "src\\**\\*.ts", { windowsPathsNoEscape: true }),
      ["src/a.test.ts", "src/a.ts", "src/nested/b.ts"],
    );

    const absolutePattern = join(fixture, "src", "**", "*.ts");
    const absoluteFiles = globSync(absolutePattern, { windowsPathsNoEscape: true })
      .map((file) => portable(relative(fixture, file)))
      .sort();
    assert.deepEqual(absoluteFiles, ["src/a.test.ts", "src/a.ts", "src/nested/b.ts"]);
  });
});

test("minimatch 11 matches Windows namespace and UNC path strings without I/O", () => {
  const namespaceRoot = `\\\\?\\${win32.resolve("D:\\storybook-glob-fixture")}`;
  const namespaceFile = `${namespaceRoot}\\src\\nested\\b.ts`;
  const namespacePattern = `${namespaceRoot}\\src\\**\\*.ts`;
  const uncFile = "\\\\paperclip-test\\storybook\\src\\nested\\b.ts";
  const uncPattern = "\\\\paperclip-test\\storybook\\src\\**\\*.ts";
  const options = { platform: "win32", windowsPathsNoEscape: true };

  assert.equal(minimatch(namespaceFile, namespacePattern, options), true);
  assert.equal(new Minimatch(namespacePattern, options).match(namespaceFile), true);
  assert.equal(minimatch(uncFile, uncPattern, options), true);
  assert.equal(escape("a[b]"), "a\\[b\\]");
  assert.equal(unescape(escape("a[b]")), "a[b]");
});

function matchedRelativeFiles(fixture, pattern, options = {}) {
  return globSync(pattern, { cwd: fixture, ...options }).map(portable).sort();
}

function withFixture(callback) {
  const fixture = mkdtempSync(join(tmpdir(), "paperclip-storybook-glob-"));
  try {
    for (const file of ["src/a.ts", "src/a.tsx", "src/nested/b.ts", "src/nested/c.js", "src/.hidden.ts", "src/a.test.ts"]) {
      const path = join(fixture, ...file.split("/"));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file);
    }
    return callback(fixture);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

function findManifest(entryPath, expectedName) {
  let candidate = dirname(entryPath);
  for (let depth = 0; depth < 8; depth += 1) {
    const manifestPath = join(candidate, "package.json");
    try {
      if (readManifest(manifestPath).name === expectedName) return manifestPath;
    } catch {
      // Continue up the resolved dependency's own package directory.
    }
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`Could not find ${expectedName} package manifest for ${entryPath}`);
}

function resolveStorybookDependencyEntry(packageName) {
  try {
    return storybookRequire.resolve(packageName);
  } catch (error) {
    if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
  }

  for (const nodeModulesPath of storybookRequire.resolve.paths(packageName) ?? []) {
    const manifestPath = join(nodeModulesPath, packageName, "package.json");
    try {
      const manifest = readManifest(manifestPath);
      const importEntry = manifest.exports?.["."]?.import;
      if (typeof importEntry === "string") return join(dirname(manifestPath), importEntry);
    } catch {
      // Keep following Node's own package search paths for this import-only package.
    }
  }

  throw new Error(`Could not resolve Storybook dependency ${packageName}`);
}

function readManifest(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function portable(path) {
  return path.split(sep).join("/");
}

function nodeAtLeast(major, minor) {
  const [currentMajor, currentMinor] = process.versions.node.split(".").map(Number);
  return currentMajor > major || (currentMajor === major && currentMinor >= minor);
}

function assertResolvedVersion(name, actual, expected) {
  assert.equal(
    actual,
    expected,
    `${name} must resolve to ${expected}; update this probe with the audited replacement before removing the scoped override`,
  );
}

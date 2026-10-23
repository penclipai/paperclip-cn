#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateDesktopSizeBudget } from "./desktop-size-budget.mjs";
import { inspectRuntimePayload } from "./runtime-payload.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, "..");
const releaseDir = path.resolve(packageDir, "release");
const manifestPath = path.resolve(releaseDir, "desktop-artifacts.json");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function statTree(rootPath) {
  const summary = {
    path: rootPath,
    exists: existsSync(rootPath),
    files: 0,
    directories: 0,
    bytes: 0,
  };

  if (!summary.exists) {
    return summary;
  }

  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.resolve(current, entry.name);
      if (entry.isDirectory()) {
        summary.directories += 1;
        stack.push(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      summary.files += 1;
      summary.bytes += statSync(entryPath).size;
    }
  }

  return summary;
}

function listChildrenBySize(rootPath, { scopedPackages = false, limit = 30 } = {}) {
  if (!existsSync(rootPath)) {
    return [];
  }

  const children = [];
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ".bin" || entry.name === ".pnpm") continue;

    const entryPath = path.resolve(rootPath, entry.name);
    if (scopedPackages && entry.name.startsWith("@")) {
      for (const scopedEntry of readdirSync(entryPath, { withFileTypes: true })) {
        if (!scopedEntry.isDirectory()) continue;
        const scopedPath = path.resolve(entryPath, scopedEntry.name);
        children.push({
          name: `${entry.name}/${scopedEntry.name}`,
          ...statTree(scopedPath),
        });
      }
      continue;
    }

    children.push({
      name: entry.name,
      ...statTree(entryPath),
    });
  }

  return children
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, limit);
}

function listLargestFiles(rootPath, limit = 30) {
  if (!existsSync(rootPath)) {
    return [];
  }

  const files = [];
  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      files.push({
        path: path.relative(rootPath, entryPath).replaceAll(path.sep, "/"),
        bytes: statSync(entryPath).size,
      });
    }
  }

  return files.sort((left, right) => right.bytes - left.bytes).slice(0, limit);
}

function renderMarkdown(audit) {
  const rows = [
    ["Release assets", audit.releaseAssets],
    ["Unpacked app", audit.unpackedApp],
    ["App runtime", audit.appRuntime],
    ["Runtime node_modules", audit.runtimeNodeModules],
    ["Bundled plugins", audit.bundledPlugins],
  ];

  const lines = [
    "# Desktop Size Audit",
    "",
    `Platform: ${audit.platform}`,
    `Arch: ${audit.arch}`,
    `Release version: ${audit.releaseVersion ?? "local"}`,
    "",
    "## Summary",
    "",
    "| Area | Size | Files | Directories |",
    "| --- | ---: | ---: | ---: |",
    ...rows.map(([label, stat]) =>
      `| ${label} | ${formatBytes(stat.bytes)} | ${stat.files} | ${stat.directories} |`),
    "",
    "## Release Assets",
    "",
    "| File | Size |",
    "| --- | ---: |",
    ...audit.releaseAssetFiles.map((asset) => `| ${asset.name} | ${formatBytes(asset.bytes)} |`),
    "",
    "## Largest Runtime Package Roots",
    "",
    "| Package | Size | Files |",
    "| --- | ---: | ---: |",
    ...audit.topRuntimePackages.map((entry) =>
      `| ${entry.name} | ${formatBytes(entry.bytes)} | ${entry.files} |`),
    "",
    "## Largest Bundled Plugin Roots",
    "",
    "| Package | Size | Files |",
    "| --- | ---: | ---: |",
    ...audit.topBundledPlugins.map((entry) =>
      `| ${entry.name} | ${formatBytes(entry.bytes)} | ${entry.files} |`),
    "",
    "## Largest App Runtime Files",
    "",
    "| File | Size |",
    "| --- | ---: |",
    ...audit.largestRuntimeFiles.map((entry) => `| ${entry.path} | ${formatBytes(entry.bytes)} |`),
    "",
  ];

  if (audit.sizeBudget) {
    lines.push(
      "## Reviewed Size Budget",
      "",
      audit.sizeBudget.summary,
      "",
    );
  } else if (audit.sizeBudgetError) {
    lines.push(
      "## Reviewed Size Budget",
      "",
      `Unable to evaluate reviewed size budget: ${audit.sizeBudgetError}`,
      "",
    );
  }

  lines.push("## Runtime Payload Inspection", "");
  if (audit.runtimePayload) {
    lines.push(
      `Supported target: ${audit.runtimePayload.supported ? "yes" : "no"}`,
      `Selected native package: ${audit.runtimePayload.nativePackage ?? "none"}`,
      `Portable executable is symlink: ${audit.runtimePayload.portableIsSymlink ? "yes" : "no"}`,
      `Portable executable matches native: ${audit.runtimePayload.portableMatchesNative === undefined ? "not applicable" : audit.runtimePayload.portableMatchesNative ? "yes" : "no"}`,
      `Unexpected native packages: ${audit.runtimePayload.unexpectedPackages.length > 0 ? audit.runtimePayload.unexpectedPackages.join(", ") : "none"}`,
      "",
    );
  } else {
    lines.push(`Unable to inspect runtime payload: ${audit.runtimePayloadError}`, "");
  }

  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = { checkBudget: false };
  for (const arg of argv) {
    if (arg === "--check-budget") {
      args.checkBudget = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(manifestPath)) {
    throw new Error(`Desktop artifact manifest not found: ${manifestPath}`);
  }

  const manifest = readJson(manifestPath);
  const platform = manifest.platform ?? "unknown";
  const arch = manifest.arch ?? "unknown";
  const auditBaseName = `desktop-size-audit-${platform}-${arch}`;
  const auditJsonPath = path.resolve(releaseDir, `${auditBaseName}.json`);
  const auditMarkdownPath = path.resolve(releaseDir, `${auditBaseName}.md`);
  const appRuntimePath = manifest.runtimePath ?? "";
  const runtimeNodeModulesPath = path.resolve(appRuntimePath, "node_modules");
  const bundledPluginsPath = path.resolve(appRuntimePath, "packages", "plugins");
  const releaseAssetPaths = Array.isArray(manifest.releaseAssetPaths) ? manifest.releaseAssetPaths : [];
  const releaseAssetFiles = releaseAssetPaths
    .filter((assetPath) => existsSync(assetPath))
    .map((assetPath) => ({
      name: path.basename(assetPath),
      path: assetPath,
      bytes: statSync(assetPath).size,
    }));

  const audit = {
    generatedAt: new Date().toISOString(),
    platform,
    nodePlatform: manifest.nodePlatform ?? null,
    arch,
    releaseVersion: manifest.releaseVersion ?? null,
    releaseAssets: {
      path: releaseDir,
      exists: existsSync(releaseDir),
      files: releaseAssetFiles.length,
      directories: 0,
      bytes: releaseAssetFiles.reduce((total, asset) => total + asset.bytes, 0),
    },
    releaseAssetFiles,
    unpackedApp: statTree(manifest.unpackedAppPath ?? ""),
    appRuntime: statTree(appRuntimePath),
    runtimeNodeModules: statTree(runtimeNodeModulesPath),
    bundledPlugins: statTree(bundledPluginsPath),
    topRuntimePackages: listChildrenBySize(runtimeNodeModulesPath, { scopedPackages: true }),
    topBundledPlugins: listChildrenBySize(bundledPluginsPath, { scopedPackages: false }),
    largestRuntimeFiles: listLargestFiles(appRuntimePath),
  };

  let runtimePayloadError = null;
  try {
    if (!appRuntimePath || !existsSync(appRuntimePath)) {
      throw new Error(`Desktop app runtime is missing for payload inspection: ${appRuntimePath || "(empty path)"}`);
    }
    audit.runtimePayload = inspectRuntimePayload({
      runtimeRoot: appRuntimePath,
      platform: manifest.nodePlatform,
      arch,
    });
  } catch (error) {
    runtimePayloadError = error;
    audit.runtimePayloadError = error instanceof Error ? error.message : String(error);
  }

  let budgetEvaluationError = null;
  try {
    audit.sizeBudget = evaluateDesktopSizeBudget(audit);
  } catch (error) {
    budgetEvaluationError = error;
    audit.sizeBudgetError = error instanceof Error ? error.message : String(error);
  }

  mkdirSync(releaseDir, { recursive: true });
  writeJson(auditJsonPath, audit);
  writeFileSync(auditMarkdownPath, renderMarkdown(audit), "utf8");

  manifest.sizeAuditPaths = [auditJsonPath, auditMarkdownPath];
  manifest.sizeAudit = {
    jsonPath: auditJsonPath,
    markdownPath: auditMarkdownPath,
    releaseAssetBytes: audit.releaseAssets.bytes,
    unpackedBytes: audit.unpackedApp.bytes,
    appRuntimeBytes: audit.appRuntime.bytes,
    appRuntimeFiles: audit.appRuntime.files,
    runtimeNodeModulesBytes: audit.runtimeNodeModules.bytes,
    bundledPluginsBytes: audit.bundledPlugins.bytes,
    budget: audit.sizeBudget ?? null,
    budgetError: audit.sizeBudgetError ?? null,
    runtimePayload: audit.runtimePayload ?? null,
    runtimePayloadError: audit.runtimePayloadError ?? null,
  };
  writeJson(manifestPath, manifest);

  console.log(
    `[desktop-size-audit] ${platform}/${arch}: assets=${formatBytes(audit.releaseAssets.bytes)}, unpacked=${formatBytes(audit.unpackedApp.bytes)}, runtime=${formatBytes(audit.appRuntime.bytes)} (${audit.appRuntime.files} files).`,
  );
  console.log(`[desktop-size-audit] Wrote ${auditJsonPath}`);
  console.log(`[desktop-size-audit] Wrote ${auditMarkdownPath}`);

  if (audit.sizeBudget) {
    console.log(`[desktop-size-budget] ${audit.sizeBudget.summary}`);
  } else {
    console.warn(`[desktop-size-budget] Unable to evaluate budget: ${audit.sizeBudgetError}`);
  }
  if (audit.runtimePayload) {
    console.log(
      `[desktop-runtime-payload] ${platform}/${arch}: supported=${audit.runtimePayload.supported}, native=${audit.runtimePayload.nativePackage ?? "none"}, unexpected=${audit.runtimePayload.unexpectedPackages.join(",") || "none"}.`,
    );
  } else {
    console.warn(`[desktop-runtime-payload] Unable to inspect payload: ${audit.runtimePayloadError}`);
  }

  if (args.checkBudget) {
    if (runtimePayloadError) {
      throw runtimePayloadError;
    }
    if (budgetEvaluationError) {
      throw budgetEvaluationError;
    }
    if (!audit.sizeBudget?.ok) {
      throw new Error(audit.sizeBudget?.summary ?? "Desktop size budget exceeded.");
    }
  }
}

try {
  run();
} catch (error) {
  console.error("[desktop-size-audit] Failed:", error);
  process.exitCode = 1;
}

#!/usr/bin/env -S node --import tsx
import fs from "node:fs/promises";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./dev-service-profile.ts";

type WorkspaceLinkMismatch = {
  workspaceDir: string;
  packageName: string;
  expectedPath: string;
  actualPath: string | null;
};

function readJsonFile(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

type WorkspacePackagePattern = {
  pattern: string;
  negated: boolean;
};

function parseWorkspacePackagePatterns(workspaceText: string): WorkspacePackagePattern[] {
  const lines = workspaceText.split(/\r?\n/);
  const packagesLine = lines.findIndex((line) => /^packages:\s*(?:#.*)?$/.test(line));
  if (packagesLine === -1) {
    throw new Error("Cannot discover workspace packages: pnpm-workspace.yaml has no packages block");
  }

  const entries: WorkspacePackagePattern[] = [];
  for (let index = packagesLine + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^\S/.test(line)) break;
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const match = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (!match?.[1]) {
      throw new Error(`Unsupported pnpm-workspace.yaml packages entry at line ${index + 1}`);
    }
    const raw = match[1].replace(/^(['"])(.*)\1$/, "$2");
    entries.push({ pattern: raw.startsWith("!") ? raw.slice(1) : raw, negated: raw.startsWith("!") });
  }

  if (entries.length === 0) {
    throw new Error("Cannot discover workspace packages: pnpm-workspace.yaml packages block has no patterns");
  }
  return entries;
}

function isWorkspacePackagePath(
  packageDir: string,
  patterns: WorkspacePackagePattern[],
): boolean {
  const matches = (entry: WorkspacePackagePattern) =>
    path.posix.matchesGlob(packageDir, entry.pattern);
  // pnpm exclusions apply regardless of whether a later allow glob also
  // matches, so a generated or standalone subtree cannot re-enter here.
  return patterns.some((entry) => !entry.negated && matches(entry))
    && !patterns.some((entry) => entry.negated && matches(entry));
}

export function discoverWorkspacePackagePaths(rootDir: string): Map<string, string> {
  const packagePaths = new Map<string, string>();
  const ignoredDirNames = new Set([".git", ".paperclip", "dist", "node_modules"]);
  const workspaceManifestPath = path.join(rootDir, "pnpm-workspace.yaml");
  if (!existsSync(workspaceManifestPath)) {
    throw new Error(`Cannot discover workspace packages: missing ${workspaceManifestPath}`);
  }
  const workspaceEntries = parseWorkspacePackagePatterns(readFileSync(workspaceManifestPath, "utf8"));

  function visit(dirPath: string) {
    const packageJsonPath = path.join(dirPath, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageJson = readJsonFile(packageJsonPath);
      const relativeDir = path.relative(rootDir, dirPath).split(path.sep).join("/");
      if (
        typeof packageJson.name === "string" &&
        packageJson.name.length > 0 &&
        isWorkspacePackagePath(relativeDir, workspaceEntries)
      ) {
        packagePaths.set(packageJson.name, dirPath);
      }
      // The pnpm workspace manifest lists package roots. Descendants of a
      // discovered root belong to that package and can include staged payloads.
      return;
    }

    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || ignoredDirNames.has(entry.name)) continue;
      visit(path.join(dirPath, entry.name));
    }
  }

  visit(path.join(rootDir, "packages"));
  visit(path.join(rootDir, "server"));
  visit(path.join(rootDir, "ui"));
  visit(path.join(rootDir, "cli"));

  return packagePaths;
}

let workspacePackagePaths = new Map<string, string>();

function findWorkspaceLinkMismatches(workspaceDir: string): WorkspaceLinkMismatch[] {
  const nodeModulesDir = path.join(repoRoot, workspaceDir, "node_modules");
  if (!existsSync(nodeModulesDir)) {
    return [];
  }

  const packageJson = readJsonFile(path.join(repoRoot, workspaceDir, "package.json"));
  const dependencies = {
    ...(packageJson.dependencies as Record<string, unknown> | undefined),
    ...(packageJson.devDependencies as Record<string, unknown> | undefined),
  };
  const mismatches: WorkspaceLinkMismatch[] = [];

  for (const [packageName, version] of Object.entries(dependencies)) {
    if (typeof version !== "string" || !version.startsWith("workspace:")) continue;

    const expectedPath = workspacePackagePaths.get(packageName);
    if (!expectedPath) continue;

    const linkPath = path.join(repoRoot, workspaceDir, "node_modules", ...packageName.split("/"));
    const actualPath = existsSync(linkPath) ? path.resolve(realpathSync(linkPath)) : null;
    if (actualPath === path.resolve(expectedPath)) continue;

    mismatches.push({
      workspaceDir,
      packageName,
      expectedPath: path.resolve(expectedPath),
      actualPath,
    });
  }

  return mismatches;
}

async function ensureWorkspaceLinksCurrent(workspaceDir: string) {
  const mismatches = findWorkspaceLinkMismatches(workspaceDir);
  if (mismatches.length === 0) return;

  console.log(`[paperclip] detected stale workspace package links for ${workspaceDir}; relinking dependencies...`);
  for (const mismatch of mismatches) {
    console.log(
      `[paperclip]   ${mismatch.packageName}: ${mismatch.actualPath ?? "missing"} -> ${mismatch.expectedPath}`,
    );
  }

  for (const mismatch of mismatches) {
    const linkPath = path.join(repoRoot, mismatch.workspaceDir, "node_modules", ...mismatch.packageName.split("/"));
    await fs.mkdir(path.dirname(linkPath), { recursive: true });
    await fs.rm(linkPath, { recursive: true, force: true });
    await fs.symlink(
      path.resolve(mismatch.expectedPath),
      linkPath,
      process.platform === "win32" ? "junction" : "dir",
    );
  }

  const remainingMismatches = findWorkspaceLinkMismatches(workspaceDir);
  if (remainingMismatches.length === 0) return;

  throw new Error(
    `Workspace relink did not repair all ${workspaceDir} package links: ${remainingMismatches.map((item) => item.packageName).join(", ")}`,
  );
}

export async function ensureWorkspacePackageLinks(): Promise<void> {
  workspacePackagePaths = discoverWorkspacePackagePaths(repoRoot);
  const workspaceDirs = Array.from(
    new Set(
      Array.from(workspacePackagePaths.values())
        .map((packagePath) => path.relative(repoRoot, packagePath))
        .filter((workspaceDir) => workspaceDir.length > 0),
    ),
  ).sort();

  for (const workspaceDir of workspaceDirs) {
    await ensureWorkspaceLinksCurrent(workspaceDir);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await ensureWorkspacePackageLinks();
}

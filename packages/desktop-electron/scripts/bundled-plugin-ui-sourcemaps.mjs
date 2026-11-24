import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

function isRegularFile(filePath) {
  return existsSync(filePath) && lstatSync(filePath).isFile();
}

function sourceMapCounterpart(fileName) {
  if (fileName.endsWith(".js.map") || fileName.endsWith(".d.ts.map")) return fileName.slice(0, -4);
  return null;
}

function stripMatchingSourceMapComment(filePath, sourceMapFileName) {
  const source = readFileSync(filePath, "utf8");
  const escaped = sourceMapFileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const trailingMarker = new RegExp(`(?:\\r?\\n)?//# sourceMappingURL=${escaped}\\s*$`);
  const next = source.replace(trailingMarker, "\n");
  if (next === source) return false;
  writeFileSync(filePath, next, "utf8");
  return true;
}

function walkUiDirectory(directoryPath, removed) {
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const entryPath = path.resolve(directoryPath, entry.name);
    if (entry.isDirectory()) {
      walkUiDirectory(entryPath, removed);
      continue;
    }
    if (!entry.isFile()) continue;
    const counterpart = sourceMapCounterpart(entry.name);
    if (!counterpart) continue;
    const counterpartPath = path.resolve(directoryPath, counterpart);
    if (!isRegularFile(counterpartPath)) continue;
    if (!stripMatchingSourceMapComment(counterpartPath, entry.name)) continue;
    rmSync(entryPath, { force: true });
    removed.push(path.relative(directoryPath, entryPath));
  }
}

/** Removes optional generated UI source maps from the Electron-only staged copy of first-party bundled plugins. */
export function pruneStagedBundledPluginUiSourceMaps(stagedPluginRoot) {
  if (!existsSync(stagedPluginRoot) || !lstatSync(stagedPluginRoot).isDirectory()) return [];
  const resolvedPluginRoot = realpathSync(stagedPluginRoot);
  const uiRoot = path.resolve(stagedPluginRoot, "dist", "ui");
  if (!existsSync(uiRoot) || !lstatSync(uiRoot).isDirectory()) return [];
  const resolvedUiRoot = realpathSync(uiRoot);
  const uiRelativePath = path.relative(resolvedPluginRoot, resolvedUiRoot);
  if (uiRelativePath.startsWith("..") || path.isAbsolute(uiRelativePath)) return [];
  const removed = [];
  walkUiDirectory(resolvedUiRoot, removed);
  return removed;
}

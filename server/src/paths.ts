import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveDefaultConfigPath } from "./home-paths.js";

const PAPERCLIP_CONFIG_BASENAME = "config.json";
const PAPERCLIP_ENV_FILENAME = ".env";
const DESKTOP_TEMP_INSTANCE_PATH_RE = /paperclip-desktop-(?:smoke|acceptance)-/i;

function expandHomePrefix(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value;
}

function containsBrokenDesktopTempPath(value: unknown): boolean {
  if (typeof value === "string") {
    const resolved = path.resolve(expandHomePrefix(value));
    return DESKTOP_TEMP_INSTANCE_PATH_RE.test(resolved) && !fs.existsSync(resolved);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsBrokenDesktopTempPath(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some((entry) => containsBrokenDesktopTempPath(entry));
  }
  return false;
}

function isBrokenDesktopTempConfig(candidate: string): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(candidate, "utf8")) as unknown;
    return containsBrokenDesktopTempPath(raw);
  } catch {
    return false;
  }
}

function findConfigFileFromAncestors(startDir: string): string | null {
  const absoluteStartDir = path.resolve(startDir);
  let currentDir = absoluteStartDir;

  while (true) {
    const candidate = path.resolve(currentDir, ".paperclip", PAPERCLIP_CONFIG_BASENAME);
    if (fs.existsSync(candidate)) {
      if (!isBrokenDesktopTempConfig(candidate)) {
        return candidate;
      }
    }

    const nextDir = path.resolve(currentDir, "..");
    if (nextDir === currentDir) break;
    currentDir = nextDir;
  }

  return null;
}

export function resolvePaperclipConfigPath(overridePath?: string): string {
  if (overridePath) return path.resolve(overridePath);
  if (process.env.PAPERCLIP_CONFIG) return path.resolve(process.env.PAPERCLIP_CONFIG);
  return findConfigFileFromAncestors(process.cwd()) ?? resolveDefaultConfigPath();
}

export function resolvePaperclipEnvPath(overrideConfigPath?: string): string {
  return path.resolve(path.dirname(resolvePaperclipConfigPath(overrideConfigPath)), PAPERCLIP_ENV_FILENAME);
}

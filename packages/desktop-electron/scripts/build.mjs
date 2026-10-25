#!/usr/bin/env node

import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { collectDesktopLocales } from "./desktop-locales.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, "..");
const distDir = path.resolve(packageDir, "dist");

function parseProfile(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--profile") {
      return argv[index + 1] ?? "dev";
    }
    if (arg.startsWith("--profile=")) {
      return arg.slice("--profile=".length);
    }
  }

  return process.env.PAPERCLIP_DESKTOP_BUILD_PROFILE?.trim() || "dev";
}

function getEntryPoints() {
  return {
    main: path.resolve(packageDir, "src", "main.ts"),
    preload: path.resolve(packageDir, "src", "preload.ts"),
    runtime: path.resolve(packageDir, "src", "runtime.ts"),
    "server-worker": path.resolve(packageDir, "src", "server-worker.ts"),
  };
}

async function run() {
  const profile = parseProfile(process.argv.slice(2));
  const isRelease = profile === "release";

  if (!["dev", "release"].includes(profile)) {
    throw new Error(`Unsupported desktop build profile: ${profile}`);
  }

  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  await build({
    absWorkingDir: packageDir,
    bundle: true,
    entryPoints: getEntryPoints(),
    entryNames: "[name]",
    external: ["electron", "custom-electron-titlebar", "custom-electron-titlebar/main"],
    format: "esm",
    legalComments: "none",
    logLevel: "info",
    minify: isRelease,
    outdir: distDir,
    platform: "node",
    sourcemap: isRelease ? false : "external",
    splitting: false,
    target: "node20",
    treeShaking: true,
  });

  cpSync(path.resolve(packageDir, "src", "titlebar.theme.json"), path.resolve(distDir, "titlebar.theme.json"));
  cpSync(path.resolve(packageDir, "assets", "icon.png"), path.resolve(distDir, "icon.png"));
  writeFileSync(path.join(distDir, "desktop-locales.json"),
    JSON.stringify(collectDesktopLocales(path.resolve(packageDir, "../..")), null, 2) + "\n");
}

void run().catch((error) => {
  console.error("[desktop-build] Failed:", error);
  process.exitCode = 1;
});

import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(packageDir, "src", "server");
const outputDir = path.join(packageDir, "dist", "server");
const assets = ["codex-auth-merge-decision.cjs", "codex-auth-merge-extract.sh"];

await mkdir(outputDir, { recursive: true });
await Promise.all(
  assets.map((asset) => copyFile(path.join(sourceDir, asset), path.join(outputDir, asset))),
);

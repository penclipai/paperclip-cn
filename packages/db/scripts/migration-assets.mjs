import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function copyMigrationAssets(root = packageRoot) {
  const sourceMigrations = path.join(root, "src", "migrations");
  const destinationMigrations = path.join(root, "dist", "migrations");
  const destinationMeta = path.join(destinationMigrations, "meta");

  await rm(destinationMigrations, { recursive: true, force: true });
  await mkdir(destinationMeta, { recursive: true });

  const entries = await readdir(sourceMigrations, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => cp(path.join(sourceMigrations, entry.name), path.join(destinationMigrations, entry.name))),
  );
  await cp(
    path.join(sourceMigrations, "meta", "_journal.json"),
    path.join(destinationMeta, "_journal.json"),
  );
}

export async function pruneMigrationSnapshots(root = packageRoot) {
  const metaDirectory = path.join(root, "src", "migrations", "meta");
  const snapshots = (await readdir(metaDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith("_snapshot.json"))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  await Promise.all(snapshots.slice(5).map((name) => rm(path.join(metaDirectory, name), { force: true })));
}

async function main() {
  const command = process.argv[2];
  if (command === "copy") return copyMigrationAssets();
  if (command === "prune") return pruneMigrationSnapshots();
  throw new Error("Usage: node scripts/migration-assets.mjs <copy|prune>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}

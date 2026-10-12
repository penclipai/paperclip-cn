import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { copyMigrationAssets, pruneMigrationSnapshots } from "./migration-assets.mjs";

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-db-assets-"));
  await mkdir(path.join(root, "src", "migrations", "meta"), { recursive: true });
  await writeFile(path.join(root, "src", "migrations", "0001_first.sql"), "SELECT 1;");
  await writeFile(path.join(root, "src", "migrations", "ignored.txt"), "ignored");
  await writeFile(path.join(root, "src", "migrations", "meta", "_journal.json"), "{\"entries\":[]}");
  return root;
}

test("copies SQL migrations and the journal without snapshot history", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  await copyMigrationAssets(root);

  assert.equal(await readFile(path.join(root, "dist", "migrations", "0001_first.sql"), "utf8"), "SELECT 1;");
  assert.equal(await readFile(path.join(root, "dist", "migrations", "meta", "_journal.json"), "utf8"), "{\"entries\":[]}");
  await assert.rejects(readFile(path.join(root, "dist", "migrations", "ignored.txt"), "utf8"));
});

test("keeps the five newest snapshot names in lexical migration order", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const meta = path.join(root, "src", "migrations", "meta");
  await Promise.all(Array.from({ length: 7 }, (_, index) => writeFile(
    path.join(meta, `${String(index + 1).padStart(4, "0")}_snapshot.json`),
    "{}",
  )));

  await pruneMigrationSnapshots(root);

  const remaining = (await readdir(meta))
    .filter((name) => name.endsWith("_snapshot.json"))
    .sort();
  assert.deepEqual(remaining, [
    "0003_snapshot.json",
    "0004_snapshot.json",
    "0005_snapshot.json",
    "0006_snapshot.json",
    "0007_snapshot.json",
  ]);
});

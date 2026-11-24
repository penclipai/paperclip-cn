import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, test } from "node:test";
import { pruneStagedBundledPluginUiSourceMaps } from "./bundled-plugin-ui-sourcemaps.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("prunes only staged first-party plugin UI maps with matching counterparts", async () => {
  const root = await mkdtemp(join(tmpdir(), "paperclip-plugin-ui-maps-"));
  roots.push(root);
  const sourceUi = join(root, "source", "dist", "ui");
  const sourceServer = join(root, "source", "server", "dist");
  const stagedRoot = join(root, "staged");
  const stagedUi = join(stagedRoot, "dist", "ui");
  const stagedServer = join(stagedRoot, "server", "dist");
  await mkdir(stagedRoot, { recursive: true });
  await writeFile(join(stagedRoot, "package.json"), '{"type":"module"}\n');
  await mkdir(join(sourceUi, "nested", "node_modules", "third-party"), { recursive: true });
  await mkdir(sourceServer, { recursive: true });
  await mkdir(join(stagedUi, "nested", "node_modules", "third-party"), { recursive: true });
  await mkdir(stagedServer, { recursive: true });
  const files = new Map([
    ["index.js", "export const ready = true;\n//# sourceMappingURL=index.js.map\n"],
    ["index.js.map", "source map stays in the source package\n"],
    ["index.d.ts", "export declare const ready: boolean;\n//# sourceMappingURL=index.d.ts.map\n"],
    ["index.d.ts.map", "declaration map stays in the source package\n"],
    ["asset.svg", "<svg/>\n"],
    ["LICENSE", "runtime license\n"],
    ["orphan.js.map", "orphan must remain because its counterpart is absent\n"],
    ["missing.js", "export const missing = true;\n"],
    ["missing.js.map", "map stays without a source-map marker\n"],
    ["mismatch.js", "export const mismatch = true;\n//# sourceMappingURL=other.js.map\n"],
    ["mismatch.js.map", "map stays with a mismatched source-map marker\n"],
    ["alternate.js", "export const alternate = true;\n/*# sourceMappingURL=alternate.js.map */\n"],
    ["alternate.js.map", "map stays with an alternate source-map marker\n"],
    ["nontrailing.js", "//# sourceMappingURL=nontrailing.js.map\nexport const nontrailing = true;\n"],
    ["nontrailing.js.map", "map stays when the marker is not trailing\n"],
  ]);
  for (const [fileName, contents] of files) await writeFile(join(sourceUi, fileName), contents);
  await writeFile(join(sourceUi, "nested", "node_modules", "third-party", "index.js"), "export const thirdParty = true;\n//# sourceMappingURL=index.js.map\n");
  await writeFile(join(sourceUi, "nested", "node_modules", "third-party", "index.js.map"), "third-party map stays\n");
  await writeFile(join(sourceServer, "server.js"), "server runtime stays\n");
  await mkdir(join(sourceUi, "nested"), { recursive: true });
  await writeFile(join(sourceUi, "nested", "chunk[1].js"), "export const chunk = true;\n//# sourceMappingURL=chunk[1].js.map\n");
  await writeFile(join(sourceUi, "nested", "chunk[1].js.map"), "punctuated map stays in source\n");
  for (const [fileName] of files) await writeFile(join(stagedUi, fileName), await readFile(join(sourceUi, fileName)));
  await writeFile(join(stagedServer, "server.js"), await readFile(join(sourceServer, "server.js")));
  for (const fileName of ["index.js", "index.js.map"]) {
    await writeFile(join(stagedUi, "nested", "node_modules", "third-party", fileName), await readFile(join(sourceUi, "nested", "node_modules", "third-party", fileName)));
  }
  await mkdir(join(stagedUi, "nested"), { recursive: true });
  for (const fileName of ["chunk[1].js", "chunk[1].js.map"]) {
    await writeFile(join(stagedUi, "nested", fileName), await readFile(join(sourceUi, "nested", fileName)));
  }
  const outsideMap = join(root, "outside.js.map");
  await writeFile(outsideMap, "outside map must not be reached\n");
  await writeFile(join(stagedUi, "linked.js"), "export const linked = true;\n//# sourceMappingURL=linked.js.map\n");
  await symlink(outsideMap, join(stagedUi, "linked.js.map"), "file");

  assert.equal((await lstat(join(stagedUi, "index.js.map"))).isFile(), true);
  assert.equal((await readFile(join(stagedUi, "index.js"), "utf8")).includes("sourceMappingURL"), true);

  const removed = pruneStagedBundledPluginUiSourceMaps(stagedRoot);

  assert.deepEqual(removed.sort(), ["chunk[1].js.map", "index.d.ts.map", "index.js.map"]);
  assert.equal((await readFile(join(sourceUi, "index.js.map"), "utf8")).includes("source map stays"), true);
  await assert.rejects(lstat(join(stagedUi, "index.js.map")), { code: "ENOENT" });
  assert.equal((await readFile(join(stagedUi, "index.js"), "utf8")).includes("sourceMappingURL"), false);
  assert.equal((await readFile(join(stagedUi, "index.d.ts"), "utf8")).includes("sourceMappingURL"), false);
  assert.equal((await readFile(join(stagedUi, "index.js"), "utf8")).includes("export const ready = true"), true);
  assert.equal((await import(`${pathToFileURL(join(stagedUi, "index.js")).href}?cache-bust=1`)).ready, true);
  assert.equal((await readFile(join(stagedUi, "index.d.ts"), "utf8")).includes("export declare const ready"), true);
  assert.equal(await readFile(join(stagedUi, "asset.svg"), "utf8"), "<svg/>\n");
  assert.equal(await readFile(join(stagedUi, "LICENSE"), "utf8"), "runtime license\n");
  assert.equal(await readFile(join(stagedServer, "server.js"), "utf8"), "server runtime stays\n");
  assert.equal((await readFile(join(stagedUi, "nested", "chunk[1].js"), "utf8")).includes("sourceMappingURL"), false);
  assert.equal(await readFile(join(stagedUi, "orphan.js.map"), "utf8"), "orphan must remain because its counterpart is absent\n");
  for (const fileName of ["missing", "mismatch", "alternate", "nontrailing"]) {
    assert.equal(
      await readFile(join(stagedUi, `${fileName}.js`), "utf8"),
      await readFile(join(sourceUi, `${fileName}.js`), "utf8"),
      `${fileName} source must remain byte-for-byte unchanged`,
    );
    assert.equal(
      await readFile(join(stagedUi, `${fileName}.js.map`), "utf8"),
      await readFile(join(sourceUi, `${fileName}.js.map`), "utf8"),
      `${fileName} map must remain byte-for-byte unchanged`,
    );
  }
  assert.equal((await readFile(join(stagedUi, "nested", "node_modules", "third-party", "index.js"), "utf8")).includes("sourceMappingURL"), true);
  assert.equal(await readFile(join(stagedUi, "nested", "node_modules", "third-party", "index.js.map"), "utf8"), "third-party map stays\n");
  assert.equal((await lstat(join(stagedUi, "linked.js.map"))).isSymbolicLink(), true);
  assert.equal(await readFile(outsideMap, "utf8"), "outside map must not be reached\n");
});

test("refuses a staged UI directory reached through a symlinked dist ancestor", async () => {
  const root = await mkdtemp(join(tmpdir(), "paperclip-plugin-ui-symlink-"));
  roots.push(root);
  const stagedRoot = join(root, "staged");
  const externalDist = join(root, "external-dist");
  const externalUi = join(externalDist, "ui");
  await mkdir(stagedRoot, { recursive: true });
  await mkdir(externalUi, { recursive: true });
  await writeFile(join(externalUi, "index.js"), "export const external = true;\n//# sourceMappingURL=index.js.map\n");
  await writeFile(join(externalUi, "index.js.map"), "external map must remain\n");
  await symlink(externalDist, join(stagedRoot, "dist"), "junction");

  assert.deepEqual(pruneStagedBundledPluginUiSourceMaps(stagedRoot), []);
  assert.equal(await readFile(join(externalUi, "index.js.map"), "utf8"), "external map must remain\n");
  assert.equal((await readFile(join(externalUi, "index.js"), "utf8")).includes("sourceMappingURL"), true);
});

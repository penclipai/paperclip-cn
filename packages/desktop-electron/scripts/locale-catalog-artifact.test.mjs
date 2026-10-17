import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildCatalog,
  checkCatalog,
  englishHash,
} from "../../../scripts/i18n-catalog.mjs";

test("rejects stale catalogs in the final desktop runtime layout", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "paperclip-desktop-locale-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const sourceDir = join(root, "ui", "locales-src", "semantic");
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(
    join(sourceDir, "domain-common.json"),
    `${JSON.stringify({
      "common.save": {
        en: "Save",
        "zh-CN": "保存",
        reviewedEnglishHash: englishHash("Save"),
      },
    }, null, 2)}\n`,
    "utf8",
  );

  await buildCatalog({ root });
  const artifactRoot = join(
    root,
    "packages",
    "desktop-electron",
    "release",
    "win-unpacked",
    "resources",
    "app-runtime",
    "server",
    "ui-dist",
    "locales",
  );
  cpSync(join(root, "ui", "public", "locales"), artifactRoot, { recursive: true });

  await checkCatalog({ root, artifactRoot });

  const enCatalog = join(artifactRoot, "en", "common.json");
  writeFileSync(enCatalog, '{\n  "common.save": "STALE"\n}\n', "utf8");
  await assert.rejects(checkCatalog({ root, artifactRoot }), /catalog artifact out of date/);
});

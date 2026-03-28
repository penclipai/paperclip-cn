import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const localeFiles = [
  path.resolve(currentDir, "../../public/locales/en/common.json"),
  path.resolve(currentDir, "../../public/locales/zh-CN/common.json"),
];

function findDuplicateKeys(text: string): string[] {
  const keyPattern = /^\s*"([^"]+)":/gm;
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = keyPattern.exec(text)) !== null) {
    const key = match[1];
    if (seen.has(key)) {
      duplicates.add(key);
      continue;
    }
    seen.add(key);
  }

  return [...duplicates].sort((left, right) => left.localeCompare(right));
}

describe("locale catalogs", () => {
  for (const localeFile of localeFiles) {
    it(`keeps ${path.basename(path.dirname(localeFile))} free of duplicate keys`, () => {
      const text = readFileSync(localeFile, "utf8");

      expect(() => JSON.parse(text)).not.toThrow();
      expect(findDuplicateKeys(text)).toEqual([]);
    });
  }
});

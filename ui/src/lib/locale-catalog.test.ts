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

function readLocaleMessages(locale: "en" | "zh-CN"): Record<string, string> {
  const localeFile = localeFiles.find((file) => path.basename(path.dirname(file)) === locale);
  if (!localeFile) {
    throw new Error(`Missing locale file for ${locale}`);
  }
  return JSON.parse(readFileSync(localeFile, "utf8")) as Record<string, string>;
}

describe("locale catalogs", () => {
  for (const localeFile of localeFiles) {
    it(`keeps ${path.basename(path.dirname(localeFile))} free of duplicate keys`, () => {
      const text = readFileSync(localeFile, "utf8");

      expect(() => JSON.parse(text)).not.toThrow();
      expect(findDuplicateKeys(text)).toEqual([]);
    });
  }

  it("keeps recovery action card copy localized in zh-CN", () => {
    const en = readLocaleMessages("en");
    const zh = readLocaleMessages("zh-CN");
    const requiredKeys = [
      "issueRecoveryAction.state.needed",
      "issueRecoveryAction.kind.stranded_assigned_issue",
      "issueRecoveryAction.headline.stranded_assigned_issue",
      "issueRecoveryAction.metadata.nextAction",
      "issueRecoveryAction.wake.correctiveWakeQueued",
      "issueRecoveryAction.resolve.trigger",
      "recoveryChip.state.needed",
    ];

    for (const key of requiredKeys) {
      expect(en[key], `missing en key ${key}`).toBeTruthy();
      expect(zh[key], `missing zh-CN key ${key}`).toBeTruthy();
    }
    expect(zh["issueRecoveryAction.headline.stranded_assigned_issue"]).toContain("已重试");
    expect(zh["issueRecoveryAction.headline.stranded_assigned_issue"]).not.toBe(
      en["issueRecoveryAction.headline.stranded_assigned_issue"],
    );
  });

  it("keeps company settings and portability copy localized in zh-CN", () => {
    const en = readLocaleMessages("en");
    const zh = readLocaleMessages("zh-CN");
    const requiredKeys = [
      "companySettings.noCompanySelectedBody",
      "companySettings.interactionGovernance",
      "companySettings.governance.option.companyDefault",
      "companySettings.mibUnit",
      "companyImport.completedTitle",
      "companyImport.summaryLine",
      "companyImport.skillImportResults",
      "companyImport.activationPartialFailureTitle",
      "companyImport.requestDidNotComplete",
      "companyExport.selectionSummary",
      "companyExport.attachmentsRequireTasksOrRoutines",
      "companyExport.showMoreTasksSummary",
    ];

    for (const key of requiredKeys) {
      expect(en[key], `missing en key ${key}`).toBeTruthy();
      expect(zh[key], `missing zh-CN key ${key}`).toBeTruthy();
    }

    expect(zh["companySettings.interactionGovernance"]).not.toBe(
      en["companySettings.interactionGovernance"],
    );
    expect(zh["companyImport.completedTitle"]).not.toBe(
      en["companyImport.completedTitle"],
    );
  });
});

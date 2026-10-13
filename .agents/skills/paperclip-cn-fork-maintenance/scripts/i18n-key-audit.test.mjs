import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { buildSnapshot, compareSnapshots, runCli } from "./i18n-key-audit.mjs";

async function withFixture(files, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-i18n-audit-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = path.join(root, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content);
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function baseFiles({ en, zh, source = "" }) {
  return {
    "ui/public/locales/en/common.json": JSON.stringify(en, null, 2),
    "ui/public/locales/zh-CN/common.json": JSON.stringify(zh, null, 2),
    "ui/src/i18n.ts": "export function translateInstant(key) { return key; }",
    "ui/src/App.tsx": source,
  };
}

test("snapshot records locale definitions and static key usages", async () => {
  await withFixture(
    baseFiles({
      en: {
        "common.ok": "OK",
        "common.cancel": "Cancel",
        "common.unused": "Unused",
      },
      zh: {
        "common.ok": "确定",
        "common.cancel": "取消",
        "common.unused": "未使用",
      },
      source: `
        import { translateInstant } from "./i18n";
        import { useTranslation } from "react-i18next";
        export function App({ dynamicKey }) {
          const { t } = useTranslation();
          return t("common.ok") + translateInstant("common.cancel") + t(dynamicKey);
        }
      `,
    }),
    async (root) => {
      const snapshot = await buildSnapshot({ root });

      assert.equal(snapshot.summary.keyCount, 3);
      assert.equal(snapshot.summary.unusedKeyCount, 1);
      assert.deepEqual(snapshot.unusedKeys, ["common.unused"]);
      assert.equal(snapshot.keys["common.ok"].definitions.en.value, "OK");
      assert.equal(snapshot.keys["common.ok"].definitions["zh-CN"].value, "确定");
      assert.equal(snapshot.keys["common.ok"].usageCount, 1);
      assert.equal(snapshot.keys["common.cancel"].usageCount, 1);
      assert.equal(snapshot.dynamicTranslationCallWarnings.length, 1);
      assert.equal(snapshot.dynamicTranslationCallWarnings[0].expression, "dynamicKey");
    },
  );
});

test("snapshot reports duplicate keys and locale parity gaps", async () => {
  await withFixture(
    {
      "ui/public/locales/en/common.json": `{
        "common.ok": "OK",
        "common.onlyEnglish": "Only English"
      }`,
      "ui/public/locales/zh-CN/common.json": `{
        "common.ok": "确定",
        "common.ok": "好的"
      }`,
      "ui/src/App.tsx": `export const label = "common.onlyEnglish";`,
    },
    async (root) => {
      const snapshot = await buildSnapshot({ root });

      assert.equal(snapshot.duplicates.length, 1);
      assert.equal(snapshot.duplicates[0].locale, "zh-CN");
      assert.equal(snapshot.duplicates[0].key, "common.ok");
      assert.deepEqual(snapshot.parity.missingByLocale["zh-CN"], ["common.onlyEnglish"]);
      assert.equal(snapshot.keys["common.onlyEnglish"].usageCount, 1);
    },
  );
});

test("snapshot scopes duplicate keys to the same JSON object", async () => {
  await withFixture(
    baseFiles({
      en: {
        common: {
          ok: "OK",
        },
        dialog: {
          ok: "OK",
        },
      },
      zh: {
        common: {
          ok: "确定",
        },
        dialog: {
          ok: "好的",
        },
      },
      source: `export const label = "common.ok";`,
    }),
    async (root) => {
      const snapshot = await buildSnapshot({ root });

      assert.equal(snapshot.duplicates.length, 0);
      assert.equal(snapshot.keys["common.ok"].usageCount, 1);
      assert.equal(snapshot.keys["dialog.ok"].usageCount, 0);
    },
  );
});

test("snapshot treats i18next plural variants as used through the base key", async () => {
  await withFixture(
    baseFiles({
      en: {
        "companies.agentCount": "{{count}} agents",
        "companies.agentCount_one": "{{count}} agent",
        "companies.agentCount_other": "{{count}} agents",
      },
      zh: {
        "companies.agentCount": "{{count}} 个智能体",
        "companies.agentCount_one": "{{count}} 个智能体",
        "companies.agentCount_other": "{{count}} 个智能体",
      },
      source: `
        import { useTranslation } from "react-i18next";
        export function AgentCount() {
          const { t } = useTranslation();
          return t("companies.agentCount", { count: 2 });
        }
      `,
    }),
    async (root) => {
      const snapshot = await buildSnapshot({ root });

      assert.equal(snapshot.keys["companies.agentCount"].usageCount, 1);
      assert.equal(snapshot.keys["companies.agentCount_one"].usageCount, 1);
      assert.equal(snapshot.keys["companies.agentCount_other"].usageCount, 1);
      assert.equal(snapshot.keys["companies.agentCount_one"].usages[0].context.matchKind, "i18next-variant");
      assert.equal(snapshot.keys["companies.agentCount_one"].usages[0].context.matchedFrom, "companies.agentCount");
    },
  );
});

test("snapshot classifies imported translation bindings, aliases, and rejects unrelated or shadowed t calls", async () => {
  await withFixture(
    baseFiles({
      en: { "common.ok": "OK", "common.alias": "Alias" },
      zh: { "common.ok": "确定", "common.alias": "别名" },
      source: `
        import i18n from "i18next";
        import { translateInstant as instant } from "@/i18n";
        import { useTranslation as useT } from "react-i18next";
        const tar = { t(value: string) { return value; } };
        const unrelated = (value: string) => value;
        export function App() {
          const { t: translate } = useT();
          const used = [i18n.t("common.ok"), instant("common.alias"), translate("common.ok")];
          const ignored = [tar.t("common.alias"), unrelated("common.ok")];
          return { used, ignored };
        }
        export function Shadowed(t: (value: string) => string) { return t("common.ok"); }
      `,
    }),
    async (root) => {
      const snapshot = await buildSnapshot({ root });
      assert.equal(snapshot.keys["common.ok"].usageCount, 4);
      assert.equal(snapshot.keys["common.alias"].usageCount, 2);
      assert.equal(
        [
          ...snapshot.keys["common.ok"].usages,
          ...snapshot.keys["common.alias"].usages,
        ].filter((usage) => usage.context.kind === "translation-call").length,
        3,
      );
      assert.equal(snapshot.undefinedStaticTranslationCallFindings.length, 0);
      assert.equal(snapshot.dynamicTranslationCallWarnings.length, 0);
    },
  );
});

test("snapshot reports undefined static calls and dynamic calls only for proven translation bindings", async () => {
  await withFixture(
    baseFiles({
      en: { "common.ok": "OK" },
      zh: { "common.ok": "确定" },
      source: `
        import { translateInstant } from "@/i18n";
        import { useTranslation } from "react-i18next";
        const tar = { t(value: string) { return value; } };
        export function App({ dynamicKey }: { dynamicKey: string }) {
          const { t } = useTranslation();
          return [translateInstant("common.missing"), t(dynamicKey), tar.t("common.ignored")];
        }
      `,
    }),
    async (root) => {
      const snapshot = await buildSnapshot({ root });
      assert.deepEqual(snapshot.undefinedStaticTranslationCallFindings.map((finding) => finding.key), ["common.missing"]);
      assert.equal(snapshot.dynamicTranslationCallWarnings.length, 1);
      assert.equal(snapshot.dynamicTranslationCallWarnings[0].binding, "hook:t");
    },
  );
});

test("snapshot keeps the upstream translation resource scope separate from common", async () => {
  await withFixture(
    {
      ...baseFiles({
        en: { "common.ok": "OK" },
        zh: { "common.ok": "确定" },
        source: `import { t as legacyTranslate } from "./i18n/index"; export const label = legacyTranslate("app.noCompanies.title");`,
      }),
      "ui/src/i18n/locales/en.json": JSON.stringify({ app: { noCompanies: { title: "Create" } } }),
      "ui/src/i18n/locales/zh-CN.json": JSON.stringify({ app: { noCompanies: { title: "创建" } } }),
      "ui/src/i18n/index.ts": "export function t(key) { return key; }",
    },
    async (root) => {
      const snapshot = await buildSnapshot({ root });
      assert.equal(snapshot.catalogs.translation.keyCount, 1);
      assert.equal(snapshot.undefinedStaticTranslationCallFindings.length, 0);
      assert.equal(snapshot.keys["app.noCompanies.title"], undefined);
    },
  );
});

test("snapshot honors explicit common and translation namespace selectors without blocking dynamic namespaces", async () => {
  await withFixture(
    {
      ...baseFiles({
        en: { "common.ok": "OK" },
        zh: { "common.ok": "确定" },
        source: `
          import i18n from "i18next";
          import { useTranslation } from "react-i18next";
          export function App(namespace: string) {
            const { t: translationT } = useTranslation("translation");
            const { t: dynamicT } = useTranslation(namespace);
            return [
              translationT("app.noCompanies.title"),
              i18n.t("app.noCompanies.title", { ns: "translation" }),
              i18n.t("app.unknown", { ns: namespace }),
              dynamicT("app.dynamic"),
            ];
          }
        `,
      }),
      "ui/src/i18n/locales/en.json": JSON.stringify({ app: { noCompanies: { title: "Create" } } }),
      "ui/src/i18n/locales/zh-CN.json": JSON.stringify({ app: { noCompanies: { title: "创建" } } }),
    },
    async (root) => {
      const snapshot = await buildSnapshot({ root });
      assert.equal(snapshot.undefinedStaticTranslationCallFindings.length, 0);
      assert.equal(snapshot.unresolvedTranslationCallWarnings.length, 2);
      assert.deepEqual(snapshot.unresolvedTranslationCallWarnings.map((warning) => warning.namespace), ["namespace", "namespace"]);
    },
  );
});

test("snapshot resolves only known relative i18n modules and honors nested local bindings", async () => {
  await withFixture(
    {
      ...baseFiles({
        en: { "common.ok": "OK" },
        zh: { "common.ok": "确定" },
        source: `
          import { t } from "./utils";
          import { translateInstant as translate } from "@/i18n";
          import i18n from "i18next";
          export function App() {
            { const translate = (key: string) => key; translate("common.local"); }
            { const i18n = { t: (key: string) => key }; i18n.t("common.instance-local"); }
            function translate(key: string) { return key; }
            function i18n() { return "not an instance"; }
            return [t("common.utility"), translate("common.function-local"), i18n.t("common.function-instance")];
          }
        `,
      }),
      "ui/src/utils.ts": "export function t(key) { return key; }",
    },
    async (root) => {
      const snapshot = await buildSnapshot({ root });
      assert.equal(snapshot.undefinedStaticTranslationCallFindings.length, 0);
      assert.equal(snapshot.dynamicTranslationCallWarnings.length, 0);
    },
  );
});

test("snapshot recognizes server translate and request wrappers at their key argument", async () => {
  await withFixture(
    {
      ...baseFiles({
        en: { "common.ok": "OK" },
        zh: { "common.ok": "确定" },
        source: "",
      }),
      "server/src/i18n.ts": "export function translate(locale, key) { return key; }",
      "server/src/request-localization.ts": "export function translateRequest(req, key) { return key; }",
      "server/src/example.ts": `
        import { translate as serverTranslate } from "./i18n.js";
        import { translateRequest } from "./request-localization.js";
        export function localize(req, locale, dynamicKey) {
          return [serverTranslate(locale, "common.ok"), serverTranslate(locale, dynamicKey), translateRequest(req, "common.missing")];
        }
      `,
    },
    async (root) => {
      const snapshot = await buildSnapshot({ root });
      assert.equal(snapshot.keys["common.ok"].usages[0].context.kind, "translation-call");
      assert.deepEqual(snapshot.undefinedStaticTranslationCallFindings.map((finding) => finding.key), ["common.missing"]);
      assert.equal(snapshot.dynamicTranslationCallWarnings.length, 1);
      assert.equal(snapshot.dynamicTranslationCallWarnings[0].expression, "dynamicKey");
    },
  );
});

test("compare fails only undefined static calls introduced after the baseline", () => {
  const before = { summary: {}, keys: {}, duplicates: [], undefinedStaticTranslationCallFindings: [{ catalog: "common", key: "old", file: "ui/src/A.tsx", binding: "import:t", callee: "t" }] };
  const after = { summary: {}, keys: {}, duplicates: [], undefinedStaticTranslationCallFindings: [
    { catalog: "common", key: "old", file: "ui/src/A.tsx", binding: "import:t", callee: "t", line: 10 },
    { catalog: "common", key: "new", file: "ui/src/B.tsx", binding: "hook:t", callee: "t", line: 12 },
  ] };
  const comparison = compareSnapshots(before, after);
  assert.deepEqual(comparison.newUndefinedStaticTranslationCalls.map((finding) => finding.key), ["new"]);
  assert.equal(comparison.failures.filter((failure) => failure.type === "undefined-static-translation-call").length, 1);
});

test("compare marks old snapshots without undefined-call evidence as baseline unavailable", () => {
  const before = { version: 1, summary: {}, keys: {}, duplicates: [] };
  const after = {
    version: 2,
    summary: {},
    keys: {},
    duplicates: [],
    undefinedStaticTranslationCallFindings: [{ catalog: "common", key: "legacy", file: "ui/src/A.tsx", binding: "import:t", callee: "t" }],
  };
  const comparison = compareSnapshots(before, after);
  assert.equal(comparison.summary.undefinedStaticTranslationCallBaselineUnavailable, true);
  assert.equal(comparison.summary.undefinedStaticTranslationCallCount, 1);
  assert.equal(comparison.newUndefinedStaticTranslationCalls.length, 0);
  assert.equal(comparison.failures.filter((failure) => failure.type === "undefined-static-translation-call").length, 0);
});

test("compare detects removed keys, new parity gaps, usage changes, duplicates, and zh-CN fallback", () => {
  const before = {
    summary: { generatedAt: "before", keyCount: 3 },
    keys: {
      "common.kept": {
        usageCount: 1,
        definitions: {
          en: { value: "Kept" },
          "zh-CN": { value: "保留" },
        },
      },
      "common.removed": {
        usageCount: 0,
        definitions: {
          en: { value: "Removed" },
          "zh-CN": { value: "已移除" },
        },
      },
      "common.rollback": {
        usageCount: 1,
        definitions: {
          en: { value: "Retry" },
          "zh-CN": { value: "重试" },
        },
      },
    },
    duplicates: [],
  };
  const after = {
    summary: { generatedAt: "after", keyCount: 3 },
    keys: {
      "common.kept": {
        usageCount: 3,
        definitions: {
          en: { value: "Kept" },
          "zh-CN": { value: "保留" },
        },
      },
      "common.newMissing": {
        usageCount: 0,
        definitions: {
          en: { value: "New" },
        },
      },
      "common.rollback": {
        usageCount: 1,
        definitions: {
          en: { value: "Retry" },
          "zh-CN": { value: "Retry" },
        },
      },
    },
    duplicates: [{ locale: "en", key: "common.kept" }],
  };

  const comparison = compareSnapshots(before, after);

  assert.deepEqual(comparison.removedKeys, ["common.removed"]);
  assert.deepEqual(comparison.newMissingParity, [{ key: "common.newMissing", locale: "zh-CN" }]);
  assert.deepEqual(comparison.usageChanges, [{ key: "common.kept", before: 1, after: 3, delta: 2 }]);
  assert.equal(comparison.duplicateKeys.length, 1);
  assert.equal(comparison.suspiciousZhFallbacks[0].key, "common.rollback");
  assert.equal(comparison.failures.length, 6);
});

test("snapshot CLI writes JSON and exits non-zero on duplicate keys", async () => {
  await withFixture(
    {
      "ui/public/locales/en/common.json": `{
        "common.ok": "OK"
      }`,
      "ui/public/locales/zh-CN/common.json": `{
        "common.ok": "确定",
        "common.ok": "好的"
      }`,
      "ui/src/App.tsx": `export const label = "common.ok";`,
    },
    async (root) => {
      const output = path.join(root, ".omx/i18n-key-audit/current.json");
      const exitCode = await runCli(["snapshot", "--root", root, "--out", output]);
      const snapshot = JSON.parse(await readFile(output, "utf8"));

      assert.equal(exitCode, 1);
      assert.equal(snapshot.duplicates.length, 1);
      assert.equal(snapshot.keys["common.ok"].usageCount, 1);
    },
  );
});

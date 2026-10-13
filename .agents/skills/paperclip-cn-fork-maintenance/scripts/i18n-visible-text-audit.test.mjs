import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { buildVisibleTextInventory, runCli } from "./i18n-visible-text-audit.mjs";

async function withFixture(files, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-visible-text-audit-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const file = path.join(root, relativePath);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("finds raw JSX text, visible attributes, branches, templates, and display configs", async () => {
  await withFixture(
    {
      "ui/src/Example.tsx": `
        export function Example({ busy, provider }) {
          const config = { label: "Run now", title: "Run title", description: "Runs the action" };
          const protocolState = busy ? "ready" : "closed";
          return <main>
            Welcome back。！
            <button aria-label="Close dialog" placeholder="Search tasks" title="Open details">Open</button>
            {busy ? "Connecting…" : \`Connect \${provider.name}\`}
          </main>;
        }
      `,
    },
    async (root) => {
      const inventory = await buildVisibleTextInventory({ root });
      assert.equal(inventory.summary.fileCount, 1);
      assert.equal(inventory.summary.uncertainCandidateCount, 2);
      assert.deepEqual(
        inventory.candidates.map((candidate) => [candidate.kind, candidate.text]),
        [
          ["config:label", "Run now"],
          ["config:title", "Run title"],
          ["config:description", "Runs the action"],
          ["jsx-text", "Welcome back。！"],
          ["attribute:aria-label", "Close dialog"],
          ["attribute:placeholder", "Search tasks"],
          ["attribute:title", "Open details"],
          ["jsx-text", "Open"],
          ["conditional", "Connecting…"],
          ["template", "Connect ${provider.name}"],
        ],
      );
      assert.deepEqual(inventory.uncertainCandidates.map((candidate) => candidate.text), ["ready", "closed"]);
    },
  );
});

test("does not report translated calls or technical and non-visible values", async () => {
  await withFixture(
    {
      "ui/src/Example.tsx": `
        import { translateInstant } from "./i18n";
        export function Example() {
          const className = "flex items-center";
          const endpoint = "https://example.test/api";
          return <main className={className} id="dialog-root" style={{ color: "red" }}>
            <code>pnpm install</code>
            <a href={endpoint}>https://example.test/docs</a>
            <button>{translateInstant("common.save", { defaultValue: "Save" })}</button>
            <button>{t("common.cancel")}</button>
          </main>;
        }
      `,
      "ui/src/Example.test.tsx": `export const testCopy = <div>Test only</div>;`,
      "ui/src/FooUxLab.tsx": `export const Example = () => <div>Lab only</div>;`,
      "ui/src/DesignGuide.tsx": `export const Example = () => <div>Guide only</div>;`,
      "ui/src/ChineseOnly.tsx": `export const Example = () => <div>仅中文……</div>;`,
      "ui/src/Uppercase.tsx": `export const Example = () => <button>OK</button>;`,
    },
    async (root) => {
      const inventory = await buildVisibleTextInventory({ root });
      assert.deepEqual(inventory.candidates.map((candidate) => candidate.text), ["OK"]);
      assert.equal(inventory.summary.excludedFileCount, 3);
    },
  );
});

test("CLI writes the requested inventory", async () => {
  await withFixture(
    { "ui/src/Example.tsx": `export const Example = () => <p>Hello</p>;` },
    async (root) => {
      const out = path.join(root, "reports", "inventory.json");
      const result = await runCli(["--root", root, "--out", out]);
      assert.equal(result.summary.candidateCount, 1);
      const saved = JSON.parse(await (await import("node:fs/promises")).readFile(out, "utf8"));
      assert.equal(saved.candidates[0].text, "Hello");
    },
  );
});

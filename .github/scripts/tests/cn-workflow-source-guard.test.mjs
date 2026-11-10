import assert from "node:assert/strict";
import test from "node:test";

import { verifyWorkflowSourceUpdate } from "../cn-workflow-source-guard.mjs";

const oldSha = "a".repeat(40);
const newSha = "b".repeat(40);
const baseSha = "c".repeat(40);
const paths = [
  ".github/workflows/pr-trusted.yml",
  ".github/workflows/ci-routing.yml",
  ".github/scripts/cn-workflow-source-guard.mjs",
  ".github/scripts/tests/cn-workflow-source-guard.test.mjs",
  ".github/scripts/tests/cn-workflow-identity.test.mjs",
  ".github/scripts/cn-workflow-review-context.mjs",
  ".github/scripts/tests/cn-workflow-review-context.test.mjs",
];
const callerFor = (sha) => [
  "jobs:",
  "  ci:",
  `    uses: penclipai/paperclip-cn/.github/workflows/pr-trusted.yml@${sha}`,
  "",
].join("\n");
const sources = (prefix) => Object.fromEntries(paths.map((path) => [path, `${prefix}:${path}\n`]));

function gate({
  base = baseSha,
  baseCaller = callerFor(oldSha),
  caller = baseCaller,
  currentFiles = sources("candidate"),
  files = new Map([
    [`${oldSha}:.github/workflows/pr-trusted.yml`, "jobs:\n"],
  ]),
  ancestry = new Set([`${oldSha}:${baseSha}`, `${newSha}:${baseSha}`]),
  readAt,
  isAncestor,
} = {}) {
  return verifyWorkflowSourceUpdate({
    baseSha: base,
    baseCaller,
    caller,
    currentFiles,
    readAt: readAt ?? ((sha, path) => files.get(`${sha}:${path}`)),
    isAncestor: isAncestor ?? ((ancestor, descendant) => ancestry.has(`${ancestor}:${descendant}`)),
  });
}

test("accepts dormant source changes and unchanged callers", () => {
  const currentFiles = sources("proposed-change");
  const result = gate({ currentFiles });
  assert.equal(result.mode, "dormant-source");
  assert.equal(result.pinnedSha, oldSha);
  assert.equal(result.activeTrusted, "jobs:\n");
  assert.equal(result.activeRouting, null);
});

test("requires the active routing source when the active workflow delegates to it", () => {
  assert.throws(
    () => gate({ files: new Map([[`${oldSha}:.github/workflows/pr-trusted.yml`, "uses: ./.github/workflows/ci-routing.yml\n"]]) }),
    /trusted workflow source is unavailable/,
  );
});

test("accepts a protected pin update with exactly matching source", () => {
  const currentFiles = sources("new");
  const files = new Map([
    [`${oldSha}:.github/workflows/pr-trusted.yml`, "jobs:\n"],
    ...Object.entries(currentFiles).map(([path, source]) => [`${newSha}:${path}`, source]),
  ]);
  const result = gate({ caller: callerFor(newSha), currentFiles, files });
  assert.equal(result.mode, "protected-pin-update");
  assert.equal(result.pinnedSha, newSha);
});

test("treats CRLF-only differences as equal", () => {
  const currentFiles = sources("new");
  const files = new Map([
    [`${oldSha}:.github/workflows/pr-trusted.yml`, "jobs:\r\n"],
    ...Object.entries(currentFiles).map(([path, source]) => [`${newSha}:${path}`, source.replaceAll("\n", "\r\n")]),
  ]);
  const result = gate({
    baseCaller: callerFor(oldSha).replaceAll("\n", "\r\n"),
    caller: callerFor(newSha),
    currentFiles,
    files,
  });
  assert.equal(result.mode, "protected-pin-update");
});

test("fails closed for malformed, mutable, foreign, or ambiguous caller references", () => {
  for (const caller of [
    "jobs:\n",
    callerFor("main"),
    callerFor(oldSha).replace("penclipai/paperclip-cn", "paperclipai/paperclip"),
    `${callerFor(oldSha)}    uses: penclipai/paperclip-cn/.github/workflows/pr-trusted.yml@${newSha}\n`,
  ]) {
    assert.throws(() => gate({ caller }), /Workflow source guard/);
  }
});

test("fails closed for invalid base SHA, ancestry, and extra caller edits", () => {
  assert.throws(() => gate({ base: "c".repeat(39) }), /approved base SHA/);
  assert.throws(() => gate({ baseCaller: callerFor("A".repeat(40)) }), /immutable trusted fork/);
  assert.throws(() => gate({ caller: false }), /caller source is unavailable/);
  assert.throws(() => gate({ caller: callerFor(oldSha).replace("ci:", "changed:") }), /without rotating/);
  assert.throws(() => gate({ caller: `${callerFor(newSha)}# extra\n` }), /only replace/);
  assert.throws(() => gate({ ancestry: new Set() }), /not an ancestor/);
  assert.throws(() => gate({ caller: callerFor(newSha), ancestry: new Set([`${oldSha}:${baseSha}`]) }), /not an ancestor/);
});

test("fails closed when protected source is missing, changed, or unreadable", () => {
  const currentFiles = sources("new");
  const files = new Map([
    [`${oldSha}:.github/workflows/pr-trusted.yml`, "jobs:\n"],
    ...Object.entries(currentFiles).map(([path, source]) => [`${newSha}:${path}`, source]),
  ]);
  for (const path of paths) {
    const changed = { ...currentFiles, [path]: `${currentFiles[path]}changed` };
    assert.throws(() => gate({ caller: callerFor(newSha), currentFiles: changed, files }), /does not match/);
  }
  const missingPinnedSource = new Map(files);
  missingPinnedSource.delete(`${newSha}:${paths[0]}`);
  assert.throws(
    () => gate({ caller: callerFor(newSha), currentFiles, files: missingPinnedSource }),
    /source is unavailable/,
  );
  assert.throws(() => gate({ caller: callerFor(newSha), currentFiles: { ...currentFiles, [paths[0]]: undefined }, files }), /incomplete/);
  assert.throws(() => gate({ readAt: () => { throw new Error("untrusted detail"); } }), /could not be read/);
  assert.throws(() => gate({ readAt: false }), /trusted git callbacks/);
  assert.throws(() => gate({ isAncestor: () => { throw new Error("untrusted detail"); } }), /could not be verified/);
});

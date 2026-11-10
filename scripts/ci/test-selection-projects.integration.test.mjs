import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { selectProjects } from "./select-projects.mjs";
import { selectProjectTests } from "./vitest-selection-graph.mjs";

test("absolute setup paths are canonicalized and outside setup inputs fail closed", async t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "setup-paths-")));
  const outside = realpathSync(mkdtempSync(path.join(tmpdir(), "outside-setup-")));
  t.after(() => {
    for (const directory of [root, outside]) rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  symlinkSync(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
  mkdirSync(path.join(root, "ui"));
  const setup = path.join(root, "ui/setup.ts");
  writeFileSync(setup, "export const setup = true;");
  writeFileSync(path.join(root, "vitest.config.mjs"), 'export default {test:{projects:["ui"]}}');
  for (const name of ["one", "two"]) writeFileSync(path.join(root, `ui/${name}.test.ts`), 'throw new Error("selection must not execute tests");');
  const configure = (input, value) => writeFileSync(path.join(root, "ui/vitest.config.mjs"),
    `export default {test:{name:"fixture",include:["*.test.ts"],${input}:${JSON.stringify([value])}}}`);
  configure("setupFiles", setup.replaceAll(path.sep, "/"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  const options = { root, project: "fixture", changed: ["ui/setup.ts"] };
  const selected = await selectProjectTests(options);
  assert.equal(selected.setupChanged, true);
  assert.deepEqual(selected.selected, selected.inventory);
  assert.deepEqual(selected.coveredChanges, ["ui/setup.ts"]);
  const external = path.join(outside, "setup.mjs");
  writeFileSync(external, 'throw new Error("outside setup must never execute");');
  for (const input of ["setupFiles", "globalSetup", "snapshotSerializers"]) {
    configure(input, external.replaceAll(path.sep, "/"));
    await assert.rejects(selectProjectTests(options), /Setup module outside repository/);
  }
});

test("parallel project graphs preserve isolation, ordering and conservative selection", async t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "parallel-graphs-")));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  symlinkSync(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
  const write = (file, source) => writeFileSync(path.join(root, file), source);
  write(".gitignore", "node_modules/\n");
  write("vitest.config.mjs", 'export default {test:{projects:["one", "two"]}}');
  for (const name of ["one", "two"]) {
    mkdirSync(path.join(root, name));
    write(`${name}/vitest.config.mjs`, `export default {resolve:{alias:{"@leaf":${JSON.stringify(path.join(root, name, "leaf.ts"))}}},test:{name:${JSON.stringify(name)},include:["*.test.ts"]}}`);
    write(`${name}/leaf.ts`, "export const value = 1;");
    write(`${name}/leaf.test.ts`, 'import {value} from "@leaf"; throw new Error("must not execute tests " + value);');
    write(`${name}/opaque.test.ts`, 'import {readFileSync} from "node:fs"; readFileSync(process.env.INPUT);');
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  const options = { root, projects: ["two", "one"], changed: ["one/leaf.ts"] };
  const serial = await selectProjects({ ...options, concurrency: 1 });
  const parallel = await selectProjects({ ...options, concurrency: 2 });
  const stable = graphs => graphs.map(({ seconds, ...graph }) => graph);
  assert.deepEqual(stable(parallel), stable(serial));
  assert.deepEqual(parallel[0].selected, ["two/opaque.test.ts"]);
  assert.deepEqual(parallel[1].selected, ["one/leaf.test.ts", "one/opaque.test.ts"]);
  await assert.rejects(selectProjects({ ...options, projects: ["missing", "one"] }), /Graph worker missing:/);
  await assert.rejects(selectProjects({ ...options, concurrency: 3 }), /one or two/);
  write("one/independent.test.ts", "export const independent = true;");
  write("two/setup.ts", 'import "node:child_process"; throw new Error("setup must not execute during selection");');
  write("two/vitest.config.mjs", 'export default {test:{name:"two",include:["*.test.ts"],setupFiles:["./setup.ts"]}}');
  execFileSync("git", ["add", "."], { cwd: root });
  const conservative = await selectProjects(options);
  assert.deepEqual(conservative[0].selected, conservative[0].inventory, "opaque setup retains the complete affected project");
  assert.deepEqual(conservative[0].alwaysRun, conservative[0].inventory);
  assert.match(conservative[0].retentionReasons[conservative[0].inventory[0]].reasons[0], /Opaque setup/);
  assert.ok(!conservative[1].selected.includes("one/independent.test.ts"), "a separate audited project can still narrow");
});

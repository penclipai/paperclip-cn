import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveVitestInvocation, windowsPnpmVitestCommandBudget } from "../vitest-invocation.mjs";

test("short Windows Vitest invocations retain the pnpm resolver path", () => {
  const expected = { command: "pnpm", args: ["exec", "vitest", "run"], spawnOptions: {} };
  assert.deepEqual(resolveVitestInvocation(["run"], {
    platform: "win32",
    resolvePnpm: (args) => ({ ...expected, args }),
  }), expected);
});

test("long Windows Vitest invocations bypass cmd.exe without dropping filters", () => {
  const filters = Array.from({ length: 200 }, (_, index) => `server/src/__tests__/chat-channels.integration.test.ts:${index + 1}`);
  const invocation = resolveVitestInvocation(["list", "--project", "@penclipai/server", ...filters], {
    platform: "win32", repoRoot: "D:/repo", execPath: "node.exe",
    resolvePnpm: () => { throw new Error("long command must not use pnpm"); },
  });
  assert.equal(invocation.command, "node.exe");
  assert.equal(invocation.args[0], path.join("D:/repo", "node_modules", "vitest", "vitest.mjs"));
  assert.deepEqual(invocation.args.slice(1), ["list", "--project", "@penclipai/server", ...filters]);
  assert.deepEqual(invocation.spawnOptions, {});
  assert.ok(filters.join(" ").length > windowsPnpmVitestCommandBudget);
});

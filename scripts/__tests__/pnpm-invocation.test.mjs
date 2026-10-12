import assert from "node:assert/strict";
import test from "node:test";

import { resolvePnpmInvocation } from "../pnpm-invocation.mjs";

test("JavaScript pnpm shims run through Node", () => {
  assert.deepEqual(resolvePnpmInvocation(["exec", "vitest"], {
    npmExecPath: "/tools/pnpm.cjs", execPath: "/node", platform: "linux",
  }), { command: "/node", args: ["/tools/pnpm.cjs", "exec", "vitest"], spawnOptions: {} });
});

test("standalone pnpm executables run directly", () => {
  assert.deepEqual(resolvePnpmInvocation(["exec", "vitest"], {
    npmExecPath: "C:\\pnpm\\pnpm.exe", platform: "win32",
  }), { command: "C:\\pnpm\\pnpm.exe", args: ["exec", "vitest"], spawnOptions: {} });
});

test("Windows command shims use cmd without enabling spawn shell mode", () => {
  const invocation = resolvePnpmInvocation(["exec", "vitest", "file with spaces.test.ts"], {
    npmExecPath: "C:\\pnpm\\pnpm.cmd", platform: "win32", env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
  });
  assert.equal(invocation.command, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(invocation.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.match(invocation.args[3], /"file with spaces\.test\.ts"/);
  assert.deepEqual(invocation.spawnOptions, { windowsVerbatimArguments: true });
});

import assert from "node:assert/strict";
import test from "node:test";

import { batchVitestCollectionFilters } from "../vitest-collection-batches.mjs";

test("collection validation batches long exact-file filters without dropping or duplicating any", () => {
  const baseArgs = ["pnpm", "exec", "vitest", "list", "--project", "@penclipai/server"];
  const filters = Array.from({ length: 500 }, (_, index) => `server/src/__tests__/chat-channels.integration.test.ts:${index + 1}`);
  const batches = batchVitestCollectionFilters(filters, baseArgs, 1_000);

  assert.ok(batches.length > 1);
  assert.deepEqual(batches.flat(), filters);
  for (const batch of batches) {
    const length = [...baseArgs, ...batch].reduce((total, arg) => total + String(arg).length + 1, 0);
    assert.ok(length <= 1_000, `batch command length ${length} exceeds limit`);
  }
});

test("an oversized individual filter remains intact for an explicit collection failure", () => {
  const filter = "x".repeat(100);
  assert.deepEqual(batchVitestCollectionFilters([filter], [], 10), [[filter]]);
});

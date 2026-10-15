import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../serve-storybook-static.mjs", import.meta.url));

test("--port followed by another flag is not parsed as the port value", () => {
  const result = spawnSync(process.execPath, [script, "--port", "--unused-flag"], {
    env: { ...process.env, PORT: "65536" },
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid Storybook static server port: 65536/);
  assert.doesNotMatch(result.stderr, /--unused-flag/);
});

// The installed Codex package deliberately takes precedence over PATH. This
// test-only loader pins in-feed native E2E to its deterministic app-server
// fixture, so a developer's Codex installation can never be selected.
import { accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";
import { registerHooks } from "node:module";

const expectedEntry = resolve(dirname(fileURLToPath(import.meta.url)), "in-feed-codex.mjs");
const entry = process.env.IN_FEED_CODEX_ENTRY;
const mode = process.env.IN_FEED_CODEX_MODE;
const fixtureIsAuthorized =
  process.env.NODE_ENV === "test" && entry === expectedEntry && isAbsolute(entry);

if (!fixtureIsAuthorized || (mode !== "connection" && mode !== "completion")) {
  throw new Error("In-feed native E2E requires its owned deterministic Codex fixture and explicit test mode");
}
accessSync(entry, constants.R_OK);
const args = mode === "completion" ? ["--completion-stream-fixture"] : [];

registerHooks({
  load(url, context, nextLoad) {
    if (/\/packages\/paperclip-runner\/(src|dist)\/drivers\/codex\/codex-command\.(js|ts)$/.test(url)) {
      return {
        format: "module",
        shortCircuit: true,
        source: `export const resolveCodexCommand = () => ${JSON.stringify(entry)}; export const resolvePinnedCodexCommand = resolveCodexCommand;`,
      };
    }
    if (/\/packages\/paperclip-runner\/(src|dist)\/live\/runnerd-codex-transport\.(js|ts)$/.test(url)) {
      const loaded = nextLoad(url, context);
      const source = String(loaded.source);
      const marker = "  // The filesystem policy denies HOME and CODEX_HOME to keep credentials and\n";
      if (!source.includes(marker)) {
        throw new Error("In-feed native E2E could not locate the test-only runner argument seam");
      }
      return {
        ...loaded,
        source: source.replace(marker, `  return ${JSON.stringify(args)};\n${marker}`),
      };
    }
    return nextLoad(url, context);
  },
});

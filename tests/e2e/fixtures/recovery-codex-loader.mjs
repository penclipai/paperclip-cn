// The installed Codex package deliberately takes precedence over PATH. This
// test-only loader pins recovery E2E to the deterministic app-server fixture,
// so Windows never falls through to a user-installed or logged-in provider.
import { accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";
import { registerHooks } from "node:module";

const expectedEntry = resolve(dirname(fileURLToPath(import.meta.url)), "in-feed-codex.mjs");
const entry = process.env.PAPERCLIP_RECOVERY_CODEX_ENTRY;
const fixtureIsAuthorized =
  process.env.NODE_ENV === "test" && entry === expectedEntry && isAbsolute(entry);

registerHooks({
  load(url, context, nextLoad) {
    if (/\/packages\/paperclip-runner\/(src|dist)\/drivers\/codex\/codex-command\.(js|ts)$/.test(url)) {
      if (!fixtureIsAuthorized) {
        throw new Error("Execution recovery requires its owned deterministic Codex fixture in NODE_ENV=test");
      }
      accessSync(entry, constants.R_OK);
      return {
        format: "module",
        shortCircuit: true,
        source: `export const resolveCodexCommand = () => ${JSON.stringify(entry)}; export const resolvePinnedCodexCommand = resolveCodexCommand;`,
      };
    }
    if (/\/packages\/paperclip-runner\/(src|dist)\/live\/runnerd-codex-transport\.(js|ts)$/.test(url)) {
      if (!fixtureIsAuthorized) {
        throw new Error("Execution recovery requires its owned deterministic Codex fixture in NODE_ENV=test");
      }
      accessSync(entry, constants.R_OK);
      const loaded = nextLoad(url, context);
      const source = String(loaded.source);
      const marker = "  // The filesystem policy denies HOME and CODEX_HOME to keep credentials and\n";
      if (!source.includes(marker)) {
        throw new Error("Execution recovery could not locate the test-only runner argument seam");
      }
      return {
        ...loaded,
        // `test-drive` deliberately removes PAPERCLIP_* variables before it
        // starts the server. Authorization was captured above while this
        // loader was initialized, so the deterministic entrypoint remains
        // pinned even after that scrub.
        source: source.replace(marker, `  return ["--recovery-fixture"];\n${marker}`),
      };
    }
    return nextLoad(url, context);
  },
});

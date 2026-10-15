// Pins this recovery-only E2E to its own deterministic provider, before PATH
// or an installed/logged-in Codex command can participate.
import { accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";
import { registerHooks } from "node:module";

const entry = process.env.TEXT_TURN_CODEX_ENTRY;
const faultMarker = process.env.TEXT_TURN_FAULT_MARKER;
const statePath = process.env.TEXT_TURN_FIXTURE_STATE;
const expected = resolve(dirname(fileURLToPath(import.meta.url)), "recovery-text-turn-codex.mjs");
if (process.env.NODE_ENV !== "test" || entry !== expected || !isAbsolute(entry)) {
  throw new Error("text-turn recovery requires its owned deterministic provider");
}
if (!faultMarker || !statePath || !isAbsolute(faultMarker) || !isAbsolute(statePath)) throw new Error("text-turn recovery requires owned absolute state paths");
accessSync(entry, constants.R_OK);
registerHooks({
  load(url, context, nextLoad) {
    if (/\/packages\/paperclip-runner\/(src|dist)\/drivers\/codex\/codex-command\.(js|ts)$/.test(url)) return { format: "module", shortCircuit: true,
      source: `export const resolveCodexCommand = () => ${JSON.stringify(entry)}; export const resolvePinnedCodexCommand = resolveCodexCommand;` };
    if (/\/packages\/paperclip-runner\/(src|dist)\/live\/runnerd-codex-transport\.(js|ts)$/.test(url)) {
      const loaded = nextLoad(url, context); const source = String(loaded.source);
      const marker = "  // The filesystem policy denies HOME and CODEX_HOME to keep credentials and\n";
      if (!source.includes(marker)) throw new Error("text-turn recovery runner seam changed");
      return { ...loaded, source: source.replace(marker, `  return ["--text-turn-recovery-fixture", ${JSON.stringify(faultMarker)}, ${JSON.stringify(statePath)}];\n${marker}`) };
    }
    if (/\/server\/(src|dist)\/services\/native-runtime\/native-session-executor\.(js|ts)$/.test(url)) {
      const loaded = nextLoad(url, context); const source = String(loaded.source);
      const marker = /createRunnerdCodexTransport\(\{\r?\n\s*onSpawn:/;
      if (!marker.test(source)) throw new Error("text-turn recovery close-grace seam changed");
      // This constrains the real runner transport's shutdown deadline. The
      // transport still sends its own stop/drain/suspend commands and decides
      // settlement from its durable state; no error or result is injected.
      return { ...loaded, source: source.replace(marker, "createRunnerdCodexTransport({\n        closeGraceMs: 1,\n        onSpawn:") };
    }
    return nextLoad(url, context);
  },
});

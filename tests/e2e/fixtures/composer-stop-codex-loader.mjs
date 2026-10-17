// The installed Codex dependency takes precedence over PATH. Pin only this
// acceptance server's command resolver to its deterministic protocol fixture.
import { accessSync, constants } from "node:fs";
import { registerHooks } from "node:module";
import { isAbsolute } from "node:path";

const command = process.env.PAPERCLIP_STOP_CODEX_COMMAND;
const fixtureArgs = process.env.PAPERCLIP_STOP_CODEX_ARGS;
if (process.env.NODE_ENV !== "test" || !command || !isAbsolute(command)) {
  throw new Error("Composer Stop requires an absolute fixture command in NODE_ENV=test");
}
accessSync(command, constants.X_OK);
let parsedFixtureArgs;
if (fixtureArgs) {
  try {
    parsedFixtureArgs = JSON.parse(fixtureArgs);
  } catch {
    throw new Error("Composer Stop fixture arguments must be JSON");
  }
  if (!Array.isArray(parsedFixtureArgs) || parsedFixtureArgs.some((arg) => typeof arg !== "string")) {
    throw new Error("Composer Stop fixture arguments must be strings");
  }
}
registerHooks({
  load(url, context, nextLoad) {
    if (/\/packages\/paperclip-runner\/(src|dist)\/drivers\/codex\/codex-command\.(js|ts)$/.test(url)) {
      return {
        format: "module",
        shortCircuit: true,
        source: `export const resolveCodexCommand = () => ${JSON.stringify(command)}; export const resolvePinnedCodexCommand = resolveCodexCommand;`,
      };
    }
    if (parsedFixtureArgs && /\/packages\/paperclip-runner\/(src|dist)\/live\/runnerd-codex-transport\.(js|ts)$/.test(url)) {
      const loaded = nextLoad(url, context);
      const source = String(loaded.source);
      const marker = "  // The filesystem policy denies HOME and CODEX_HOME to keep credentials and\n";
      if (!source.includes(marker)) throw new Error("Composer Stop could not locate the test-only runner argument seam");
      return {
        ...loaded,
        source: source.replace(marker, `  if (process.env.PAPERCLIP_STOP_CODEX_ARGS) return ${JSON.stringify(parsedFixtureArgs)};\n${marker}`),
      };
    }
    return nextLoad(url, context);
  },
});

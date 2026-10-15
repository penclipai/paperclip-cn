import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Opt-in native coverage uses real runnerd with the repo's deterministic Codex
// protocol fixture. Never let this suite fall through to a logged-in real Codex.
const fixture = process.env.PAPERCLIP_STOP_FAKE_CODEX;
const fixtureDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "composer-stop-provider-"),
);
const logPath =
  process.env.PAPERCLIP_STOP_CODEX_LOG ??
  path.join(fixtureDir, "codex-calls.log");
process.env.PAPERCLIP_STOP_CODEX_LOG = logPath;
if (fixture) {
  if (!path.isAbsolute(fixture) || !fs.existsSync(fixture))
    throw new Error(
      "PAPERCLIP_STOP_FAKE_CODEX must name the built fake-codex-app-server binary",
    );
  fs.mkdirSync(path.join(fixtureDir, "codex-home"));
}
const server = base.webServer as Exclude<typeof base.webServer, unknown[]>;
export default defineConfig({
  ...base,
  testMatch: "composer-stop.spec.ts",
  timeout: 90_000,
  webServer: {
    ...server,
    env: {
      ...server?.env,
      HEARTBEAT_SCHEDULER_INTERVAL_MS: "10000",
      PATH: `${fixtureDir}${path.delimiter}${process.env.PATH ?? ""}`,
      ...(fixture ? {
        // Provider selection prefers the installed dependency over PATH.
        // Scope this override and its empty credential home to the test server.
        // Runnerd invokes the command through Windows CreateProcess, which
        // cannot execute the POSIX shell wrapper used by the Unix fixture.
        // Point it at the checked deterministic PE binary and let the
        // test-only loader supply its protocol flags.
        PAPERCLIP_STOP_CODEX_COMMAND: fixture,
        PAPERCLIP_STOP_CODEX_ARGS: JSON.stringify([
          // Runnerd creates a distinct isolated CODEX_HOME per native
          // session. Keeping fake state there preserves the fixture's
          // per-process behavior that the former shell wrapper got from $$.
          "--state-file-in-codex-home",
          "--hold-turn",
          "--call-log",
          logPath,
        ]),
        CODEX_HOME: path.join(fixtureDir, "codex-home"),
        OPENAI_API_KEY: "composer-stop-fixture-key",
        NODE_OPTIONS: `${server?.env?.NODE_OPTIONS ?? ""} --import=${pathToFileURL(path.resolve(import.meta.dirname, "fixtures/composer-stop-codex-loader.mjs")).href}`,
      } : {}),
    },
  },
});

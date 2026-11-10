import { configDefaults, defineConfig } from "vitest/config";
import { retryReporterEnabled } from "./scripts/ci/vitest-retry.mjs";

export default defineConfig({
  test: {
    // Windows full-suite runs can starve heavy embedded-postgres/worktree suites
    // when Vitest fans out every project at once. A small global cap keeps
    // `pnpm test:run` stable without changing individual suite semantics.
    maxWorkers: process.platform === "win32" ? 4 : undefined,
    reporters: [...configDefaults.reporters,
      ...(process.env.GITHUB_ACTIONS === "true"
        ? ["./scripts/ci/test-timing-reporter.mjs", "./scripts/ci/oversized-test-files.mjs"] : []),
      ...(process.env.PAPERCLIP_CI_PROFILE === "true" ? ["./scripts/ci-profile/vitest-reporter.mjs"] : []),
      // PR lanes pass --retry from scripts/run-vitest-stable.mjs; see scripts/ci/vitest-retry.mjs.
      ...(retryReporterEnabled() ? ["./scripts/ci/retry-reporter.mjs"] : [])],
    projects: [
      "packages/shared",
      "packages/skills-catalog",
      "packages/db",
      "packages/adapter-utils",
      "packages/adapters/claude-local",
      "packages/adapters/codex-local",
      "packages/adapters/cursor-cloud",
      "packages/adapters/cursor-local",
      "packages/adapters/gemini-local",
      "packages/adapters/grok-local",
      "packages/adapters/kimi-local",
      "packages/adapters/openclaw-gateway",
      "packages/adapters/opencode-local",
      "packages/adapters/pi-local",
      "packages/plugins/sdk",
      "packages/plugins/create-paperclip-plugin",
      "packages/plugins/sandbox-providers/daytona",
      "server",
      "ui",
      "cli",
    ],
  },
});

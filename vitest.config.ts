import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Windows CI/dev boxes time out when the heaviest integration suites all
    // start at once (embedded Postgres, worktrees, CLI e2e, skill sync).
    maxWorkers: process.platform === "win32" ? 4 : undefined,
    projects: [
      "packages/db",
      "packages/desktop-electron",
      "packages/adapters/codex-local",
      "packages/adapters/opencode-local",
      "server",
      "ui",
      "cli",
    ],
  },
});

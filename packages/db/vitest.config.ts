import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globalSetup: ["./src/test-embedded-postgres-global-setup.ts"],
    hookTimeout: 30_000,
    teardownTimeout: 30_000,
    // Each DB suite owns an embedded PostgreSQL cluster. Concurrent Windows
    // workers contend for its native binaries and template directory, causing
    // otherwise independent migrations to exceed their existing timeouts.
    ...(process.platform === "win32" ? { fileParallelism: false, maxWorkers: 1 } : {}),
  },
});

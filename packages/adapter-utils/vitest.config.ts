import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    fileParallelism: process.platform !== "win32",
    maxWorkers: process.platform === "win32" ? 1 : undefined,
    // Windows fixture runs execute real Git Bash staging commands. Their
    // operation-level deadlines remain intact; this only avoids Vitest's
    // shorter test-harness timeout around several sequential child launches.
    testTimeout: process.platform === "win32" ? 15_000 : undefined,
    hookTimeout: process.platform === "win32" ? 30_000 : undefined,
  },
});

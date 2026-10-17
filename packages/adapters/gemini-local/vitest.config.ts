import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    ...(process.platform === "win32" ? { testTimeout: 15_000, hookTimeout: 30_000 } : {}),
  },
});

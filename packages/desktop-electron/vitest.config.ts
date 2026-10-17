import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@penclipai/desktop-electron",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

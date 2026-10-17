import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../../..");

export default defineConfig({
  root: repoRoot,
  resolve: {
    alias: {
      "@penclipai/plugin-sdk": path.resolve(dirname, "../../sdk/src/index.ts"),
    },
  },
  test: {
    name: "@penclipai/plugin-daytona",
    // This config runs both directly from the repository root and as a root
    // Vitest project. Use an absolute slash-normalized glob so project-mode
    // does not resolve the package path a second time.
    include: [path.posix.join(dirname.replace(/\\/g, "/"), "src/**/*.test.ts")],
    environment: "node",
  },
});

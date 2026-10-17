import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const execFileAsync = promisify(execFile);

describe("dev-service CLI", () => {
  it("loads the list command with an isolated empty service registry", async () => {
    const paperclipHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-dev-service-list-"));
    const configPath = path.join(paperclipHome, "config.json");

    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [
          path.join(repoRoot, "scripts", "run-with-tsx.mjs"),
          path.join(repoRoot, "scripts", "dev-service.ts"),
          "list",
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            PAPERCLIP_HOME: paperclipHome,
            PAPERCLIP_INSTANCE_ID: `dev-service-list-${randomUUID()}`,
            PAPERCLIP_CONFIG: configPath,
          },
          timeout: 15_000,
          windowsHide: true,
        },
      );

      expect(stderr).not.toContain("does not provide an export");
      expect(stdout).toContain("No Paperclip dev services registered for this repo.");
    } finally {
      await fs.rm(paperclipHome, { recursive: true, force: true });
    }
  });
});

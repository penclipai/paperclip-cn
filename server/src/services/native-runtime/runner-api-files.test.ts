import { constants } from "node:fs";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openRunnerApiWorkspaceFile, openRunnerWorkspaceFile } from "./runner-api-files.js";

describe.skipIf(!["linux", "darwin"].includes(process.platform))("runner API confined workspace uploads", () => {
  it("reads regular files but rejects a substituted file or ancestor symlink", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "api-file-open-")));
    try {
      await mkdir(join(root, "allowed"));
      await mkdir(join(root, "outside"));
      await writeFile(join(root, "allowed", "file.txt"), "allowed");
      await writeFile(join(root, "outside", "file.txt"), "outside");
      const handle = await openRunnerApiWorkspaceFile(join(root, "allowed", "file.txt"));
      try { expect(await handle.readFile("utf8")).toBe("allowed"); } finally { await handle.close(); }
      await rm(join(root, "allowed", "file.txt"));
      await symlink(join(root, "outside", "file.txt"), join(root, "allowed", "file.txt"));
      await expect(openRunnerApiWorkspaceFile(join(root, "allowed", "file.txt"))).rejects.toThrow();
      await rm(join(root, "allowed"), { recursive: true });
      await symlink(join(root, "outside"), join(root, "allowed"));
      await expect(openRunnerApiWorkspaceFile(join(root, "allowed", "file.txt"))).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

it.runIf(process.platform === "win32")("rejects runner API workspace opens before a write can mutate files", async () => {
  const root = await mkdtemp(join(tmpdir(), "api-file-open-win-"));
  const original = join(root, "original.txt");
  const created = join(root, "created.txt");
  const bytes = "original bytes must survive";
  const unsupported = "Workspace uploads require a platform with confined file opens; use an authorized artifact reference";
  try {
    await writeFile(original, bytes);
    await expect(openRunnerApiWorkspaceFile(original)).rejects.toThrow(unsupported);
    await expect(openRunnerWorkspaceFile(original, constants.O_WRONLY | constants.O_TRUNC)).rejects.toThrow(unsupported);
    expect(await readFile(original, "utf8")).toBe(bytes);
    await expect(openRunnerWorkspaceFile(created, constants.O_WRONLY | constants.O_CREAT, 0o600)).rejects.toThrow(unsupported);
    await expect(readFile(created)).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

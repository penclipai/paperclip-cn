import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it, vi } from "vitest";
import { localEncryptedProvider } from "../secrets/local-encrypted-provider.js";

it("atomically publishes one complete master key across competing processes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "identity-master-race-"));
  const keyFile = join(directory, "master.key");
  const providerPath = fileURLToPath(new URL("../secrets/local-encrypted-provider.ts", import.meta.url));
  const serverRoot = fileURLToPath(new URL("../../", import.meta.url));
  try {
    const script = `import {localEncryptedProvider as p} from ${JSON.stringify(pathToFileURL(providerPath).href)}; console.log(JSON.stringify(await p.createSecret({value:'race-challenge'})));`;
    const children = await Promise.all(Array.from({ length: 6 }, () => promisify(execFile)(process.execPath,
      ["--import", "tsx/esm", "--input-type=module", "-e", script], {
        cwd: serverRoot,
        env: { ...process.env, PAPERCLIP_SECRETS_MASTER_KEY: "", PAPERCLIP_SECRETS_MASTER_KEY_FILE: keyFile },
      })));
    expect(Buffer.from(await readFile(keyFile, "utf8"), "base64")).toHaveLength(32);
    // Windows does not expose POSIX owner bits through `stat`; the competing
    // process round trip below still proves that only one complete key file is
    // published and used for every encryption result.
    if (process.platform !== "win32")
      expect((await stat(keyFile)).mode & 0o777).toBe(0o600);
    vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", "");
    vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY_FILE", keyFile);
    for (const child of children) {
      expect(await localEncryptedProvider.resolveVersion(JSON.parse(child.stdout))).toBe("race-challenge");
    }
    await rm(keyFile);
    await expect(localEncryptedProvider.resolveVersion(JSON.parse(children[0].stdout))).rejects.toThrow("master key file is missing");
    await expect(stat(keyFile)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

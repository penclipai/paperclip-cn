import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNativeSshCommandRunner } from "./native-ssh-command-runner.js";
import { MAX_REMOTE_DELIVERABLE_BYTES, readVerifiedRemoteWorkspaceFile } from "./remote-deliverable-file.js";

const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  execFile,
}));

describe("native SSH deliverable output budget", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "paperclip-ssh-output-"));
    // Exercise the real SSH command adapter and its execFile output limit,
    // replacing only the network transport executable. A Windows .cmd shim
    // cannot stand in for execFile("ssh", ...) with shell disabled, because
    // OpenSSH flags are parsed as Node options by a copied node.exe.
    execFile.mockImplementation((_file, _args, options, callback) => {
      const stdout = readFileSync(join(root, "response"), "utf8");
      if (Buffer.byteLength(stdout) > options.maxBuffer) {
        callback(Object.assign(new Error("stdout maxBuffer exceeded"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }), "", "");
      } else {
        callback(null, stdout, "");
      }
    });
  });
  afterEach(async () => {
    execFile.mockReset();
    await rm(root, { recursive: true, force: true });
  });

  const createRunner = () => createNativeSshCommandRunner({
    spec: {
      host: "fixture.invalid", port: 22, username: "fixture",
      remoteWorkspacePath: "/workspace", remoteCwd: "/workspace",
      privateKey: null, knownHosts: null, strictHostKeyChecking: true,
    },
    defaultCwd: "/workspace",
  });

  it.each([64, MAX_REMOTE_DELIVERABLE_BYTES])("returns exact verified bytes for a %i-byte file through the SSH adapter", async (byteSize) => {
    const body = Buffer.alloc(byteSize, 65);
    await writeFile(join(root, "response"), body.toString("base64"));
    const result = await readVerifiedRemoteWorkspaceFile({
      runner: createRunner(), workspaceRoot: "/workspace", contentRef: "result.md",
      byteSize, sha256: createHash("sha256").update(body).digest("hex"),
    });
    expect(result.equals(body)).toBe(true);
    expect(execFile).toHaveBeenCalledWith("ssh", expect.arrayContaining([
      "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
    ]), expect.objectContaining({
      maxBuffer: 4 * Math.ceil(MAX_REMOTE_DELIVERABLE_BYTES / 3),
    }), expect.any(Function));
  });

  it("stops a remote command that exceeds the maximum encoded envelope", async () => {
    await writeFile(join(root, "response"), Buffer.alloc(4 * Math.ceil(MAX_REMOTE_DELIVERABLE_BYTES / 3) + 1, 65));
    const result = await createRunner().execute({ command: "node", args: ["unused"], timeoutMs: 10_000 });
    expect(result.exitCode).not.toBe(0);
  });
});

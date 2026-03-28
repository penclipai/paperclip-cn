import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock, execFileAsyncMock, PROMISIFY_CUSTOM } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  execFileAsyncMock: vi.fn(),
  PROMISIFY_CUSTOM: Symbol.for("nodejs.util.promisify.custom"),
}));

const execFileWithPromisify = Object.assign(execFileMock, {
  [PROMISIFY_CUSTOM]: execFileAsyncMock,
});

vi.mock("node:child_process", () => ({
  execFile: execFileWithPromisify,
}));

function mockProcessList(
  rows: Array<{ pid: number; commandLine: string }>,
): void {
  const stdout =
    process.platform === "win32"
      ? JSON.stringify(
          rows.map((row) => ({
            ProcessId: row.pid,
            CommandLine: row.commandLine,
          })),
        )
      : rows.map((row) => `${row.pid} ${row.commandLine}`).join("\n");

  execFileAsyncMock.mockResolvedValue({ stdout, stderr: "" });
  execFileMock.mockImplementation(
    (
      _file: string,
      _args: string[],
      _options:
        | { windowsHide?: boolean }
        | ((error: Error | null, stdout: string, stderr: string) => void),
      callback?: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const handler = typeof _options === "function" ? _options : callback;
      handler?.(null, stdout, "");
      return undefined as never;
    },
  );
}

describe("recoverEmbeddedPostgresStart", () => {
  beforeEach(() => {
    vi.resetModules();
    execFileMock.mockReset();
    execFileAsyncMock.mockReset();
  });

  it("only terminates postgres processes that reference the requested data dir", async () => {
    const requestedDataDir = path.resolve(os.tmpdir(), "paperclip-db-target");
    const otherDataDir = path.resolve(os.tmpdir(), "paperclip-db-other");
    const sharedBinaryPath = path.resolve(
      process.cwd(),
      "node_modules",
      ".pnpm",
      "@embedded-postgres",
      "postgres",
    );

    mockProcessList([
      {
        pid: 101,
        commandLine: `"${sharedBinaryPath}" -D "${requestedDataDir}"`,
      },
      {
        pid: 202,
        commandLine: `"${sharedBinaryPath}" -D "${otherDataDir}"`,
      },
    ]);

    const killSpy = vi.spyOn(process, "kill").mockImplementation(
      ((_: number, signal?: number | NodeJS.Signals) => {
        if (signal === 0) {
          throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
        }
        return true;
      }) as typeof process.kill,
    );

    const { recoverEmbeddedPostgresStart } = await import(
      "./embedded-postgres-recovery.js"
    );

    await expect(recoverEmbeddedPostgresStart(requestedDataDir)).resolves.toEqual([
      101,
    ]);
    expect(killSpy).toHaveBeenCalledWith(101);
    expect(killSpy).not.toHaveBeenCalledWith(202);
  });
});

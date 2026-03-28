import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("does not match postgres processes whose data dir only shares a prefix", async () => {
    const requestedDataDir = path.resolve(os.tmpdir(), "paperclip-db");
    const prefixedDataDir = `${requestedDataDir}2`;

    mockProcessList([
      {
        pid: 101,
        commandLine: `postgres -D "${requestedDataDir}"`,
      },
      {
        pid: 202,
        commandLine: `postgres -D "${prefixedDataDir}"`,
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

    await expect(recoverEmbeddedPostgresStart(requestedDataDir)).resolves.toEqual([101]);
    expect(killSpy).toHaveBeenCalledWith(101);
    expect(killSpy).not.toHaveBeenCalledWith(202);
  });

  it("does not report termination success when kill is denied", async () => {
    const requestedDataDir = path.resolve(os.tmpdir(), "paperclip-db-target");

    mockProcessList([
      {
        pid: 101,
        commandLine: `postgres -D "${requestedDataDir}"`,
      },
    ]);

    const killSpy = vi.spyOn(process, "kill").mockImplementation(
      ((_: number, signal?: number | NodeJS.Signals) => {
        if (signal === 0) {
          return true;
        }
        throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      }) as typeof process.kill,
    );

    const { recoverEmbeddedPostgresStart } = await import(
      "./embedded-postgres-recovery.js"
    );

    await expect(recoverEmbeddedPostgresStart(requestedDataDir)).resolves.toEqual([]);
    expect(killSpy).toHaveBeenCalledWith(101);
  });

  it("preserves postmaster.pid when cleanup cannot terminate all matching processes", async () => {
    const requestedDataDir = mkdtempSync(path.join(os.tmpdir(), "paperclip-db-"));
    const postmasterPidFile = path.join(requestedDataDir, "postmaster.pid");
    writeFileSync(postmasterPidFile, "101\n");

    mockProcessList([
      {
        pid: 101,
        commandLine: `postgres -D "${requestedDataDir}"`,
      },
    ]);

    const killSpy = vi.spyOn(process, "kill").mockImplementation(
      ((_: number, signal?: number | NodeJS.Signals) => {
        if (signal === 0) {
          return true;
        }
        throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      }) as typeof process.kill,
    );

    const { recoverEmbeddedPostgresStart } = await import(
      "./embedded-postgres-recovery.js"
    );

    try {
      await expect(recoverEmbeddedPostgresStart(requestedDataDir)).resolves.toEqual([]);
      expect(killSpy).toHaveBeenCalledWith(101);
      expect(existsSync(postmasterPidFile)).toBe(true);
    } finally {
      rmSync(requestedDataDir, { recursive: true, force: true });
    }
  });
});

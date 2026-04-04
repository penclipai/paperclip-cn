import { afterEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  if (originalPlatform) {
    Object.defineProperty(process, "platform", originalPlatform);
  }
});

describe("terminateLocalService", () => {
  it("falls back to taskkill /T /F on Windows after a graceful SIGTERM attempt", async () => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    let alive = true;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: NodeJS.Signals | 0) => {
      expect(pid).toBe(4321);
      if (signal === 0) {
        if (!alive) {
          throw new Error("process already exited");
        }
        return true;
      }
      return true;
    }) as typeof process.kill);

    execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: Record<string, unknown>,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        alive = false;
        callback(null, "", "");
        return {} as ReturnType<typeof execFileMock>;
      },
    );

    const { terminateLocalService } = await import("../services/local-service-supervisor.ts");

    await terminateLocalService(
      { pid: 4321, processGroupId: null },
      { signal: "SIGTERM", forceAfterMs: 0 },
    );

    expect(killSpy).toHaveBeenCalledWith(4321, "SIGTERM");
    expect(execFileMock).toHaveBeenCalledWith(
      process.env.comspec ?? "cmd.exe",
      ["/d", "/s", "/c", "taskkill", "/PID", "4321", "/T", "/F"],
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function),
    );
  });
});

import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  resolveServerDevWatchIgnorePathsMock,
  spawnMock,
  terminateLocalServiceMock,
} = vi.hoisted(() => ({
  resolveServerDevWatchIgnorePathsMock: vi.fn(() => []),
  spawnMock: vi.fn(),
  terminateLocalServiceMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("../dev-watch-ignore.ts", () => ({
  resolveServerDevWatchIgnorePaths: resolveServerDevWatchIgnorePathsMock,
}));

vi.mock("../services/local-service-supervisor.ts", () => ({
  terminateLocalService: terminateLocalServiceMock,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("dev-watch", () => {
  it("forwards SIGTERM to the watched child and waits for exit before finishing shutdown", async () => {
    vi.resetModules();

    const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
    vi.spyOn(process, "once").mockImplementation(((event: string, handler: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(event, handler);
      return process;
    }) as typeof process.once);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => undefined as never) as typeof process.exit);
    vi.spyOn(process, "kill").mockImplementation((((_pid: number, _signal?: NodeJS.Signals | number) => true)) as typeof process.kill);

    const fakeChild = new EventEmitter() as EventEmitter & {
      pid: number;
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
    };
    fakeChild.pid = 4321;
    fakeChild.exitCode = null;
    fakeChild.signalCode = null;

    spawnMock.mockReturnValue(fakeChild);
    terminateLocalServiceMock.mockResolvedValue(undefined);

    await import("../../scripts/dev-watch.ts");

    const sigtermHandler = registeredHandlers.get("SIGTERM");
    expect(sigtermHandler).toBeTypeOf("function");

    sigtermHandler?.();
    await Promise.resolve();
    expect(terminateLocalServiceMock).toHaveBeenCalledWith(
      { pid: 4321, processGroupId: null },
      { signal: "SIGTERM", forceAfterMs: 5_000 },
    );
    expect(exitSpy).not.toHaveBeenCalled();

    fakeChild.signalCode = "SIGTERM";
    fakeChild.emit("exit", null, "SIGTERM");

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(143);
    });
  });
});

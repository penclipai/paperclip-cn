import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { stopOwnedEmbeddedPostgresOnWindows, type WindowsNativePostgresStopInput, type WindowsNativePostgresStopResult } from "./embedded-postgres-stop.js";

function fixture() {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    pid: 4242,
    signalCode: null as NodeJS.Signals | null,
  });
  const instance = { process: child, stop: vi.fn(async () => undefined) };
  const runWindowsNativeStop = vi.fn<(input: WindowsNativePostgresStopInput) => Promise<WindowsNativePostgresStopResult>>(async () => {
    child.emit("exit", 0, null);
    return { closureComplete: true, forkChildrenObserved: 0, forkChildrenTerminated: 0, pgCtlExitCode: 0, pgCtlManagedExitCode: 0, pgCtlSucceeded: true, rootExited: true, rootExitCode: 0, rootIdentityVerified: true, unknownChildren: 0 };
  });
  return {
    child,
    instance,
    runWindowsNativeStop,
    options: {
      instance,
      dataDir: "C:\\paperclip-data",
      pgCtlPath: "C:\\runtime\\pg_ctl.exe",
      canonicalizeWindowsDataDirectory: (value: string) => value.replaceAll("/", "\\").toLowerCase(),
      readFile: vi.fn(() => "4242\nC:\\paperclip-data\n1700000000\n"),
      runWindowsNativeStop,
    },
  };
}

describe("stopOwnedEmbeddedPostgresOnWindows", () => {
  it("registers the exit listener before the native closure helper and never calls vendor stop", async () => {
    const f = fixture();
    await stopOwnedEmbeddedPostgresOnWindows(f.options);
    expect(f.runWindowsNativeStop).toHaveBeenCalledWith(expect.objectContaining({ childPid: 4242, dataDir: "C:\\paperclip-data", pgCtlPath: "C:\\runtime\\pg_ctl.exe", postmasterDataDir: "C:\\paperclip-data", postmasterStartedAtEpoch: 1_700_000_000, timeoutMs: 31_000 }));
    expect(f.instance.stop).not.toHaveBeenCalled();
    expect(f.instance.process).toBeUndefined();
  });

  it("leaves no old child for a later vendor exit hook to taskkill", async () => {
    const f = fixture();
    await stopOwnedEmbeddedPostgresOnWindows(f.options);
    const taskkill = vi.fn();
    const vendorExitHook = () => {
      if (!f.instance.process) return;
      taskkill(f.instance.process.pid);
    };
    vendorExitHook();
    expect(taskkill).not.toHaveBeenCalled();
  });

  it("rejects a fork-child closure failure but detaches the proven-dead root from a vendor exit hook", async () => {
    const f = fixture();
    f.runWindowsNativeStop.mockImplementation(async () => {
      f.child.emit("exit", 0, null);
      return { closureComplete: false, forkChildrenObserved: 1, forkChildrenTerminated: 0, pgCtlExitCode: 0, pgCtlManagedExitCode: 0, pgCtlSucceeded: true, rootExited: true, rootExitCode: 0, rootIdentityVerified: true, unknownChildren: 0 };
    });
    await expect(stopOwnedEmbeddedPostgresOnWindows(f.options)).rejects.toThrow("did not prove owned process closure");
    expect(f.instance.process).toBeUndefined();
    const taskkill = vi.fn();
    if (f.instance.process) taskkill(f.instance.process.pid);
    expect(taskkill).not.toHaveBeenCalled();
  });

  it("accepts an exact fork-child closure only after the native helper confirms its exit", async () => {
    const f = fixture();
    f.runWindowsNativeStop.mockImplementation(async () => {
      f.child.emit("exit", 0, null);
      return { closureComplete: true, forkChildrenObserved: 1, forkChildrenTerminated: 1, pgCtlExitCode: 0, pgCtlManagedExitCode: 0, pgCtlSucceeded: true, rootExited: true, rootExitCode: 0, rootIdentityVerified: true, unknownChildren: 0 };
    });
    await stopOwnedEmbeddedPostgresOnWindows(f.options);
    expect(f.instance.process).toBeUndefined();
  });

  it("keeps the child when the owned root exits with a nonzero native exit code", async () => {
    const f = fixture();
    f.runWindowsNativeStop.mockImplementation(async () => {
      f.child.emit("exit", 0, null);
      return { closureComplete: true, forkChildrenObserved: 0, forkChildrenTerminated: 0, pgCtlExitCode: 0, pgCtlManagedExitCode: 0, pgCtlSucceeded: true, rootExited: true, rootExitCode: 1, rootIdentityVerified: true, unknownChildren: 0 };
    });
    await expect(stopOwnedEmbeddedPostgresOnWindows(f.options)).rejects.toThrow("did not prove owned process closure");
    expect(f.instance.process).toBe(f.child);
  });

  it("keeps the child when Node observes a nonzero root exit even if native closure reports success", async () => {
    const f = fixture();
    f.runWindowsNativeStop.mockImplementation(async () => {
      f.child.emit("exit", 1, null);
      return { closureComplete: true, forkChildrenObserved: 0, forkChildrenTerminated: 0, pgCtlExitCode: 0, pgCtlManagedExitCode: 0, pgCtlSucceeded: true, rootExited: true, rootExitCode: 0, rootIdentityVerified: true, unknownChildren: 0 };
    });
    await expect(stopOwnedEmbeddedPostgresOnWindows(f.options)).rejects.toThrow("did not exit cleanly");
    expect(f.instance.process).toBe(f.child);
  });

  const rejectedNativeCases: Array<[string, Partial<WindowsNativePostgresStopResult>]> = [
    ["pid reuse", { closureComplete: false, rootIdentityVerified: false, unknownChildren: 1 }],
    ["foreign root image", { closureComplete: false, rootIdentityVerified: false, unknownChildren: 1 }],
    ["root still alive", { closureComplete: false, rootExited: false, rootExitCode: null, rootIdentityVerified: true, unknownChildren: 0 }],
  ];
  it.each(rejectedNativeCases)("keeps the child when native identity validation rejects %s", async (_name, partial) => {
    const f = fixture();
    f.runWindowsNativeStop.mockImplementation(async () => {
      f.child.emit("exit", 0, null);
      const baseline: WindowsNativePostgresStopResult = { closureComplete: false, forkChildrenObserved: 0, forkChildrenTerminated: 0, pgCtlExitCode: 0, pgCtlManagedExitCode: 0, pgCtlSucceeded: true, rootExited: true, rootExitCode: 0, rootIdentityVerified: true, unknownChildren: 0 };
      return { ...baseline, ...partial };
    });
    await expect(stopOwnedEmbeddedPostgresOnWindows(f.options)).rejects.toThrow("did not prove owned process closure");
    expect(f.instance.process).toBe(f.child);
  });

  it("does not spawn a command for a mismatched pid or data directory", async () => {
    const f = fixture();
    f.options.readFile.mockReturnValue("9999\nC:\\other\n1700000000\n");
    await expect(stopOwnedEmbeddedPostgresOnWindows(f.options)).rejects.toThrow("does not match");
    expect(f.runWindowsNativeStop).not.toHaveBeenCalled();
    expect(f.instance.stop).not.toHaveBeenCalled();
    expect(f.instance.process).toBe(f.child);
  });

  it("accepts a Windows junction alias with case and separator differences", async () => {
    const f = fixture();
    f.options.dataDir = "C:\\junction";
    f.options.readFile.mockReturnValue("4242\nc:/PAPERCLIP-data\n1700000000\n");
    f.options.canonicalizeWindowsDataDirectory = (value) => {
      const normalized = value.replaceAll("/", "\\").toLowerCase();
      return normalized === "c:\\junction" ? "c:\\paperclip-data" : normalized;
    };
    await stopOwnedEmbeddedPostgresOnWindows(f.options);
    expect(f.runWindowsNativeStop).toHaveBeenCalledOnce();
  });

  it("rejects a different real Windows data directory even when the pid matches", async () => {
    const f = fixture();
    f.options.dataDir = "C:\\junction";
    f.options.readFile.mockReturnValue("4242\nC:\\other-junction\n1700000000\n");
    f.options.canonicalizeWindowsDataDirectory = (value) => {
      const normalized = value.replaceAll("/", "\\").toLowerCase();
      if (normalized === "c:\\junction") return "c:\\paperclip-data";
      if (normalized === "c:\\other-junction") return "c:\\other-data";
      return normalized;
    };
    await expect(stopOwnedEmbeddedPostgresOnWindows(f.options)).rejects.toThrow("does not match");
    expect(f.runWindowsNativeStop).not.toHaveBeenCalled();
  });

  it("observes a child exit before native shutdown and refuses to target a later pid", async () => {
    const f = fixture();
    f.options.canonicalizeWindowsDataDirectory = () => {
      f.child.exitCode = 0;
      f.child.emit("exit", 0, null);
      return "c:\\paperclip-data";
    };
    await expect(stopOwnedEmbeddedPostgresOnWindows(f.options)).rejects.toThrow("already exited");
    expect(f.runWindowsNativeStop).not.toHaveBeenCalled();
  });

  it("rejects native stop failures without falling back to vendor stop", async () => {
    const f = fixture();
    f.runWindowsNativeStop.mockRejectedValueOnce(new Error("pg_ctl failed"));
    await expect(stopOwnedEmbeddedPostgresOnWindows(f.options)).rejects.toThrow("pg_ctl failed");
    expect(f.runWindowsNativeStop).toHaveBeenCalledOnce();
    expect(f.instance.stop).not.toHaveBeenCalled();
    expect(f.instance.process).toBe(f.child);
  });

  it("rejects when the owned direct child does not exit by the shared deadline", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.runWindowsNativeStop.mockImplementation(async () => ({ closureComplete: true, forkChildrenObserved: 0, forkChildrenTerminated: 0, pgCtlExitCode: 0, pgCtlManagedExitCode: 0, pgCtlSucceeded: true, rootExited: true, rootExitCode: 0, rootIdentityVerified: true, unknownChildren: 0 }));
      const pending = stopOwnedEmbeddedPostgresOnWindows({ ...f.options, timeoutMs: 25 });
      const rejected = expect(pending).rejects.toThrow("Timed out");
      await vi.advanceTimersByTimeAsync(25);
      await rejected;
      expect(f.instance.stop).not.toHaveBeenCalled();
      expect(f.instance.process).toBe(f.child);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses an already-exited child instead of waiting for or stopping a reused pid", async () => {
    const f = fixture();
    f.child.exitCode = 0;
    await expect(stopOwnedEmbeddedPostgresOnWindows(f.options)).rejects.toThrow("already exited");
    expect(f.runWindowsNativeStop).not.toHaveBeenCalled();
  });

  it("refuses to clear a replacement child after the captured child exits", async () => {
    const f = fixture();
    const replacement = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      pid: 5252,
      signalCode: null as NodeJS.Signals | null,
    });
    f.runWindowsNativeStop.mockImplementation(async () => {
      f.instance.process = replacement;
      f.child.emit("exit", 0, null);
      return { closureComplete: true, forkChildrenObserved: 0, forkChildrenTerminated: 0, pgCtlExitCode: 0, pgCtlManagedExitCode: 0, pgCtlSucceeded: true, rootExited: true, rootExitCode: 0, rootIdentityVerified: true, unknownChildren: 0 };
    });
    await expect(stopOwnedEmbeddedPostgresOnWindows(f.options)).rejects.toThrow("was replaced");
    expect(f.instance.process).toBe(replacement);
    expect(f.instance.stop).not.toHaveBeenCalled();
  });
});

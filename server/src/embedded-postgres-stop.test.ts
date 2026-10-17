import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { stopOwnedEmbeddedPostgresOnWindows } from "./embedded-postgres-stop.js";

function fixture() {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    pid: 4242,
    signalCode: null as NodeJS.Signals | null,
  });
  const instance = { process: child, stop: vi.fn(async () => undefined) };
  const runPgCtl = vi.fn(async () => { child.emit("exit", 0, null); });
  return {
    child,
    instance,
    runPgCtl,
    options: {
      instance,
      dataDir: "C:\\paperclip-data",
      pgCtlPath: "C:\\runtime\\pg_ctl.exe",
      canonicalizeWindowsDataDirectory: (value: string) => value.replaceAll("/", "\\").toLowerCase(),
      readFile: vi.fn(() => "4242\nC:\\paperclip-data\n"),
      runPgCtl,
    },
  };
}

describe("stopOwnedEmbeddedPostgresOnWindows", () => {
  it("registers the exit listener before fast pg_ctl and never calls vendor stop", async () => {
    const f = fixture();
    await stopOwnedEmbeddedPostgresOnWindows(f.options);
    expect(f.runPgCtl).toHaveBeenCalledWith(
      "C:\\runtime\\pg_ctl.exe",
      ["-D", "C:\\paperclip-data", "stop", "-m", "fast", "-w", "-t", "30"],
      31_000,
    );
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

  it("does not spawn a command for a mismatched pid or data directory", async () => {
    const f = fixture();
    f.options.readFile.mockReturnValue("9999\nC:\\other\n");
    await expect(stopOwnedEmbeddedPostgresOnWindows(f.options)).rejects.toThrow("does not match");
    expect(f.runPgCtl).not.toHaveBeenCalled();
    expect(f.instance.stop).not.toHaveBeenCalled();
    expect(f.instance.process).toBe(f.child);
  });

  it("accepts a Windows junction alias with case and separator differences", async () => {
    const f = fixture();
    f.options.dataDir = "C:\\junction";
    f.options.readFile.mockReturnValue("4242\nc:/PAPERCLIP-data\n");
    f.options.canonicalizeWindowsDataDirectory = (value) => {
      const normalized = value.replaceAll("/", "\\").toLowerCase();
      return normalized === "c:\\junction" ? "c:\\paperclip-data" : normalized;
    };
    await stopOwnedEmbeddedPostgresOnWindows(f.options);
    expect(f.runPgCtl).toHaveBeenCalledOnce();
  });

  it("rejects a different real Windows data directory even when the pid matches", async () => {
    const f = fixture();
    f.options.dataDir = "C:\\junction";
    f.options.readFile.mockReturnValue("4242\nC:\\other-junction\n");
    f.options.canonicalizeWindowsDataDirectory = (value) => {
      const normalized = value.replaceAll("/", "\\").toLowerCase();
      if (normalized === "c:\\junction") return "c:\\paperclip-data";
      if (normalized === "c:\\other-junction") return "c:\\other-data";
      return normalized;
    };
    await expect(stopOwnedEmbeddedPostgresOnWindows(f.options)).rejects.toThrow("does not match");
    expect(f.runPgCtl).not.toHaveBeenCalled();
  });

  it("observes a child exit before pg_ctl and refuses to target a later pid", async () => {
    const f = fixture();
    f.options.canonicalizeWindowsDataDirectory = () => {
      f.child.exitCode = 0;
      f.child.emit("exit", 0, null);
      return "c:\\paperclip-data";
    };
    await expect(stopOwnedEmbeddedPostgresOnWindows(f.options)).rejects.toThrow("already exited");
    expect(f.runPgCtl).not.toHaveBeenCalled();
  });

  it("rejects pg_ctl failures without falling back to taskkill or vendor stop", async () => {
    const f = fixture();
    f.runPgCtl.mockRejectedValueOnce(new Error("pg_ctl failed"));
    await expect(stopOwnedEmbeddedPostgresOnWindows(f.options)).rejects.toThrow("pg_ctl failed");
    expect(f.runPgCtl).toHaveBeenCalledOnce();
    expect(f.instance.stop).not.toHaveBeenCalled();
    expect(f.instance.process).toBe(f.child);
  });

  it("rejects when the owned direct child does not exit by the shared deadline", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.runPgCtl.mockImplementation(async () => undefined);
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
    expect(f.runPgCtl).not.toHaveBeenCalled();
  });

  it("refuses to clear a replacement child after the captured child exits", async () => {
    const f = fixture();
    const replacement = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      pid: 5252,
      signalCode: null as NodeJS.Signals | null,
    });
    f.runPgCtl.mockImplementation(async () => {
      f.instance.process = replacement;
      f.child.emit("exit", 0, null);
    });
    await expect(stopOwnedEmbeddedPostgresOnWindows(f.options)).rejects.toThrow("was replaced");
    expect(f.instance.process).toBe(replacement);
    expect(f.instance.stop).not.toHaveBeenCalled();
  });
});

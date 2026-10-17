import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __setEmbeddedPostgresStopTimeoutForTests,
  __setManagedEmbeddedPostgresShutdownForTests,
  __stopEmbeddedPostgresBoundedForTests as stopBounded,
} from "./test-embedded-postgres.js";

describe("stopEmbeddedPostgresBounded", () => {
  afterEach(() => {
    __setEmbeddedPostgresStopTimeoutForTests(null);
    __setManagedEmbeddedPostgresShutdownForTests(null);
  });

  it("uses only the manager's data-dir-scoped PID fallback after a graceful-stop timeout", async () => {
    let resolveStop: (() => void) | undefined;
    let rawStop: Promise<void> | undefined;
    let resolveRemoval: (() => void) | undefined;
    let removalComplete = false;
    const removal = new Promise<void>((resolve) => { resolveRemoval = resolve; });
    const steps: string[] = [];
    const cleanup = vi.fn(async () => {
      steps.push("reclaim");
      await removal;
      removalComplete = true;
    });
    const shutdown = vi.fn(async () => { steps.push("authority"); });
    __setEmbeddedPostgresStopTimeoutForTests(1);
    __setManagedEmbeddedPostgresShutdownForTests(shutdown);

    const stopped = stopBounded(
      {
        initialise: async () => undefined,
        start: async () => undefined,
        stop: () => {
          rawStop = new Promise<void>((resolve) => { resolveStop = resolve; });
          return rawStop;
        },
      },
      cleanup,
      "C:/tmp/paperclip-owned-timeout-db",
    );

    await stopped;

    expect(shutdown).toHaveBeenCalledWith({
      dataDir: "C:/tmp/paperclip-owned-timeout-db",
      pgCtlPath: null,
      postmasterPid: null,
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(steps).toEqual(["authority", "reclaim"]);
    expect(removalComplete).toBe(false);
    resolveRemoval?.();
    await removal;
    await Promise.resolve();
    expect(removalComplete).toBe(true);

    // Let the original stop settle so its asynchronous cleanup can complete.
    resolveStop?.();
    await rawStop;
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("does not reclaim after an immediate raw-stop rejection when authority fails", async () => {
    const cleanup = vi.fn();
    __setManagedEmbeddedPostgresShutdownForTests(async () => {
      throw new Error("still running");
    });

    await stopBounded(
      { initialise: async () => undefined, start: async () => undefined, stop: async () => { throw new Error("missing pid"); } },
      cleanup,
      "C:/tmp/paperclip-owned-reject-db",
    );

    expect(cleanup).not.toHaveBeenCalled();
  });

  it("reclaims once after manager authority following an immediate raw-stop rejection", async () => {
    const steps: string[] = [];
    const cleanup = vi.fn(() => { steps.push("reclaim"); });
    __setManagedEmbeddedPostgresShutdownForTests(async () => { steps.push("authority"); });

    await stopBounded(
      { initialise: async () => undefined, start: async () => undefined, stop: async () => { throw new Error("missing pid"); } },
      cleanup,
      "C:/tmp/paperclip-owned-reject-db",
    );

    expect(steps).toEqual(["authority", "reclaim"]);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("waits for a later raw-stop resolve before reclaim when timeout authority fails", async () => {
    let resolveStop: (() => void) | undefined;
    let rawStop: Promise<void> | undefined;
    const cleanup = vi.fn();
    __setEmbeddedPostgresStopTimeoutForTests(1);
    __setManagedEmbeddedPostgresShutdownForTests(async () => {
      throw new Error("still running");
    });

    await stopBounded(
      {
        initialise: async () => undefined,
        start: async () => undefined,
        stop: () => {
          rawStop = new Promise<void>((resolve) => { resolveStop = resolve; });
          return rawStop;
        },
      },
      cleanup,
      "C:/tmp/paperclip-owned-pending-db",
    );

    expect(cleanup).not.toHaveBeenCalled();
    resolveStop?.();
    await rawStop;
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

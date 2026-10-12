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
    const cleanup = vi.fn();
    const shutdown = vi.fn(async () => undefined);
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

    // Let the original stop settle so its asynchronous cleanup can complete.
    resolveStop?.();
    await rawStop;
  });
});

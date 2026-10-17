import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createEmbeddedPostgresSupervisor, type SupervisedEmbeddedPostgres } from "../embedded-postgres-supervisor.js";

function createInstance(startError?: Error) {
  const process = new EventEmitter();
  const instance: SupervisedEmbeddedPostgres = {
    process,
    start: vi.fn(async () => { if (startError) throw startError; }),
    stop: vi.fn(async () => undefined),
  };
  return { instance, process };
}

describe("embedded PostgreSQL supervisor", () => {
  it("restarts PostgreSQL after its managed child exits unexpectedly", async () => {
    const initial = createInstance();
    const replacement = createInstance();
    const onRestarted = vi.fn();
    const supervisor = createEmbeddedPostgresSupervisor({
      initialInstance: initial.instance,
      createInstance: () => replacement.instance,
      restartDelaysMs: [0],
      onRestarted,
    });
    initial.process.emit("exit", 137, "SIGKILL");
    await supervisor.waitForRecovery();
    expect(replacement.instance.start).toHaveBeenCalledOnce();
    expect(supervisor.current()).toBe(replacement.instance);
    expect(onRestarted).toHaveBeenCalledWith(1);
  });

  it("does not restart PostgreSQL during orderly shutdown", async () => {
    const initial = createInstance();
    const createReplacement = vi.fn(() => createInstance().instance);
    const supervisor = createEmbeddedPostgresSupervisor({
      initialInstance: initial.instance,
      createInstance: createReplacement,
      restartDelaysMs: [0],
    });
    await supervisor.shutdown();
    expect(initial.instance.stop).toHaveBeenCalledOnce();
    expect(createReplacement).not.toHaveBeenCalled();
  });

  it("uses the supplied stop boundary for normal shutdown", async () => {
    const initial = createInstance();
    const stopInstance = vi.fn(async () => undefined);
    const supervisor = createEmbeddedPostgresSupervisor({
      initialInstance: initial.instance,
      createInstance: () => createInstance().instance,
      stopInstance,
    });
    await supervisor.shutdown();
    expect(stopInstance).toHaveBeenCalledWith(initial.instance);
    expect(initial.instance.stop).not.toHaveBeenCalled();
  });

  it("uses the supplied stop boundary when recovery completes after shutdown began", async () => {
    const initial = createInstance();
    let releaseStart!: () => void;
    const start = new Promise<void>((resolve) => { releaseStart = resolve; });
    const replacement = createInstance();
    replacement.instance.start = vi.fn(() => start);
    const stopInstance = vi.fn(async () => undefined);
    const supervisor = createEmbeddedPostgresSupervisor({
      initialInstance: initial.instance,
      createInstance: () => replacement.instance,
      restartDelaysMs: [0],
      stopInstance,
    });
    initial.process.emit("exit", 1, null);
    await vi.waitFor(() => expect(replacement.instance.start).toHaveBeenCalledOnce());
    const shutdown = supervisor.shutdown();
    releaseStart();
    await shutdown;
    expect(stopInstance).toHaveBeenCalledWith(replacement.instance);
    expect(replacement.instance.stop).not.toHaveBeenCalled();
  });

  it("propagates a stop-boundary failure when recovery finishes during shutdown", async () => {
    const initial = createInstance();
    let releaseStart!: () => void;
    const start = new Promise<void>((resolve) => { releaseStart = resolve; });
    const replacement = createInstance();
    replacement.instance.start = vi.fn(() => start);
    const stopError = new Error("owned PostgreSQL remained alive");
    const supervisor = createEmbeddedPostgresSupervisor({
      initialInstance: initial.instance,
      createInstance: () => replacement.instance,
      restartDelaysMs: [0],
      stopInstance: async () => { throw stopError; },
    });
    initial.process.emit("exit", 1, null);
    await vi.waitFor(() => expect(replacement.instance.start).toHaveBeenCalledOnce());
    const shutdown = supervisor.shutdown();
    const rejected = expect(shutdown).rejects.toThrow(stopError);
    releaseStart();
    await rejected;
  });

  it("bounds recovery attempts and reports the final failure", async () => {
    const initial = createInstance();
    const failures = [new Error("first"), new Error("second"), new Error("third")];
    const onRecoveryExhausted = vi.fn();
    const supervisor = createEmbeddedPostgresSupervisor({
      initialInstance: initial.instance,
      createInstance: () => createInstance(failures.shift()).instance,
      restartDelaysMs: [0, 0, 0],
      onRecoveryExhausted,
    });
    initial.process.emit("exit", 1, null);
    await supervisor.waitForRecovery();
    expect(onRecoveryExhausted).toHaveBeenCalledOnce();
    expect(onRecoveryExhausted).toHaveBeenCalledWith(expect.objectContaining({ message: "third" }));
  });
});

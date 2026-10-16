import fs from "node:fs";
import { fork, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const workerPath = path.resolve(import.meta.dirname, "..", "server-worker.ts");
const fixturePath = path.resolve(import.meta.dirname, "fixtures", "shutdown-fake-server.mjs");
const children: ChildProcess[] = [];
const markerDirs: string[] = [];

afterEach(async () => {
  await Promise.all(children.splice(0).map(async (child) => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }));
  for (const dir of markerDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function waitForMessage(child: ChildProcess, predicate: (message: unknown) => boolean): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for desktop worker IPC message."));
    }, 10_000);
    const onMessage = (message: unknown) => {
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`Desktop worker exited before IPC message (code ${code}, signal ${signal}).`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.removeListener("message", onMessage);
      child.removeListener("exit", onExit);
    };
    child.on("message", onMessage);
    child.once("exit", onExit);
  });
}

function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function startFakeWorker(startDelayMs = 0): { child: ChildProcess; markerPath: string } {
  const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-desktop-worker-shutdown-"));
  const markerPath = path.join(markerDir, "marker.txt");
  markerDirs.push(markerDir);
  const child = fork(workerPath, [], {
    env: {
      ...process.env,
      PAPERCLIP_DESKTOP_SERVER_ENTRY: fixturePath,
      PAPERCLIP_WORKER_TEST_MARKER: markerPath,
      PAPERCLIP_WORKER_TEST_START_DELAY_MS: String(startDelayMs),
    },
    execArgv: ["--import", "tsx"],
    silent: true,
  });
  children.push(child);
  return { child, markerPath };
}

describe("desktop server worker shutdown protocol", () => {
  it("uses the fake server shutdown before acknowledging and exiting", async () => {
    const { child, markerPath } = startFakeWorker();
    await waitForMessage(child, (message) => (message as { type?: string })?.type === "ready");
    const exited = waitForExit(child);
    child.send({ type: "shutdown", requestId: "graceful-request" });
    await expect(waitForMessage(child, (message) => (
      (message as { type?: string; requestId?: string })?.type === "shutdown-complete"
      && (message as { requestId?: string }).requestId === "graceful-request"
    ))).resolves.toEqual({ type: "shutdown-complete", requestId: "graceful-request" });
    await expect(exited).resolves.toEqual({ code: 0, signal: null });
    expect(fs.readFileSync(markerPath, "utf8")).toBe("start\nshutdown\n");
  });

  it("suppresses ready during startup when shutdown arrives first", async () => {
    const { child, markerPath } = startFakeWorker(50);
    const messages: unknown[] = [];
    child.on("message", (message) => messages.push(message));
    const exited = waitForExit(child);
    child.send({ type: "shutdown", requestId: "startup-race" });
    await expect(waitForMessage(child, (message) => (
      (message as { type?: string; requestId?: string })?.type === "shutdown-complete"
      && (message as { requestId?: string }).requestId === "startup-race"
    ))).resolves.toEqual({ type: "shutdown-complete", requestId: "startup-race" });
    await expect(exited).resolves.toEqual({ code: 0, signal: null });
    expect(messages).not.toContainEqual(expect.objectContaining({ type: "ready" }));
    expect(fs.readFileSync(markerPath, "utf8")).toBe("start\nshutdown\n");
  });
});

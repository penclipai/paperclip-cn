import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { detachOwnedReadonlyVolume } from "./installer-volume.mjs";
import { cleanupMountedInstallerVolume, runRuntimePayloadProbe } from "./verify-runtime-payload.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function ownedMount() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "paperclip-installer-volume-")));
  roots.push(root);
  const mountPoint = path.join(root, "volume");
  return { root, mountPoint };
}

test("retries hdiutil exit 16 before a successful owned readonly detach", async () => {
  const { root, mountPoint } = await ownedMount();
  const calls = [];
  const result = detachOwnedReadonlyVolume({
    temporaryRoot: root,
    mountPoint,
    readonlyMount: true,
    sleep: () => {},
    runCommand: (_command, args) => {
      calls.push(args);
      return calls.length < 3 ? { status: 16, stderr: "resource busy" } : { status: 0, stderr: "" };
    },
  });
  assert.deepEqual(result, { attempts: 3, forced: false });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((args) => !args.includes("-force")));
});

test("uses force only after bounded busy retries and rejects non-busy failures", async () => {
  const { root, mountPoint } = await ownedMount();
  const calls = [];
  const result = detachOwnedReadonlyVolume({
    temporaryRoot: root,
    mountPoint,
    readonlyMount: true,
    sleep: () => {},
    runCommand: (_command, args) => {
      calls.push(args);
      return calls.length === 4 ? { status: 0, stderr: "" } : { status: 16, stderr: "busy" };
    },
  });
  assert.deepEqual(result, { attempts: 4, forced: true });
  assert.ok(calls.at(-1).includes("-force"));

  assert.throws(() => detachOwnedReadonlyVolume({
    temporaryRoot: root,
    mountPoint,
    readonlyMount: true,
    sleep: () => {},
    runCommand: () => ({ status: 1, stderr: "permission denied" }),
  }), /exit 1.*permission denied/i);

  let forceAttempt = 0;
  assert.throws(() => detachOwnedReadonlyVolume({
    temporaryRoot: root,
    mountPoint,
    readonlyMount: true,
    sleep: () => {},
    runCommand: (_command, args) => {
      forceAttempt += 1;
      return args.includes("-force") ? { status: 1, stderr: "force denied" } : { status: 16, stderr: "busy" };
    },
  }), /force-detach failed.*force denied/i);
  assert.equal(forceAttempt, 4);
});

test("refuses external or non-readonly force boundaries", async () => {
  const { root, mountPoint } = await ownedMount();
  assert.throws(() => detachOwnedReadonlyVolume({
    temporaryRoot: root,
    mountPoint: path.join(path.dirname(root), "outside"),
    readonlyMount: true,
    runCommand: () => ({ status: 0, stderr: "" }),
  }), /owned temporary root/i);
  assert.throws(() => detachOwnedReadonlyVolume({
    temporaryRoot: root,
    mountPoint,
    readonlyMount: false,
    runCommand: () => ({ status: 16, stderr: "busy" }),
  }), /readonly/i);
});

test("propagates a runtime probe child failure", () => {
  assert.throws(() => runRuntimePayloadProbe({
    runtimeRoot: "/fixture/runtime",
    platform: "darwin",
    arch: "x64",
    description: "fixture",
    spawn: () => ({ status: 1, stdout: "", stderr: "probe failed" }),
  }), /probe failed/i);
});

test("propagates an actual isolated probe process failure", () => {
  const missingRuntime = path.join(tmpdir(), `paperclip-missing-runtime-${process.pid}-${Date.now()}`);
  assert.throws(() => runRuntimePayloadProbe({
    runtimeRoot: missingRuntime,
    platform: "darwin",
    arch: "x64",
    description: "missing fixture",
  }), /Packaged runtime probe failed[\s\S]*ENOENT/i);
});

test("does not traverse a mounted volume after detach failure", async () => {
  const { root, mountPoint } = await ownedMount();
  const calls = [];
  assert.throws(() => cleanupMountedInstallerVolume({
    temporaryRoot: root,
    mountPoint,
    mounted: true,
    detach: () => { throw new Error("still busy"); },
    remove: (target) => calls.push(target),
  }), /still busy/i);
  assert.deepEqual(calls, []);
});

test("removes temporary data only after detach and returns its force status", async () => {
  const { root, mountPoint } = await ownedMount();
  const calls = [];
  const result = cleanupMountedInstallerVolume({
    temporaryRoot: root,
    mountPoint,
    mounted: true,
    detach: () => ({ attempts: 4, forced: true }),
    remove: (target) => calls.push(target),
  });
  assert.deepEqual(result, { mounted: false, detach: { attempts: 4, forced: true }, preservedTemporaryRoot: null });
  assert.deepEqual(calls, [root]);
});

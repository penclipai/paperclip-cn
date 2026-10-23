import assert from "node:assert/strict";
import test from "node:test";
import { DESKTOP_SIZE_BASELINES, evaluateDesktopSizeBudget } from "./desktop-size-budget.mjs";

const MIB = 1024 * 1024;

function auditFor({ platform = "win", arch = "x64", installerBytes, runtimeBytes }) {
  const baseline = DESKTOP_SIZE_BASELINES[`${platform}/${arch}`];
  return {
    platform,
    arch,
    releaseAssets: { bytes: installerBytes, files: 1 },
    releaseAssetFiles: [{ name: `Paperclip-CN${baseline?.installerSuffix ?? ".exe"}`, bytes: installerBytes }],
    appRuntime: { bytes: runtimeBytes },
  };
}

test("accepts every reviewed platform baseline", () => {
  for (const [target, baseline] of Object.entries(DESKTOP_SIZE_BASELINES)) {
    const [platform, arch] = target.split("/");
    const result = evaluateDesktopSizeBudget(auditFor({
      platform,
      arch,
      installerBytes: baseline.installerBytes,
      runtimeBytes: baseline.appRuntimeBytes,
    }));

    assert.equal(result.ok, true, target);
    assert.equal(result.target, target);
    assert.ok(result.metrics.installer.deltaBytes < 0, target);
    assert.ok(result.metrics.appRuntime.deltaBytes < 0, target);
  }
});

test("fails when either hard budget is exceeded and reports the delta", () => {
  const result = evaluateDesktopSizeBudget(auditFor({
    installerBytes: Math.floor(585_055_249 * 1.05) + 1,
    runtimeBytes: Math.floor(2008.67 * MIB * 1.05) + 1,
  }));

  assert.equal(result.ok, false);
  assert.match(result.summary, /installer: actual .* over by 0\.00 MiB/i);
  assert.match(result.summary, /app runtime: actual .* over by 0\.00 MiB/i);
});

test("fails closed for missing, unsupported, zero, and ambiguous installer data", () => {
  assert.throws(() => evaluateDesktopSizeBudget({}), /platform/i);
  assert.throws(() => evaluateDesktopSizeBudget(auditFor({
    platform: "win",
    arch: "arm64",
    installerBytes: 1,
    runtimeBytes: 1,
  })), /Unsupported desktop target/i);
  assert.throws(() => evaluateDesktopSizeBudget(auditFor({
    installerBytes: 0,
    runtimeBytes: 1,
  })), /installer bytes/i);
  assert.throws(() => evaluateDesktopSizeBudget({
    ...auditFor({ installerBytes: 1, runtimeBytes: 1 }),
    releaseAssetFiles: [
      { name: "one.exe", bytes: 1 },
      { name: "two.exe", bytes: 1 },
    ],
  }), /exactly one/i);
  assert.throws(() => evaluateDesktopSizeBudget({
    ...auditFor({ installerBytes: 1, runtimeBytes: 1 }),
    releaseAssetFiles: [{ name: "Paperclip-CN.dmg", bytes: 1 }],
  }), /ending in \.exe/i);
  assert.throws(() => evaluateDesktopSizeBudget(auditFor({
    installerBytes: 1,
    runtimeBytes: Number.NaN,
  })), /app runtime bytes/i);
});

#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIB = 1024 * 1024;
const BUDGET_HEADROOM = 0.05;

// v2026.1021.0 published installer sizes. Keep a small reviewed margin for
// dependency patch releases; lower these only after a measured release build.
export const DESKTOP_SIZE_BASELINES = Object.freeze({
  "mac/arm64": {
    installerBytes: 713_626_425,
    appRuntimeBytes: 2004.90 * MIB,
    installerSuffix: ".dmg",
  },
  "mac/x64": {
    installerBytes: 794_749_228,
    appRuntimeBytes: 2212.66 * MIB,
    installerSuffix: ".dmg",
  },
  "linux/x64": {
    installerBytes: 721_382_967,
    appRuntimeBytes: 2835.69 * MIB,
    installerSuffix: ".AppImage",
  },
  "win/x64": {
    installerBytes: 585_055_249,
    appRuntimeBytes: 2008.67 * MIB,
    installerSuffix: ".exe",
  },
});

function asPositiveFiniteNumber(value, description) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Desktop size budget requires positive finite ${description}.`);
  }
  return value;
}

function formatMiB(bytes) {
  return `${(bytes / MIB).toFixed(2)} MiB`;
}

function formatMetric(name, actualBytes, budgetBytes) {
  const deltaBytes = actualBytes - budgetBytes;
  const status = deltaBytes > 0 ? `over by ${formatMiB(deltaBytes)}` : `within by ${formatMiB(-deltaBytes)}`;
  return `${name}: actual ${formatMiB(actualBytes)}, budget ${formatMiB(budgetBytes)}, ${status}`;
}

function validateInstaller(audit, baseline) {
  if (!Array.isArray(audit.releaseAssetFiles) || audit.releaseAssetFiles.length !== 1) {
    throw new Error("Desktop size budget requires exactly one release installer asset.");
  }

  const [installer] = audit.releaseAssetFiles;
  if (!installer || typeof installer.name !== "string" || !installer.name.endsWith(baseline.installerSuffix)) {
    throw new Error(`Desktop size budget requires one installer ending in ${baseline.installerSuffix}.`);
  }

  const installerBytes = asPositiveFiniteNumber(installer.bytes, "installer bytes");
  const aggregateBytes = asPositiveFiniteNumber(audit.releaseAssets?.bytes, "release asset bytes");
  if (installerBytes !== aggregateBytes) {
    throw new Error("Desktop size budget requires release asset bytes to match the single installer.");
  }
  if (audit.releaseAssets?.files !== 1) {
    throw new Error("Desktop size budget requires exactly one counted release installer asset.");
  }

  return installerBytes;
}

export function evaluateDesktopSizeBudget(audit) {
  if (!audit || typeof audit !== "object") {
    throw new Error("Desktop size budget requires an audit object.");
  }

  if (typeof audit.platform !== "string" || audit.platform.length === 0) {
    throw new Error("Desktop size budget requires a platform.");
  }
  if (typeof audit.arch !== "string" || audit.arch.length === 0) {
    throw new Error("Desktop size budget requires an arch.");
  }

  const target = `${audit.platform}/${audit.arch}`;
  const baseline = DESKTOP_SIZE_BASELINES[target];
  if (!baseline) {
    throw new Error(`Unsupported desktop target for size budget: ${target}.`);
  }

  const installerActualBytes = validateInstaller(audit, baseline);
  const appRuntimeActualBytes = asPositiveFiniteNumber(audit.appRuntime?.bytes, "app runtime bytes");
  const installerBudgetBytes = Math.floor(baseline.installerBytes * (1 + BUDGET_HEADROOM));
  const appRuntimeBudgetBytes = Math.floor(baseline.appRuntimeBytes * (1 + BUDGET_HEADROOM));
  const metrics = {
    installer: {
      actualBytes: installerActualBytes,
      budgetBytes: installerBudgetBytes,
      deltaBytes: installerActualBytes - installerBudgetBytes,
    },
    appRuntime: {
      actualBytes: appRuntimeActualBytes,
      budgetBytes: appRuntimeBudgetBytes,
      deltaBytes: appRuntimeActualBytes - appRuntimeBudgetBytes,
    },
  };
  const failures = Object.entries(metrics)
    .filter(([, metric]) => metric.deltaBytes > 0)
    .map(([name, metric]) => formatMetric(name === "appRuntime" ? "app runtime" : name, metric.actualBytes, metric.budgetBytes));

  return {
    ok: failures.length === 0,
    target,
    baseline,
    metrics,
    summary: [
      `Desktop size budget for ${target}:`,
      formatMetric("installer", metrics.installer.actualBytes, metrics.installer.budgetBytes),
      formatMetric("app runtime", metrics.appRuntime.actualBytes, metrics.appRuntime.budgetBytes),
      ...(failures.length > 0 ? [`Exceeded hard budget: ${failures.join("; ")}`] : ["All hard budgets passed."]),
    ].join(" "),
  };
}

function parseArgs(argv) {
  const args = { manifestPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      args.manifestPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--manifest=")) {
      args.manifestPath = arg.slice("--manifest=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function runCli() {
  const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(args.manifestPath ?? path.resolve(packageDir, "release", "desktop-artifacts.json"));
  if (!existsSync(manifestPath)) {
    throw new Error(`Desktop artifact manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const auditPath = manifest.sizeAudit?.jsonPath;
  if (typeof auditPath !== "string" || auditPath.length === 0 || !existsSync(auditPath)) {
    throw new Error(`Desktop size audit JSON not found from manifest: ${manifestPath}`);
  }

  const audit = JSON.parse(readFileSync(auditPath, "utf8"));
  const result = evaluateDesktopSizeBudget(audit);
  console.log(`[desktop-size-budget] ${result.summary}`);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    runCli();
  } catch (error) {
    console.error("[desktop-size-budget] Failed:", error);
    process.exitCode = 1;
  }
}

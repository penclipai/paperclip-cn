import { spawnSync } from "node:child_process";
import { resolvePnpmInvocation } from "./pnpm-invocation.mjs";

/**
 * Keep this harness small and principle-driven.
 *
 * Admission criteria for suites:
 * - guards a merge-sensitive invariant that has regressed or is easy to break by hand-merge
 * - exercises infrastructure/contract behavior rather than a single feature flow
 * - stays lightweight and deterministic enough to run before the full gate on every upstream sync
 *
 * The concrete suite list is intentionally maintained here, not in the runbook.
 */
const HARNESS_GROUPS = {
  responseLifecycleAndErrorHandling: [
    "server/src/__tests__/error-handler.test.ts",
  ],
  localeAndI18nInfrastructure: [
    "server/src/__tests__/adapter-prompt-context.test.ts",
    "server/src/__tests__/agent-runtime-localization.test.ts",
    "server/src/__tests__/heartbeat-runtime-locale.test.ts",
    "server/src/__tests__/i18n.test.ts",
    "server/src/__tests__/locale-middleware.test.ts",
    "server/src/__tests__/ui-locale.test.ts",
  ],
  windowsWorktreeAndEnvCompatibility: [
    "server/src/__tests__/worktree-config.test.ts",
  ],
  externalAdapterReflection: [
    "server/src/__tests__/llms-routes.test.ts",
  ],
};

const suites = Object.values(HARNESS_GROUPS).flat();
const extraArgs = process.argv.slice(2);

console.log("[upstream-merge-harness] running merge-sensitive invariant suites:");
for (const [groupName, groupSuites] of Object.entries(HARNESS_GROUPS)) {
  console.log(`- ${groupName}`);
  for (const suite of groupSuites) {
    console.log(`  ${suite}`);
  }
}

const invocation = resolvePnpmInvocation(["exec", "vitest", "run", ...suites, ...extraArgs]);

const result = spawnSync(
  invocation.command,
  invocation.args,
  {
    stdio: "inherit",
    shell: false,
    ...invocation.spawnOptions,
  },
);

if (result.error) {
  console.error("[upstream-merge-harness] failed to start test runner", result.error);
  process.exit(1);
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);

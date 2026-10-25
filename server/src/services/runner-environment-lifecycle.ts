import { resolvePaperclipRunnerIdleTimeoutMs } from "@penclipai/adapter-utils";
import type { Environment } from "@penclipai/shared";

/** Resolve runner retention before acquiring a sandbox, not after it is ephemeral.
 * This is a run-scoped view; never persist it over a shared environment's config.
 * The driver still verifies provider support and chooses the actual lease policy.
 */
export function resolveRunnerEnvironmentForRun<T extends Pick<Environment, "driver" | "config">>(
  environment: T,
  adapterType: string,
  adapterConfig: Record<string, unknown> = {},
  admittedLifecycleMode?: "warm" | "per_turn",
): T {
  if (adapterType !== "paperclip_runner" || !["sandbox", "plugin"].includes(environment.driver)) return environment;
  const config = environment.config ?? {};
  const lifecycleMode = admittedLifecycleMode ?? (config.runnerLifecycleMode === "warm" || config.runnerLifecycleMode === "per_turn"
    ? config.runnerLifecycleMode
    : adapterConfig.lifecycleMode);
  if (environment.driver === "plugin") return { ...environment, config: { ...config,
    runnerLifecycleMode: lifecycleMode === "warm" && (adapterConfig.provider ?? "codex") === "codex" ? "warm" : "per_turn",
    runnerIdleTimeoutMs: resolvePaperclipRunnerIdleTimeoutMs(config.runnerIdleTimeoutMs ?? adapterConfig.idleTimeoutMs),
  } };
  if (lifecycleMode !== "warm") return environment;
  return {
    ...environment,
    config: {
      ...config,
      reuseLease: true,
    },
  };
}

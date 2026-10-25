import type { Db } from "@penclipai/db";
import type { Agent, EnvironmentProbeResult } from "@penclipai/shared";
import { conflict, unprocessable } from "../errors.js";
import { resolveAgentRunnerEnvironmentForCompany } from "./agent-runner-selection.js";
import { probeEnvironment } from "./environment-probe.js";
import type { PluginWorkerManager } from "./plugin-worker-manager.js";

export async function qualifyAgentRunner(
  db: Db,
  agent: Pick<Agent, "companyId" | "adapterType" | "defaultEnvironmentId">,
  expectedEnvironmentId: string,
  pluginWorkerManager?: PluginWorkerManager,
): Promise<EnvironmentProbeResult> {
  if (!["claude_local", "codex_local"].includes(agent.adapterType)) {
    throw unprocessable("This agent does not need a runner upgrade.");
  }
  const { environment } = await resolveAgentRunnerEnvironmentForCompany(db, agent.companyId, agent.defaultEnvironmentId);
  if (!environment || environment.id !== expectedEnvironmentId) {
    throw conflict("The agent's computer changed. Save any environment changes, reload, and retry the upgrade.");
  }
  if (environment.driver !== "sandbox") {
    throw unprocessable("This computer does not need sandbox qualification.");
  }
  const result = await probeEnvironment(db, environment, {
    companyId: agent.companyId,
    pluginWorkerManager,
    applyCustomImageTemplate: true,
    acquireSandboxRuntimeLease: true,
    assertCompanyBinding: true,
  });
  const qualified = result.ok === true && result.details?.platformQualificationRecorded === true;
  return {
    ok: result.ok,
    driver: "sandbox",
    summary: qualified ? "The agent's computer is qualified for runner selection."
      : "Could not qualify the agent's computer. Retry the upgrade or keep Legacy runner.",
    details: {
      platformQualificationRecorded: qualified,
      ...(typeof result.details?.leaseId === "string" ? { leaseId: result.details.leaseId } : {}),
    },
  };
}

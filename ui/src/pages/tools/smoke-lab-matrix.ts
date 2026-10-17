import {
  SMOKE_RUN_STEP_PATHS,
  type SmokeRun,
  type SmokeRunStep,
  type SmokeRunStepPath,
  type SmokeRunStepStatus,
} from "@penclipai/shared";

/**
 * Pure matrix/health helpers for the Smoke Lab tab (PAP-13347 / S2, plan §D3).
 * Kept free of React so the cell/health logic is unit-testable on its own.
 *
 * The integration matrix is the plan §3 table: rows are the seven paths
 * (P1–P7), columns are the PAP-12373 governed lifecycle. Each recorded step
 * carries a free-form `scenarioStep` string owned by the S4 catalog; we fold it
 * onto a canonical lifecycle stage by keyword so the matrix stays a stable
 * 7×8 grid no matter how S4 words its steps. Raw `scenarioStep` values are
 * always shown verbatim in the run drill-down, so nothing is hidden.
 */

export const SMOKE_PATH_LABELS: Record<SmokeRunStepPath, {
  titleKey: string;
  titleDefault: string;
  detailKey: string;
  detailDefault: string;
}> = {
  P1: {
    titleKey: "tools.smokeLab.paths.p1.title",
    titleDefault: "Remote HTTP · OAuth",
    detailKey: "tools.smokeLab.paths.p1.detail",
    detailDefault: "HTTP MCP fixture behind the fake OAuth provider",
  },
  P2: {
    titleKey: "tools.smokeLab.paths.p2.title",
    titleDefault: "Remote HTTP · API key",
    detailKey: "tools.smokeLab.paths.p2.detail",
    detailDefault: "HTTP MCP fixture with a static bearer key",
  },
  P3: {
    titleKey: "tools.smokeLab.paths.p3.title",
    titleDefault: "Local stdio (template)",
    detailKey: "tools.smokeLab.paths.p3.detail",
    detailDefault: "stdio fixture via the runtime supervisor",
  },
  P4: {
    titleKey: "tools.smokeLab.paths.p4.title",
    titleDefault: "Plugin integration",
    detailKey: "tools.smokeLab.paths.p4.detail",
    detailDefault: "plugin-provided catalog entry + install flow",
  },
  P5: {
    titleKey: "tools.smokeLab.paths.p5.title",
    titleDefault: "Paste-a-config import",
    detailKey: "tools.smokeLab.paths.p5.detail",
    detailDefault: "prosumer import via Advanced setup",
  },
  P6: {
    titleKey: "tools.smokeLab.paths.p6.title",
    titleDefault: "Token broker / gateway",
    detailKey: "tools.smokeLab.paths.p6.detail",
    detailDefault: "run-scoped connection token, TTL + scope checks",
  },
  P7: {
    titleKey: "tools.smokeLab.paths.p7.title",
    titleDefault: "Governance surfaces",
    detailKey: "tools.smokeLab.paths.p7.detail",
    detailDefault: "profiles, ask-first rules, quarantine",
  },
};

export interface LifecycleStage {
  key: string;
  labelKey: string;
  labelDefault: string;
  /** Keywords (lowercased) that fold a `scenarioStep` onto this stage. */
  match: string[];
}

/** The PAP-12373 governed lifecycle, in order (plan §3). */
export const LIFECYCLE_STAGES: LifecycleStage[] = [
  { key: "connect", labelKey: "tools.smokeLab.stages.connect", labelDefault: "Connect", match: ["connect", "oauth", "login", "auth"] },
  { key: "discover", labelKey: "tools.smokeLab.stages.discover", labelDefault: "Discover catalog", match: ["discover", "catalog", "list-tools"] },
  { key: "read", labelKey: "tools.smokeLab.stages.read", labelDefault: "Allowed read", match: ["read", "allowed"] },
  { key: "write", labelKey: "tools.smokeLab.stages.write", labelDefault: "Ask-first write", match: ["write", "approve", "ask-first", "askfirst", "review"] },
  { key: "deny", labelKey: "tools.smokeLab.stages.deny", labelDefault: "Denied call", match: ["deny", "denied", "block", "forbidden"] },
  { key: "quarantine", labelKey: "tools.smokeLab.stages.quarantine", labelDefault: "Schema-change quarantine", match: ["quarantine", "schema"] },
  { key: "revoke", labelKey: "tools.smokeLab.stages.revoke", labelDefault: "Revoke", match: ["revoke"] },
  { key: "audit", labelKey: "tools.smokeLab.stages.audit", labelDefault: "Audit evidence", match: ["audit", "activity", "evidence"] },
];

/** Fold a free-form scenario step onto a canonical lifecycle stage, or null. */
export function matchLifecycleStage(scenarioStep: string): string | null {
  const s = scenarioStep.toLowerCase();
  for (const stage of LIFECYCLE_STAGES) {
    if (stage.match.some((kw) => s.includes(kw))) return stage.key;
  }
  return null;
}

export type CellStatus = SmokeRunStepStatus | "not-run";

function stepTime(step: SmokeRunStep): number {
  const raw = step.updatedAt ?? step.createdAt;
  const t = new Date(raw as string | Date).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Latest status per (path, stage) cell across the given steps. Later steps win
 * so a matrix always reflects the most recent attempt at each cell.
 */
export function buildSmokeMatrix(steps: SmokeRunStep[]): Map<string, { status: CellStatus; step: SmokeRunStep }> {
  const cells = new Map<string, { status: CellStatus; step: SmokeRunStep }>();
  const ordered = [...steps].sort((a, b) => stepTime(a) - stepTime(b));
  for (const step of ordered) {
    const stage = matchLifecycleStage(step.scenarioStep);
    if (!stage) continue;
    cells.set(`${step.path}::${stage}`, { status: step.status, step });
  }
  return cells;
}

export function cellKey(path: SmokeRunStepPath, stageKey: string): string {
  return `${path}::${stageKey}`;
}

export const SMOKE_PATHS = SMOKE_RUN_STEP_PATHS;

export type SmokeHealth = "green" | "amber" | "red" | "unknown";

/** Overall traffic-light for a run: red on any failure, amber if unfinished/empty. */
export function runHealth(run: SmokeRun | undefined, steps: SmokeRunStep[]): SmokeHealth {
  if (!run) return "unknown";
  if (run.status === "failed") return "red";
  if (steps.some((s) => s.status === "fail")) return "red";
  if (run.summary.partial === true) return "amber";
  if (run.status === "cancelled") return "amber";
  if (run.status === "running") return "amber";
  if (steps.length === 0) return "amber";
  return "green";
}

/** Paths with at least one failing step in the given run. */
export function failingPaths(steps: SmokeRunStep[]): SmokeRunStepPath[] {
  const failed = new Set<SmokeRunStepPath>();
  for (const step of steps) {
    if (step.status === "fail") failed.add(step.path);
  }
  return SMOKE_RUN_STEP_PATHS.filter((p) => failed.has(p));
}

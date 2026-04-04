import { eq, and, gt, lt, isNull } from "drizzle-orm";
import type { Db } from "@penclipai/db";
import { agents, activityLog } from "@penclipai/db";

export type CircuitBreakerState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  /** Maximum consecutive failures before opening circuit */
  maxConsecutiveFailures: number;
  /** Time window (ms) to consider an agent "stuck" with no progress */
  noProgressTimeoutMs: number;
  /** Minimum time (ms) before allowing a retry in half-open state */
  retryDelayMs: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  maxConsecutiveFailures: 5,
  noProgressTimeoutMs: 30 * 60 * 1000, // 30 minutes
  retryDelayMs: 15 * 60 * 1000, // 15 minutes
};

export function circuitBreakerService(db: Db, config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG) {

  /**
   * Record a successful operation for an agent.
   * Resets the failure counter and closes the circuit.
   */
  async function recordSuccess(agentId: string): Promise<void> {
    const now = new Date();
    await db
      .update(agents)
      .set({
        consecutiveFailures: 0,
        lastSuccessAt: now,
        circuitBreakerState: "closed",
        updatedAt: now,
      })
      .where(eq(agents.id, agentId));
  }

  /**
   * Record a failed operation for an agent.
   * Increments failure counter and may open the circuit.
   */
  async function recordFailure(agentId: string, error?: string): Promise<void> {
    const now = new Date();
    const agent = await db
      .select({
        id: agents.id,
        consecutiveFailures: agents.consecutiveFailures,
        circuitBreakerState: agents.circuitBreakerState,
        status: agents.status,
        pauseReason: agents.pauseReason,
        pausedAt: agents.pausedAt,
        companyId: agents.companyId,
      })
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((rows) => rows[0] ?? null);

    if (!agent) return;

    const newFailureCount = agent.consecutiveFailures + 1;
    const shouldOpenCircuit = newFailureCount >= config.maxConsecutiveFailures;

    await db
      .update(agents)
      .set({
        consecutiveFailures: newFailureCount,
        lastFailureAt: now,
        circuitBreakerState: shouldOpenCircuit ? "open" : agent.circuitBreakerState,
        status: shouldOpenCircuit ? "paused" : agent.status,
        pauseReason: shouldOpenCircuit
          ? `Circuit breaker opened after ${newFailureCount} consecutive failures`
          : agent.pauseReason,
        pausedAt: shouldOpenCircuit && !agent.pausedAt ? now : agent.pausedAt,
        updatedAt: now,
      })
      .where(eq(agents.id, agentId));

    if (shouldOpenCircuit) {
      await db.insert(activityLog).values({
        companyId: agent.companyId,
        actorId: "system",
        actorType: "system",
        action: "agent.circuit_breaker_opened",
        entityType: "agent",
        entityId: agentId,
        details: {
          failureCount: newFailureCount,
          error: error?.substring(0, 500),
          config: config,
        },
        createdAt: now,
      });
    }
  }

  /**
   * Check if an agent's circuit is open (should not accept work).
   */
  async function isCircuitOpen(agentId: string): Promise<boolean> {
    const agent = await db
      .select({
        circuitBreakerState: agents.circuitBreakerState,
      })
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((rows) => rows[0] ?? null);

    return agent?.circuitBreakerState === "open";
  }

  /**
   * Attempt to close a circuit (retry after failure).
   * Moves from "open" to "half_open" state.
   */
  async function attemptRetry(agentId: string): Promise<boolean> {
    const now = new Date();
    const agent = await db
      .select({
        id: agents.id,
        circuitBreakerState: agents.circuitBreakerState,
        lastFailureAt: agents.lastFailureAt,
      })
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((rows) => rows[0] ?? null);

    if (!agent || agent.circuitBreakerState !== "open") return false;

    const timeSinceFailure = agent.lastFailureAt
      ? now.getTime() - agent.lastFailureAt.getTime()
      : Infinity;

    if (timeSinceFailure < config.retryDelayMs) {
      return false; // Too soon to retry
    }

    await db
      .update(agents)
      .set({
        circuitBreakerState: "half_open",
        updatedAt: now,
      })
      .where(eq(agents.id, agentId));

    return true;
  }

  /**
   * Detect agents that have been stuck with no progress for too long.
   * This is a maintenance function that should be called periodically.
   */
  async function detectStuckAgents(): Promise<string[]> {
    const cutoffTime = new Date(Date.now() - config.noProgressTimeoutMs);

    const stuckAgents = await db
      .select({
        id: agents.id,
        name: agents.name,
        lastHeartbeatAt: agents.lastHeartbeatAt,
        lastSuccessAt: agents.lastSuccessAt,
        lastFailureAt: agents.lastFailureAt,
        consecutiveFailures: agents.consecutiveFailures,
      })
      .from(agents)
      .where(
        and(
          eq(agents.status, "running"),
          eq(agents.circuitBreakerState, "closed"),
          gt(agents.consecutiveFailures, 0),
          lt(agents.lastHeartbeatAt ?? new Date(0), cutoffTime),
          isNull(agents.lastSuccessAt),
        ),
      );

    const stuckIds: string[] = [];
    for (const agent of stuckAgents) {
      await recordFailure(
        agent.id,
        `No progress detected for ${config.noProgressTimeoutMs / 1000 / 60} minutes`,
      );
      stuckIds.push(agent.id);
    }

    return stuckIds;
  }

  /**
   * Get circuit breaker status for an agent.
   */
  async function getStatus(agentId: string): Promise<{
    state: CircuitBreakerState;
    consecutiveFailures: number;
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
    isHealthy: boolean;
  } | null> {
    const agent = await db
      .select({
        circuitBreakerState: agents.circuitBreakerState,
        consecutiveFailures: agents.consecutiveFailures,
        lastSuccessAt: agents.lastSuccessAt,
        lastFailureAt: agents.lastFailureAt,
      })
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((rows) => rows[0] ?? null);

    if (!agent) return null;

    return {
      state: agent.circuitBreakerState as CircuitBreakerState,
      consecutiveFailures: agent.consecutiveFailures,
      lastSuccessAt: agent.lastSuccessAt,
      lastFailureAt: agent.lastFailureAt,
      isHealthy: agent.circuitBreakerState === "closed" && agent.consecutiveFailures === 0,
    };
  }

  return {
    recordSuccess,
    recordFailure,
    isCircuitOpen,
    attemptRetry,
    detectStuckAgents,
    getStatus,
  };
}

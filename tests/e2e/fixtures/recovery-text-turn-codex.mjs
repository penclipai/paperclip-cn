#!/usr/bin/env node
// Test-only Codex app-server provider. Its first provider turn publishes a
// closed, text-only Codex rollout and then waits for the owning runner to be
// stopped by the E2E. The successor turn completes through the real native
// task-control tool. It never exposes an MCP or semantic tool before faulting.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

if (process.argv.includes("--version")) {
  console.log("codex-cli 0.115.0 (text-turn recovery fixture)");
  process.exit(0);
}

const fixtureIndex = process.argv.indexOf("--text-turn-recovery-fixture");
const marker = fixtureIndex >= 0 ? process.argv[fixtureIndex + 1] : undefined;
const statePath = fixtureIndex >= 0 ? process.argv[fixtureIndex + 2] : undefined;
if (!marker || !statePath) {
  throw new Error("text-turn recovery fixture requires test-owned state paths");
}

let threadId = `text-turn-${randomUUID()}`;
let active = null;
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const readState = async () => {
  try { return JSON.parse(await readFile(statePath, "utf8")); } catch { return null; }
};
const writeState = async (value) => {
  await mkdir(resolve(statePath, ".."), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(value)}\n`, { flag: "w" });
};
async function writeClosedTextRollout(turnId) {
  const home = process.env.CODEX_HOME;
  if (!home || !process.env.HOME || resolve(home) !== resolve(process.env.HOME)) {
    throw new Error("fixture requires the isolated native provider home");
  }
  const cwd = process.cwd();
  const dir = join(home, "sessions");
  await mkdir(dir, { recursive: true });
  const rows = [
    { type: "session_meta", payload: { id: threadId, cwd } },
    { type: "event_msg", payload: { type: "task_started", turn_id: turnId } },
    { type: "turn_context", payload: { turn_id: turnId, cwd } },
    { type: "event_msg", payload: { type: "turn_aborted", turn_id: turnId, reason: "interrupted" } },
  ];
  const rollout = join(dir, `rollout-${randomUUID()}-${threadId}.jsonl`);
  await writeFile(rollout, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, { flag: "wx" });
  return { rollout, cwd };
}
export function promptJson(prompt, marker) {
  const index = prompt.indexOf(marker);
  if (index < 0) return null;
  const block = prompt.slice(index + marker.length).match(/^(`{3,})[^\r\n]*\r?\n([\s\S]*?)^\1[ \t]*\r?$/m);
  try { return block ? JSON.parse(block[2]) : null; } catch { return null; }
}
export function currentGoalFromPrompt(prompt) {
  const context = promptJson(prompt, "## Current request and continuation context");
  if (!context || typeof context !== "object") return null;
  if (typeof context.objective === "string" && context.objective.trim()) return { value: context.objective, source: "continuation_objective" };
  if (context.objectiveSource?.kind !== "comment" || !Array.isArray(context.messages)) return null;
  const entry = context.messages.find((item) => item.id === context.objectiveSource.id && item.updatedAt === context.objectiveSource.revision && !item.deleted && !item.createdByRunId);
  return typeof entry?.body === "string" && entry.body.trim() ? { value: entry.body, source: "continuation_comment" } : null;
}
export function turnEnvelope(params) {
  for (const part of params?.input ?? []) {
    try {
      const outer = JSON.parse(part.text);
      const envelope = typeof outer.message === "string" ? JSON.parse(outer.message) : outer;
      const contract = envelope.task?.completionContract ?? envelope.completionContract;
      const prompt = envelope.task?.task?.prompt ?? envelope.task?.prompt ?? "";
      if (!contract || typeof contract.revision !== "string" || !Array.isArray(contract.criteria)) continue;
      const criterionIds = contract.criteria.map((criterion) => criterion?.id);
      if (criterionIds.some((criterionId) => typeof criterionId !== "string")) continue;
      const continuationGoal = currentGoalFromPrompt(prompt);
      const contractObjective = typeof contract.objective === "string" && contract.objective.trim() ? contract.objective : null;
      const assignmentTitle = typeof envelope.task?.title === "string" && envelope.task.title.trim() ? envelope.task.title : null;
      const currentGoal = continuationGoal?.value ?? contractObjective ?? assignmentTitle;
      return {
        contract: { revision: contract.revision, criterionIds },
        currentGoal,
        currentGoalSource: continuationGoal?.source ?? (contractObjective ? "completion_contract" : assignmentTitle ? "assignment_title" : null),
        schema: typeof envelope.schema === "string" ? envelope.schema : null,
      };
    } catch {}
  }
  return null;
}
function complete(state) {
  const { turnId, contract } = state;
  const callId = `finish-${turnId}`;
  state.pending = { callId };
  send({ id: callId, method: "item/tool/call", params: { threadId, turnId, callId, tool: "paperclip_finish", arguments: {
    schema: "paperclip.run_result.v1", reportedWorkDisposition: "done",
    summary: "TEXT-TURN-42: recovered in a fresh native provider session.",
    completionClaim: { contractRevision: contract.revision, objectiveSatisfied: true,
      criteria: contract.criterionIds.map((criterionId) => ({ criterionId, status: "satisfied", evidenceRefs: ["fixture:TEXT-TURN-42"] })), remainingWork: [] },
    evidence: [{ ref: "fixture:TEXT-TURN-42" }], verification: [{ commandOrCheck: "deterministic successor fixture", status: "passed" }], attentionRequests: [], artifacts: [],
  } } });
}
async function startTurn(id, params) {
  const current = params?.threadId ?? threadId;
  threadId = current;
  const turnId = randomUUID();
  const envelope = turnEnvelope(params);
  if (!envelope || envelope.currentGoal === null) {
    throw new Error("text-turn recovery fixture requires the actual native turn envelope contract and current goal");
  }
  const state = { turnId, contract: envelope.contract, currentGoal: envelope.currentGoal, currentGoalSource: envelope.currentGoalSource, envelopeSchema: envelope.schema, pending: null, modelTurnStatus: "inProgress", modelAbort: new AbortController() };
  active = state;
  send({ id, result: { turn: { id: turnId, status: "inProgress" } } });
  send({ method: "turn/started", params: { threadId, turn: { id: turnId, status: "inProgress" } } });
  const prior = await readState();
  if (!prior) {
    // Abort the provider-side model task before emitting its durable terminal
    // record. We intentionally withhold only the app-server notification.
    state.modelAbort.abort(new Error("text-turn controlled interruption"));
    state.modelTurnStatus = "interrupted";
    const rollout = await writeClosedTextRollout(turnId);
    await writeState({ version: 1, providerPid: process.pid, firstThreadId: threadId, firstTurnId: turnId,
      firstCompletionContract: state.contract, firstCurrentGoal: state.currentGoal, firstInput: params?.input ?? [], rollout,
      firstEnvelopeSchema: state.envelopeSchema, firstCurrentGoalSource: state.currentGoalSource, modelTurnStatus: state.modelTurnStatus,
      modelAbortReason: String(state.modelAbort.signal.reason?.message ?? state.modelAbort.signal.reason), faultReadyAt: new Date().toISOString() });
    await writeFile(marker, `${JSON.stringify({ providerPid: process.pid, threadId, turnId, completionContract: state.contract, currentGoal: state.currentGoal, currentGoalSource: state.currentGoalSource, envelopeSchema: state.envelopeSchema, modelTurnStatus: state.modelTurnStatus, rollout })}\n`, { flag: "wx" });
    // The fixture remains protocol-active. The E2E stops only its separately
    // verified runner owner, which makes the actual transport close fail.
    return;
  }
  await writeState({ ...prior, successorThreadId: threadId, successorTurnId: turnId,
    successorCompletionContract: state.contract, successorCurrentGoal: state.currentGoal,
    successorEnvelopeSchema: state.envelopeSchema, successorCurrentGoalSource: state.currentGoalSource, successorInput: params?.input ?? [], successorStartedAt: new Date().toISOString() });
  complete(state);
}
createInterface({ input: process.stdin }).on("line", (line) => {
  void (async () => {
    const message = JSON.parse(line);
    if (!message.method) {
      if (active?.pending?.callId === message.id) {
        if (message.error) throw new Error(message.error.message);
        const { turnId } = active;
        send({ method: "item/completed", params: { threadId, turnId, item: { id: `answer-${turnId}`, type: "agentMessage", text: "TEXT-TURN-42: recovered in a fresh native provider session." } } });
        send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
        active = null;
      }
      return;
    }
    const { id, method, params } = message;
    if (method === "initialize") send({ id, result: { user: { sessionId: threadId } } });
    else if (method === "thread/start" || method === "thread/resume") {
      if (params?.threadId) threadId = params.threadId;
      send({ id, result: { model: "text-turn-fixture", modelProvider: "fixture", thread: { id: threadId, sessionId: threadId } } });
    } else if (method === "thread/read") {
      const state = active ? [{ id: active.turnId, status: "inProgress", items: [] }] : [];
      send({ id, result: { thread: { id: params?.threadId ?? threadId, sessionId: params?.threadId ?? threadId, status: { type: active ? "active" : "idle" }, turns: params?.includeTurns === false ? [] : state } } });
    } else if (method === "thread/turns/list") {
      send({ id, result: { data: active ? [{ id: active.turnId, status: "inProgress", items: [] }] : [], nextCursor: null } });
    } else if (method === "turn/start") await startTurn(id, params);
    else if (method === "turn/interrupt") { if (id != null) send({ id, result: {} }); }
    else if (id != null) send({ id, result: {} });
  })().catch((error) => { process.stderr.write(`text-turn fixture: ${error.message}\n`); process.exitCode = 1; });
});

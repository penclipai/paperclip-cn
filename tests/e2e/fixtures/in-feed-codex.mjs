#!/usr/bin/env node
// Deterministic provider only. The production Rust runner, tool authority, and
// authenticated MCP gateway still execute every tool and enforce access.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
if (process.argv.includes('--version')) { console.log('codex-cli 0.115.0 (in-feed fixture)'); process.exit(0); }
let threadId = `fixture-${randomUUID()}`;
let toolSequence = 0;
const recoveryFixture = process.env.PAPERCLIP_RECOVERY_FIXTURE === "1"
  || process.argv.includes("--recovery-fixture");
const defaultContract = { revision: "1", criterionIds: ["objective"] };
const threads = new Map();
const activeTurns = new Map();
const pending = new Map();
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const isActive = (state) => activeTurns.get(state.context.threadId) === state && !state.controller.signal.aborted;
function ensureActive(state) {
  if (!isActive(state)) throw new Error('Fixture turn interrupted');
}
function emit(state, value) {
  ensureActive(state);
  send(value);
}
function terminal(state, status, error) {
  if (!isActive(state)) return;
  const { threadId, turnId } = state.context;
  send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status, ...(error ? { error } : {}) } } });
  activeTurns.delete(threadId);
}
function interrupt(state) {
  if (!state || !isActive(state)) return;
  terminal(state, 'interrupted');
  clearTimeout(state.startTimer);
  state.controller.abort();
  for (const [id, promise] of pending) {
    if (promise.state !== state) continue;
    pending.delete(id);
    promise.reject(new Error('Fixture turn interrupted'));
  }
}
const call = (state, tool, args) => new Promise((resolve, reject) => {
  ensureActive(state);
  const { threadId, turnId } = state.context;
  const id = `connection-tool-${++toolSequence}`;
  pending.set(id, { resolve, reject, state });
  send({ id, method: 'item/tool/call', params: { threadId, turnId, callId: id, tool, arguments: args } });
});
class ToolApprovalRequired extends Error {}
function unwrap(result) {
  const texts = result?.contentItems ?? result?.content ?? [];
  for (const item of texts) {
    try { const parsed = JSON.parse(item.text); return parsed.value ?? parsed; } catch {}
  }
  return result;
}
function gatewayConfig() {
  // Native execution creates a dedicated provider home and issues a short-lived
  // gateway token for this fixture run. Never load the user's normal Codex home.
  if (!process.env.CODEX_HOME || !process.env.HOME
    || resolve(process.env.CODEX_HOME) !== resolve(process.env.HOME)) {
    throw new Error('The fixture requires an isolated native provider home');
  }
  const config = readFileSync(join(process.env.CODEX_HOME, 'config.toml'), 'utf8');
  const url = JSON.parse(config.match(/^url = (.+)$/m)?.[1] ?? 'null');
  const authorization = JSON.parse(config.match(/Authorization = (".*?")/m)?.[1] ?? 'null');
  if (!url || !authorization) throw new Error('Native continuation did not install the MCP gateway');
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
    || endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error('The fixture only accepts a local native gateway');
  }
  return { endpoint, authorization };
}
async function mcp(state, method, params = {}) {
  ensureActive(state);
  state.gateway ??= gatewayConfig();
  const { endpoint, authorization } = state.gateway;
  const response = await fetch(endpoint, { signal: state.controller.signal, redirect: 'error', method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++toolSequence, method, params }) });
  const text = await response.text();
  ensureActive(state);
  if (!response.ok) {
    let reasonCode;
    try { reasonCode = JSON.parse(text)?.error?.data?.reasonCode; } catch {}
    if (method === 'tools/call' && response.status === 409 && reasonCode === 'approval_required') {
      throw new ToolApprovalRequired('Waiting for tool approval');
    }
    const knownReason = ['provider_interaction_required', 'action_declined'].includes(reasonCode) ? reasonCode : 'other';
    process.stderr.write(`${JSON.stringify({ turnId: state.context.turnId, mcpMethod: method, status: response.status, reasonCode: knownReason })}\n`);
    throw new Error(`Gateway HTTP ${response.status}`);
  }
  const envelope = JSON.parse(text.startsWith('event:') || text.startsWith('data:') ? text.split('\n').find((line) => line.startsWith('data:')).slice(5) : text);
  if (envelope.error) throw new Error(envelope.error.message);
  return envelope.result;
}
async function finish(state, text, evidenceRef) {
  const { completionContract } = state.context;
  return call(state, 'paperclip_finish', { schema: 'paperclip.run_result.v1', reportedWorkDisposition: 'done', summary: text,
    completionClaim: { contractRevision: completionContract.revision, objectiveSatisfied: true, criteria: completionContract.criterionIds.map((criterionId) => ({ criterionId, status: 'satisfied', evidenceRefs: [evidenceRef] })), remainingWork: [] },
    evidence: [{ ref: evidenceRef }], verification: [{ commandOrCheck: 'Fixture outcome', status: 'passed' }], attentionRequests: [], artifacts: [] });
}
async function completeRead(state, text, query, evidenceRef) {
  const { threadId, turnId } = state.context;
  if (recoveryFixture && text.includes('RECOVERY-INJECT-')) {
    emit(state, { method: 'thread/status/changed', params: { threadId: 'unrelated-fixture-thread', status: { type: 'idle' } } });
    if (text.includes('RECOVERY-INJECT-UNKNOWN-WRITE')) {
      emit(state, { method: 'item/started', params: { threadId, turnId, item: { id: 'uncertain-email-write', type: 'commandExecution', command: 'send_fixture_email', status: 'inProgress' } } });
    }
    terminal(state, 'failed', { code: 'fixture_checkpoint_unusable', message: 'Deterministic failed provider session after Gmail access' });
    return;
  }
  if (!text.includes(query === 'gmail-fixture' ? 'GMAIL-73' : 'HELIOTROPE-42')) throw new Error('Provider fixture value missing');
  await call(state, 'report_progress', { idempotencyKey: `fixture-answer-${turnId}`, body: text });
  await finish(state, text, evidenceRef);
  emit(state, { method: 'item/completed', params: { threadId, turnId, item: { id: `answer-${turnId}`, type: 'agentMessage', text } } });
  terminal(state, 'completed');
}
async function execute(state) {
  ensureActive(state);
  const { threadId, turnId, currentObjective, emitCeoLineage, declined } = state.context;
  if (process.argv.includes('--completion-stream-fixture')) {
    // Report completion before a deliberately slow final answer. The real
    // runner and control plane must keep listening after the tool succeeds.
    await finish(state, 'The fixture work is complete.', 'fixture:STREAM-42');
    // Exceed both former completion deadlines: cold (5s) and reusable (30s).
    await delay(31_000, undefined, { signal: state.controller.signal });
    const itemId = `answer-${turnId}`;
    const text = 'STREAM-42: The launch has two stages. Source: https://example.invalid/launch/STREAM-42';
    emit(state, { method: 'item/started', params: { threadId, turnId, item: { id: itemId, type: 'agentMessage', phase: 'final_answer', text: '' } } });
    emit(state, { method: 'item/agentMessage/delta', params: { threadId, turnId, itemId, delta: text.slice(0, 40) } });
    await delay(100, undefined, { signal: state.controller.signal });
    emit(state, { method: 'item/agentMessage/delta', params: { threadId, turnId, itemId, delta: text.slice(40) } });
    emit(state, { method: 'item/completed', params: { threadId, turnId, item: { id: itemId, type: 'agentMessage', phase: 'final_answer', text } } });
    terminal(state, 'completed');
    return;
  }

  if (recoveryFixture) {
    emit(state, { method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: `progress-${turnId}`, delta: 'Checking the current request and available connections.' } });
  }
  if (emitCeoLineage) {
    const child = `child-${turnId}`;
    emit(state, { method: 'thread/started', params: { thread: { id: child, source: { subAgent: { thread_spawn: { parent_thread_id: threadId, depth: 1 } } } } } });
    emit(state, { method: 'turn/started', params: { threadId: child, turn: { id: `child-turn-${turnId}`, status: 'inProgress' } } });
    emit(state, { method: 'turn/completed', params: { threadId: child, turn: { id: `child-turn-${turnId}`, status: 'completed' } } });
    await call(state, 'report_progress', { idempotencyKey: `lineage-${turnId}`, body: 'Provider child finished; root execution continues.' });
  }
  if (declined) {
    const text = 'Connection declined. I will use the information already in this task and pursue alternatives.';
    await call(state, 'report_progress', { idempotencyKey: `declined-${turnId}`, body: text });
    await finish(state, text, 'task:declined-alternative');
    emit(state, { method: 'item/completed', params: { threadId, turnId, item: { id: `answer-${turnId}`, type: 'agentMessage', text } } });
    terminal(state, 'completed');
    return;
  }
  const query = recoveryFixture && /gmail/i.test(currentObjective) ? 'gmail-fixture' : 'heliotrope';
  const recorded = state.context.recordedToolResult;
  if (recorded) return completeRead(state, recorded.resultSummary, query, `tool-action:${recorded.actionRequestId}`);
  const discovery = unwrap(await call(state, 'connections_search', { query }));
  const service = discovery.results?.find((item) => item.source === 'configured');
  if (!service) throw new Error('Authorized Research Archive fixture was not discoverable');
  const request = unwrap(await call(state, 'connection_request', { service: service.service }));
  const refreshingTools = request.state === 'ready' && (
    request.instruction?.includes('fresh continuation with updated tools is queued')
    || request.instruction === 'Access is already authorized. A continuation with updated tools is queued. Finish independent work, then yield. Do not request authorization again.'
  );
  let text;
  if (request.state === 'needs_user_action') {
    text = 'I need access to the research archive. I can organize the launch checklist while you connect it.';
  } else if (refreshingTools) {
    // Follow the authority's yield instruction when authorization arrives after
    // this provider session pinned its tools. The next session must do the read.
    text = 'Access is ready. I will continue the archive read with the updated tools.';
  } else {
    await mcp(state, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'in-feed-fixture', version: '1' } });
    const list = await mcp(state, 'tools/list');
    const tool = list.tools.find((item) => (query === 'gmail-fixture' ? /gmail-fixture/.test(item.description ?? '') : /heliotrope/.test(item.description ?? '')));
    if (!tool) throw new Error('Updated native tool snapshot does not contain archive_read');
    let result;
    try {
      result = await mcp(state, 'tools/call', { name: tool.name, arguments: {} });
    } catch (error) {
      if (!(error instanceof ToolApprovalRequired)) throw error;
      // The authority posted an approval card and will wake this task with the
      // approved action's result. End this turn without retrying or claiming done.
      const text = 'Waiting for tool approval. I will continue when the action is decided.';
      await call(state, 'report_progress', { idempotencyKey: `approval-${turnId}`, body: text });
      emit(state, { method: 'item/completed', params: { threadId, turnId, item: { id: `answer-${turnId}`, type: 'agentMessage', text } } });
      terminal(state, 'completed');
      return;
    }
    if (result.isError) throw new Error(JSON.stringify(result));
    text = result.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n');
    return completeRead(state, text, query, `mcp:${query === 'gmail-fixture' ? 'gmail_read' : 'archive_read'}`);
  }
  await call(state, 'report_progress', { idempotencyKey: `fixture-answer-${turnId}`, body: text });
  emit(state, { method: 'item/completed', params: { threadId, turnId, item: { id: `answer-${turnId}`, type: 'agentMessage', text } } });
  terminal(state, 'completed');
}
function normalizeContract(contract = defaultContract) {
  return Object.freeze({ revision: contract.revision, criterionIds: Object.freeze([...(contract.criterionIds ?? contract.criteria?.map((criterion) => criterion.id) ?? ['objective'])]) });
}
function promptJson(prompt, marker) {
  const index = prompt.indexOf(marker);
  if (index < 0) return null;
  const block = prompt.slice(index + marker.length).match(/^(`{3,})[^\r\n]*\r?\n([\s\S]*?)^\1[ \t]*\r?$/m);
  try { return block ? JSON.parse(block[2]) : null; } catch { return null; }
}
function objectiveFromPrompt(prompt, fallback) {
  const context = promptJson(prompt, '## Current request and continuation context');
  if (context?.version === 1 && Array.isArray(context.messages)) {
    if (typeof context.objective === 'string') return context.objective;
    const source = context.objectiveSource;
    if (source?.kind === 'comment') {
      const message = context.messages.find((item) => item.id === source.id && item.updatedAt === source.revision && !item.deleted && !item.createdByRunId);
      if (typeof message?.body === 'string') return message.body;
    }
  }
  return fallback;
}
function recordedResultFromPrompt(prompt, objective) {
  if (!prompt.includes('Connection review continuation. Process the recorded outcome under the existing task authorization.')
    || !prompt.includes('The approved action already ran. Do not call it again;')) return null;
  const data = promptJson(prompt, '### Untrusted connection result data');
  const toolName = recoveryFixture && /gmail/i.test(objective) ? 'gmail_read' : 'archive_read';
  const result = data?.untrustedToolResults?.find((item) => typeof item.toolName === 'string' && item.toolName.endsWith(toolName)
    && typeof item.resultSummary === 'string' && item.resultSummary && !item.error && !item.declineReason);
  // This fixture consumes result data only; it never interprets instructions
  // inside that data as authorization to invoke another tool.
  return result ? Object.freeze({ actionRequestId: result.actionRequestId, resultSummary: result.resultSummary }) : null;
}
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (!message.method) {
    const promise = pending.get(message.id);
    if (promise) {
      pending.delete(message.id);
      message.error ? promise.reject(new Error(message.error.message)) : promise.resolve(message.result);
    }
    // Late responses to cancelled calls are not requests and must not be echoed.
    return;
  }
  const { id, method } = message;
  if (method === 'initialize') send({ id, result: { user: { sessionId: threadId } } });
  else if (method === 'thread/start' || method === 'thread/resume') {
    if (recoveryFixture) send({ method: 'configWarning', params: { message: 'Recovery fixture startup notice before the first turn' } });
    if (method === 'thread/resume' && message.params?.threadId) threadId = message.params.threadId;
    else if (method === 'thread/start' && threads.has(threadId)) threadId = `fixture-${randomUUID()}`;
    threads.set(threadId, normalizeContract(message.params?.completionContract ?? threads.get(threadId)));
    send({ id, result: { model: 'in-feed-fixture', modelProvider: 'fixture', thread: { id: threadId, sessionId: threadId } } });
  }
  else if (method === 'thread/read' || method === 'thread/turns/list') {
    const requestedThreadId = message.params?.threadId ?? threadId;
    const state = activeTurns.get(requestedThreadId);
    const turns = state ? [{ id: state.context.turnId, status: 'inProgress', items: [] }] : [];
    // Rust resume first reads status without turns, then pages an active thread.
    // A yielded/terminal fixture has no active provider turn to recover.
    if (method === 'thread/turns/list') send({ id, result: { data: turns, nextCursor: null } });
    else send({ id, result: { thread: { id: requestedThreadId, sessionId: requestedThreadId,
      status: { type: state ? 'active' : 'idle' }, turns: message.params?.includeTurns === false ? [] : turns } } });
  }
  else if (method === 'turn/start') {
    const currentThreadId = message.params?.threadId ?? threadId;
    let currentObjective = '';
    let currentPrompt = '';
    let completionContract = threads.get(currentThreadId) ?? normalizeContract();
    const emitCeoLineage = JSON.stringify(message.params).includes('CEO descendant fixture');
    const declined = /connection_intent/.test(JSON.stringify(message.params)) && /rejected/.test(JSON.stringify(message.params));
    for (const part of message.params?.input ?? []) {
      try {
        const outer = JSON.parse(part.text);
        const envelope = typeof outer.message === "string" ? JSON.parse(outer.message) : outer;
        const contract = envelope.task?.completionContract ?? envelope.completionContract;
        currentPrompt = envelope.task?.task?.prompt ?? envelope.task?.prompt ?? '';
        for (const line of currentPrompt.split('\n')) {
          try { const context = JSON.parse(line); if (context.version === 1 && Array.isArray(context.messages) && typeof context.objective === 'string') currentObjective = context.objective; } catch {}
        }
        currentObjective = objectiveFromPrompt(currentPrompt, currentObjective || contract?.objective || envelope.task?.title || '');
        if (contract?.revision && contract.criteria) completionContract = normalizeContract(contract);
      } catch { /* Non-envelope text is ordinary task context. */ }
    }
    interrupt(activeTurns.get(currentThreadId));
    const turnId = randomUUID();
    const state = { context: Object.freeze({ threadId: currentThreadId, turnId, currentObjective, completionContract, emitCeoLineage, declined,
      recordedToolResult: recordedResultFromPrompt(currentPrompt, currentObjective) }), controller: new AbortController(), gateway: null, startTimer: null };
    activeTurns.set(currentThreadId, state);
    send({ id, result: { turn: { id: turnId, status: 'inProgress' } } });
    send({ method: 'turn/started', params: { threadId: currentThreadId, turn: { id: turnId, status: 'inProgress' } } });
    // Deliver model output on a later tick, after the runner accepts turn/start.
    state.startTimer = setTimeout(() => void execute(state).catch((error) => {
      if (!isActive(state)) return;
      process.stderr.write(`In-feed fixture: ${error.message}\n`);
      terminal(state, 'failed', { message: error.message });
    }), 50);
  } else if (method === 'turn/interrupt') {
    const state = activeTurns.get(message.params?.threadId ?? threadId);
    if (state && (!message.params?.turnId || message.params.turnId === state.context.turnId)) interrupt(state);
    if (id != null) send({ id, result: {} });
  } else if (id != null) send({ id, result: {} });
});

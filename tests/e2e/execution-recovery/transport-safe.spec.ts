import { expect, test } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const shortRoot = () => resolve(process.env.PAPERCLIP_E2E_TEMP_ROOT ?? tmpdir(), "paperclip-transport-safe", `tts-${randomUUID().slice(0, 8)}`);
const baseUrl = (logs: string) => logs.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").match(/Paperclip is ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];

function within(parent: string, candidate: string) {
  const rel = relative(parent, candidate);
  return rel !== "" && !rel.startsWith("..") && !rel.includes("..\\") && !rel.includes("../");
}

async function reparsePath(root: string, candidate: string): Promise<string | null> {
  if (!within(root, candidate)) return "outside owned root";
  if ((await lstat(root)).isSymbolicLink()) return root;
  let current = root;
  for (const part of relative(root, candidate).split(/[\\/]/)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) return current;
  }
  return null;
}

async function reparseInTree(root: string): Promise<string | null> {
  const stat = await lstat(root);
  if (stat.isSymbolicLink()) return root;
  if (!stat.isDirectory()) return null;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = join(root, entry.name);
    const found = await reparseInTree(child);
    if (found) return found;
  }
  return null;
}

async function preserveOwnedFailureEvidence(input: { runtimeRoot: string; outputPath: (name: string) => string }) {
  const artifactRoot = input.outputPath("transport-safe-owned-runtime");
  const missing: string[] = [];
  const errors: string[] = [];
  try { await mkdir(artifactRoot, { recursive: true }); }
  catch (error) { return { artifactRoot, missing, errors: [`artifact root: ${(error as Error).message}`] }; }
  const copy = async (source: string, target: string) => {
    try { await writeFile(target, await readFile(source)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") missing.push(source);
      else errors.push(`${source}: ${(error as Error).message}`);
    }
  };
  for (const name of ["owned-root.json", "fault-ready.json", "fixture-state.json"]) {
    const source = resolve(input.runtimeRoot, name);
    if (within(input.runtimeRoot, source)) {
      const reparse = await reparsePath(input.runtimeRoot, source).catch((error) => (error as Error).message);
      if (reparse) errors.push(`${source}: reparse check failed (${reparse})`);
      else await copy(source, join(artifactRoot, name));
    }
  }
  try {
    const marker = JSON.parse(await readFile(resolve(input.runtimeRoot, "fault-ready.json"), "utf8"));
    const rollout = typeof marker?.rollout?.rollout === "string" ? resolve(marker.rollout.rollout) : null;
    if (!rollout || !within(input.runtimeRoot, rollout)) missing.push("closed rollout");
    else {
      const reparse = await reparsePath(input.runtimeRoot, rollout);
      if (reparse) errors.push(`${rollout}: reparse point ${reparse}`);
      else await copy(rollout, join(artifactRoot, "closed-rollout.jsonl"));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") missing.push("closed rollout");
    else errors.push(`runtime root: ${(error as Error).message}`);
  }
  return { artifactRoot, missing, errors };
}

async function removeCurrentOwnedRuntime(runtimeRoot: string) {
  const runtimeBase = resolve(process.env.PAPERCLIP_E2E_TEMP_ROOT ?? tmpdir(), "paperclip-transport-safe");
  const ownedPath = resolve(runtimeRoot, "owned-root.json");
  if (dirname(runtimeRoot) !== runtimeBase || !within(runtimeBase, runtimeRoot) || !within(runtimeRoot, ownedPath)) return { removed: false, retainedReason: "runtime root is outside the current owned parent" };
  const reparse = await reparseInTree(runtimeRoot);
  if (reparse) return { removed: false, retainedReason: `runtime root contains a reparse point: ${reparse}` };
  const owned = JSON.parse(await readFile(ownedPath, "utf8"));
  if (owned?.schema !== "paperclip.transport-safe.e2e.v1" || typeof owned.runtimeRoot !== "string" ||
      typeof owned.dataDir !== "string" || resolve(owned.runtimeRoot) !== runtimeRoot ||
      resolve(owned.dataDir) !== resolve(runtimeRoot, "paperclip-home")) return { removed: false, retainedReason: "owned runtime marker did not match" };
  await rm(runtimeRoot, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
  return { removed: true };
}

function windowsOwnedTreePids(rootPid: number) {
  const script = `$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId; $seen = [System.Collections.Generic.HashSet[int]]::new(); $frontier = [System.Collections.Generic.Queue[int]]::new(); $frontier.Enqueue(${rootPid}); while ($frontier.Count -gt 0) { $currentPid = $frontier.Dequeue(); if (!$seen.Add($currentPid)) { continue }; foreach ($child in $all | Where-Object { $_.ParentProcessId -eq $currentPid }) { $frontier.Enqueue([int]$child.ProcessId) } }; @($seen) | ConvertTo-Json -Compress`;
  try {
    const raw = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true }).trim();
    const parsed = JSON.parse(raw || "[]") as number | number[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch { return []; }
}

function windowsExistingPids(pids: number[]) {
  if (!pids.length) return [];
  const filter = pids.map((pid) => `ProcessId = ${pid}`).join(" OR ");
  const script = `Get-CimInstance Win32_Process -Filter '${filter}' | Select-Object -ExpandProperty ProcessId | ConvertTo-Json -Compress`;
  try {
    const raw = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true }).trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as number | number[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch { return pids; }
}

async function stopOwnedDrive(child: ChildProcess | undefined): Promise<{ stopped: boolean; reason?: string }> {
  if (!child?.pid) return { stopped: true };
  if (child.exitCode !== null || child.signalCode !== null) return { stopped: false, reason: "test-drive exited before an owned tree snapshot" };
  const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
  if (process.platform === "win32") {
    const ownedPids = windowsOwnedTreePids(child.pid);
    if (!ownedPids.includes(child.pid)) return { stopped: false, reason: "could not capture the owned test-drive process tree" };
    try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch { return { stopped: false, reason: "owned test-drive tree termination failed" }; }
    await Promise.race([exited, new Promise<void>((resolveExit) => setTimeout(resolveExit, 15_000))]);
    const remaining = windowsExistingPids(ownedPids);
    return remaining.length ? { stopped: false, reason: `owned test-drive PIDs still running: ${remaining.join(",")}` } : { stopped: true };
  }
  try { process.kill(-child.pid, "SIGTERM"); } catch { return { stopped: false, reason: "owned test-drive process group could not be terminated" }; }
  await Promise.race([
    exited,
    new Promise<void>((resolveExit) => setTimeout(resolveExit, 15_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    try { process.kill(-child.pid, "SIGKILL"); } catch { return { stopped: false, reason: "owned test-drive process group could not be killed" }; }
    await Promise.race([exited, new Promise<void>((resolveExit) => setTimeout(resolveExit, 5_000))]);
  }
  try {
    process.kill(-child.pid, 0);
    return { stopped: false, reason: "owned test-drive process group is still alive" };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH"
      ? { stopped: true }
      : { stopped: false, reason: "owned test-drive process group stop could not be confirmed" };
  }
}

function windowsProcess(pid: number) {
  const script = `Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`;
  const raw = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true }).trim();
  return JSON.parse(raw) as { ProcessId?: number; ExecutablePath?: string | null; CommandLine?: string | null };
}

async function ownedRunnerEvidence(input: { pid: number; dataDir: string; runnerInstanceId: string; runId: string; marker: { providerPid: number; threadId: string; turnId: string }; fixture: string }) {
  const names = await readdir(input.dataDir, { recursive: true });
  const runnerStatePaths = names.filter((name) => name.endsWith("runner-state.json"));
  expect(runnerStatePaths).toHaveLength(1);
  const runnerState = JSON.parse(await readFile(join(input.dataDir, runnerStatePaths[0]), "utf8"));
  expect(runnerState).toMatchObject({ schema: "paperclip.runner.durable.state.v1", runnerInstanceId: input.runnerInstanceId, runId: input.runId });
  const commands = Object.values(runnerState.processedCommands ?? {}) as Array<{ commandType?: string; result?: Record<string, unknown> }>;
  expect(commands).toContainEqual(expect.objectContaining({ commandType: "session.open", result: expect.objectContaining({ processId: input.marker.providerPid, providerSessionId: input.marker.threadId, status: "started" }) }));
  expect(commands).toContainEqual(expect.objectContaining({ commandType: "turn.start", result: expect.objectContaining({ providerTurnId: input.marker.turnId, status: "accepted" }) }));
  if (process.platform !== "win32") return { runnerState };
  const processInfo = windowsProcess(input.pid);
  expect(processInfo.ProcessId).toBe(input.pid);
  expect(processInfo.ExecutablePath).toEqual(expect.any(String));
  expect(processInfo.CommandLine).toContain(input.dataDir);
  const providerProcess = windowsProcess(input.marker.providerPid);
  expect(providerProcess.ProcessId).toBe(input.marker.providerPid);
  expect(providerProcess.ExecutablePath).toEqual(expect.any(String));
  expect(providerProcess.CommandLine).toContain(input.fixture);
  return { runnerState, processInfo, providerProcess };
}

test("a real text-only provider transport close follows the platform recovery contract", async ({ page }, info) => {
  test.setTimeout(process.platform === "win32" ? 420_000 : 180_000);
  // The isolated test-drive app defaults to zh-CN. This E2E uses the legacy
  // accessible English controls also used by the recovery suite.
  await page.addInitScript(() => localStorage.setItem("paperclip.locale", "en"));
  const root = resolve(import.meta.dirname, "../../..");
  const runtimeRoot = shortRoot();
  const dataDir = resolve(runtimeRoot, "paperclip-home");
  const marker = resolve(runtimeRoot, "fault-ready.json");
  const statePath = resolve(runtimeRoot, "fixture-state.json");
  const fixture = resolve(root, "tests/e2e/fixtures/recovery-text-turn-codex.mjs");
  const loader = resolve(root, "tests/e2e/fixtures/recovery-text-turn-codex-loader.mjs");
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(resolve(runtimeRoot, "owned-root.json"), JSON.stringify({ schema: "paperclip.transport-safe.e2e.v1", runtimeRoot, dataDir, marker, statePath }) + "\n");
  const env = { ...process.env, NODE_ENV: "test", TEXT_TURN_FIXTURE_KEY: "not-a-real-model-key",
    TEXT_TURN_CODEX_ENTRY: fixture, TEXT_TURN_FAULT_MARKER: marker, TEXT_TURN_FIXTURE_STATE: statePath,
    PAPERCLIP_HOME: dataDir, HOME: runtimeRoot, TEMP: runtimeRoot, TMP: runtimeRoot, TMPDIR: runtimeRoot,
    PAPERCLIP_VITE_CACHE_DIR: resolve(runtimeRoot, "vite-cache"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(loader).href}` };
  delete env.DATABASE_URL; delete env.DATABASE_MIGRATION_URL;
  let child: ChildProcess | undefined;
  let logs = "";
  let apiBase = "";
  let evidence: Record<string, unknown> = { runtimeRoot, dataDir, marker };
  try {
    child = spawn(process.execPath, ["cli/node_modules/tsx/dist/cli.mjs", "cli/src/index.ts", "test-drive", "--harness", "codex", "--api-key-env", "TEXT_TURN_FIXTURE_KEY", "--company-name", "Transport safe fixture", "--data-dir", dataDir, "--no-browser"],
      { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout!.on("data", (chunk) => { logs += chunk.toString(); }); child.stderr!.on("data", (chunk) => { logs += chunk.toString(); });
    await expect.poll(() => baseUrl(logs), { timeout: process.platform === "win32" ? 180_000 : 100_000 }).toBeTruthy();
    apiBase = baseUrl(logs)!;
    const api = async (path: string, method = "GET", data?: unknown) => {
      const response = await page.request.fetch(`${apiBase}/api${path}`, { method, data });
      expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
    };
    await expect.poll(async () => (await page.request.get(`${apiBase}/api/health`)).ok(), { timeout: 100_000 }).toBe(true);
    const [company] = await api("/companies");
    const [agent] = await api(`/companies/${company.id}/agents`);
    expect(agent).toMatchObject({ name: "CEO", adapterType: "codex_local" });
    const prefix = `/${company.issuePrefix}`;
    await page.goto(`${apiBase}${prefix}/company/settings/instance/experimental`);
    if (!(await api("/instance/settings/experimental")).enableNativeRunner) await page.getByRole("switch", { name: "Toggle Paperclip Runner experimental setting" }).click();
    await expect.poll(async () => (await api("/instance/settings/experimental")).enableNativeRunner).toBe(true);
    // Use the same public agent configuration contract that the form saves,
    // then retain the before/after response as setup evidence. The current
    // localized form navigates away while its adapter picker is detached;
    // this avoids treating that UI timing artifact as a persisted selection.
    const adapterBefore = await api(`/agents/${agent.id}`);
    const adapterSaved = await api(`/agents/${agent.id}`, "PATCH", {
      adapterType: "paperclip_runner", adapterConfig: { ...adapterBefore.adapterConfig, provider: "codex" },
    });
    const adapterAfter = await api(`/agents/${agent.id}`);
    expect(adapterBefore.adapterType).toBe("codex_local");
    expect(adapterSaved.adapterType).toBe("paperclip_runner");
    expect(adapterAfter).toMatchObject({ adapterType: "paperclip_runner", adapterConfig: { provider: "codex" } });
    evidence = { ...evidence, adapterTransition: { before: { adapterType: adapterBefore.adapterType, adapterConfig: adapterBefore.adapterConfig }, saved: { adapterType: adapterSaved.adapterType, adapterConfig: adapterSaved.adapterConfig }, after: { adapterType: adapterAfter.adapterType, adapterConfig: adapterAfter.adapterConfig } } };
    await api(`/agents/${agent.id}/skills/sync?companyId=${company.id}`, "POST", { desiredSkills: [], mode: "replace" });
    await page.goto(`${apiBase}${prefix}/tasks`);
    // The task composer caches assignee summaries. Reload after the public
    // configuration mutation so its create request cannot carry the old
    // Codex-local selection from the settings page.
    await page.reload();
    await page.getByRole("button", { name: "New Task", exact: true }).last().click();
    await page.getByRole("textbox", { name: "Editable markdown" }).fill("Prepare a text-only recovery response.");
    await page.getByRole("button", { name: "Select assignee", exact: true }).click();
    await page.getByRole("option").filter({ hasText: agent.name }).click();
    await page.getByRole("button", { name: "Create task", exact: true }).click();
    const issue = await expect.poll(async () => (await api(`/companies/${company.id}/issues`)).find((candidate: { title?: string; assigneeAgentId?: string }) => candidate.title === "Prepare a text-only recovery response." && candidate.assigneeAgentId === agent.id) ?? null, { timeout: 30_000 }).not.toBeNull();
    const createdIssue = (await api(`/companies/${company.id}/issues`)).find((candidate: { title?: string; assigneeAgentId?: string }) => candidate.title === "Prepare a text-only recovery response." && candidate.assigneeAgentId === agent.id)!;
    const predecessor = await expect.poll(async () => {
      const runs = await api(`/companies/${company.id}/heartbeat-runs`);
      const candidate = runs.find((run: { issueId?: string }) => run.issueId === createdIssue.id);
      if (!candidate) return null;
      const detail = await api(`/heartbeat-runs/${candidate.id}`);
      return detail.runtimeMode === "native" && detail.nativeSessionId && detail.runnerInstanceId && detail.processPid ? detail : null;
    }, { timeout: 60_000 }).not.toBeNull();
    const listed = (await api(`/companies/${company.id}/heartbeat-runs`)).find((run: { issueId?: string }) => run.issueId === createdIssue.id)!;
    const predecessorDetail = await api(`/heartbeat-runs/${listed.id}`);
    expect(predecessorDetail).toMatchObject({ id: listed.id, runtimeMode: "native", status: "running" });
    await expect.poll(async () => {
      try { await access(marker); return true; } catch { return false; }
    }, { timeout: 60_000 }).toBe(true);
    const markerProof = JSON.parse(await readFile(marker, "utf8"));
    expect(markerProof).toMatchObject({ providerPid: expect.any(Number), threadId: expect.any(String), turnId: expect.any(String),
      completionContract: { revision: expect.any(String), criterionIds: expect.any(Array) },
      currentGoal: expect.any(String), currentGoalSource: expect.any(String), modelTurnStatus: "interrupted" });
    expect(markerProof.providerPid).toBeGreaterThan(0);
    const preFaultEvents = await api(`/heartbeat-runs/${listed.id}/events`);
    expect(preFaultEvents.some((event: { eventType?: string }) => /semantic_tool\.input|mcp_app\.tool_input|runtime\.input\.requested|runtime_request\.created|finish/i.test(event.eventType ?? ""))).toBe(false);
    expect(predecessorDetail.processPid).toEqual(expect.any(Number));
    const runnerProcess = await ownedRunnerEvidence({ pid: predecessorDetail.processPid, dataDir, runnerInstanceId: predecessorDetail.runnerInstanceId, runId: listed.id, marker: markerProof, fixture });
    // The run API binds this PID to the admitted native session and the
    // inspected command line binds it to this isolated drive's data root and
    // runner instance. This is the owned transport-failure control; it does
    // not target a shared service or an arbitrary local process.
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(predecessorDetail.processPid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      expect(predecessorDetail.processGroupId).toBe(predecessorDetail.processPid);
      // The admitted process-group receipt and inspected runner identity bind
      // this exact group to the isolated test drive before its transport dies.
      process.kill(-predecessorDetail.processGroupId, "SIGKILL");
    }
    await expect.poll(async () => api(`/heartbeat-runs/${listed.id}`), { timeout: 90_000 }).toMatchObject({ status: "failed", errorCode: "native_provider_terminal_failed", error: "Provider notification transport failed closed." });
    const failedRun = await api(`/heartbeat-runs/${listed.id}`);
    // This decorated public run does not project the finalizer's private
    // result row. Its authoritative public proof is the verified-stopped
    // event below, plus the replacement gate; do not infer null from an
    // omitted response field.
    const failedEvents = await api(`/heartbeat-runs/${listed.id}/events`);
    expect(failedEvents.some((event: { eventType?: string }) => event.eventType === "run.result.accepted")).toBe(false);
    if (process.platform === "win32") {
      // Windows has no server-owned Job Object stop receipt. A taskkill /T is
      // sufficient to create the owned transport close but cannot authorize a
      // replacement from a dead direct PID, so recovery must remain fail-closed.
      await page.goto(`${apiBase}${prefix}/issues/${createdIssue.id}`);
      await expect.poll(async () => (await api(`/issues/${createdIssue.id}`)).status, { timeout: 90_000 }).toBe("blocked");
      const blockedIssue = await api(`/issues/${createdIssue.id}`);
      expect(blockedIssue.activeRecoveryAction).toMatchObject({
        ownerType: "board",
        status: "active",
      });
      expect(["native_provider_terminal_failed", "provider_failure_meaning_unverified"]).toContain(blockedIssue.activeRecoveryAction?.cause);
      await page.waitForTimeout(35_000);
      const finalRows = await api(`/companies/${company.id}/heartbeat-runs`);
      const issueRuns = finalRows.filter((run: { issueId?: string }) => run.issueId === createdIssue.id);
      expect(issueRuns).toHaveLength(1);
      expect(issueRuns[0]).toMatchObject({ id: listed.id, status: "failed" });
      expect((await api(`/heartbeat-runs/${listed.id}/events`)).some((event: { eventType?: string }) => event.eventType === "native.stopped_text_turn_verified")).toBe(false);
      expect(finalRows.filter((run: { retryOfRunId?: string; scheduledRetryReason?: string }) => run.retryOfRunId === listed.id && run.scheduledRetryReason === "native_safe_replacement")).toHaveLength(0);
      await expect(page.getByText(/TEXT-TURN-42: recovered in a fresh native provider session/)).toHaveCount(0);
      const state = JSON.parse(await readFile(statePath, "utf8"));
      expect(state.firstCurrentGoal).toBe(markerProof.currentGoal);
      expect(state.firstCompletionContract).toEqual(markerProof.completionContract);
      evidence = { ...evidence, apiBase, companyId: company.id, agentId: agent.id, issueId: createdIssue.id,
        platformContract: "win32_no_owned_process_tree_stop_receipt",
        predecessor: { id: listed.id, processPid: predecessorDetail.processPid, nativeSessionId: predecessorDetail.nativeSessionId, runnerInstanceId: predecessorDetail.runnerInstanceId, runnerProcess, errorCode: failedRun.errorCode, error: failedRun.error, eventTypes: preFaultEvents.map((event: { eventType?: string }) => event.eventType) },
        fixture: state, marker: markerProof };
      await page.screenshot({ path: info.outputPath("transport-safe-win32-fail-closed.png"), fullPage: true });
      return;
    }
    await expect.poll(async () => {
      const events = await api(`/heartbeat-runs/${listed.id}/events`);
      return events.find((event: { eventType?: string }) => event.eventType === "native.stopped_text_turn_verified") ?? null;
    }, { timeout: 90_000 }).toMatchObject({ eventType: "native.stopped_text_turn_verified", payload: { schema: "paperclip.stopped_text_turn.v1", runId: listed.id,
      nativeSessionId: predecessorDetail.nativeSessionId, runnerInstanceId: predecessorDetail.runnerInstanceId, processPid: predecessorDetail.processPid,
      providerPid: markerProof.providerPid, providerSessionId: markerProof.threadId, providerTurnId: markerProof.turnId } });
    await expect.poll(async () => {
      const rows = await api(`/companies/${company.id}/heartbeat-runs`);
      return rows.filter((run: { retryOfRunId?: string; scheduledRetryReason?: string }) => run.retryOfRunId === listed.id && run.scheduledRetryReason === "native_safe_replacement");
    }, { timeout: 90_000 }).toHaveLength(1);
    const rows = await api(`/companies/${company.id}/heartbeat-runs`);
    const successorList = rows.find((run: { retryOfRunId?: string; scheduledRetryReason?: string }) => run.retryOfRunId === listed.id && run.scheduledRetryReason === "native_safe_replacement");
    const successor = await api(`/heartbeat-runs/${successorList.id}`);
    await expect.poll(async () => (await api(`/heartbeat-runs/${successorList.id}`)).status, { timeout: 90_000 }).toBe("succeeded");
    const finalSuccessor = await api(`/heartbeat-runs/${successorList.id}`);
    expect(finalSuccessor).toMatchObject({ runtimeMode: "native", status: "succeeded", retryOfRunId: listed.id, scheduledRetryReason: "native_safe_replacement" });
    await expect.poll(async () => (await api(`/issues/${createdIssue.id}`)).status, { timeout: 30_000 }).toBe("done");
    await expect(page.getByText(/TEXT-TURN-42: recovered in a fresh native provider session/).first()).toBeVisible({ timeout: 30_000 });
    const state = JSON.parse(await readFile(statePath, "utf8"));
    expect(state.firstCurrentGoal).toBe(markerProof.currentGoal);
    expect(state.firstCurrentGoalSource).toBe(markerProof.currentGoalSource);
    expect(JSON.stringify(state.firstInput)).toContain(createdIssue.title);
    expect(state.firstEnvelopeSchema).toMatch(/^paperclip\.native-model-envelope\.v[23]$/);
    expect(state.firstCompletionContract).toEqual(markerProof.completionContract);
    expect(state.successorCompletionContract).toEqual(state.firstCompletionContract);
    expect(state.successorCurrentGoal).toBe(state.firstCurrentGoal);
    expect(state.successorEnvelopeSchema).toBe(state.firstEnvelopeSchema);
    expect(finalSuccessor.id).not.toBe(listed.id);
    expect((await api(`/companies/${company.id}/heartbeat-runs`)).filter((run: { retryOfRunId?: string; scheduledRetryReason?: string }) => run.retryOfRunId === listed.id && run.scheduledRetryReason === "native_safe_replacement")).toHaveLength(1);
    evidence = { ...evidence, apiBase, companyId: company.id, agentId: agent.id, issueId: createdIssue.id,
      predecessor: { id: listed.id, processPid: predecessorDetail.processPid, nativeSessionId: predecessorDetail.nativeSessionId, runnerInstanceId: predecessorDetail.runnerInstanceId, runnerProcess, errorCode: failedRun.errorCode, error: failedRun.error, eventTypes: preFaultEvents.map((event: { eventType?: string }) => event.eventType) },
      successor: { id: successorList.id, status: finalSuccessor.status, retryOfRunId: finalSuccessor.retryOfRunId, scheduledRetryReason: finalSuccessor.scheduledRetryReason },
      fixture: state, marker: markerProof };
    await page.screenshot({ path: info.outputPath("transport-safe-successor.png"), fullPage: true });
  } finally {
    const preservation = await preserveOwnedFailureEvidence({ runtimeRoot, outputPath: (name) => info.outputPath(name) });
    const cleanup = await stopOwnedDrive(child);
    let ownedRuntimeCleanup: { attempted: boolean; removed: boolean; retainedReason?: string };
    if (cleanup.stopped && preservation.errors.length === 0 && preservation.missing.length === 0) {
      try {
        const result = await removeCurrentOwnedRuntime(runtimeRoot);
        ownedRuntimeCleanup = { attempted: true, ...result };
      } catch (error) {
        ownedRuntimeCleanup = { attempted: true, removed: false, retainedReason: (error as Error).message };
      }
    } else {
      ownedRuntimeCleanup = { attempted: false, removed: false, retainedReason: cleanup.stopped ? "evidence preservation is incomplete" : cleanup.reason ?? "owned test-drive stop was not confirmed" };
    }
    evidence = { ...evidence, artifactPreservation: preservation, ownedDriveCleanup: cleanup, ownedRuntimeCleanup };
    try {
      await writeFile(info.outputPath("transport-safe-evidence.json"), JSON.stringify(evidence, null, 2));
      await writeFile(info.outputPath("test-drive.log"), logs);
    } catch {}
  }
});

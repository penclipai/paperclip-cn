import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { listenOnFetchAllowedPort } from '../fetch-allowed-port';

// This dedicated suite predates the CN fork's zh-CN default and asserts its
// English accessibility contract. Set the locale before the app first loads,
// just as the default E2E configuration's storage state does.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('paperclip.locale', 'en'));
});

function testDriveBaseUrl(logs: string): string | undefined {
  const plainLogs = logs.replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '');
  const ready = plainLogs.match(/Paperclip is ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1]
    ?? plainLogs.match(/Server listener bound on 127\.0\.0\.1:(\d+)/)?.[1];
  return ready?.startsWith('http') ? ready : ready ? `http://127.0.0.1:${ready}` : undefined;
}

async function stopTestDrive(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const waitForExit = (timeoutMs: number) => new Promise<boolean>((done) => {
    const onExit = () => { clearTimeout(timer); done(true); };
    const timer = setTimeout(() => { child.removeListener('exit', onExit); done(false); }, timeoutMs);
    child.once('exit', onExit);
  });
  if (process.platform === 'win32') {
    if (child.connected) {
      const exited = waitForExit(15_000);
      try { child.send({ type: 'paperclip-e2e-shutdown' }); }
      catch { /* fall through to the owned tree fallback */ }
      if (await exited) return;
    }
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch (error) {
      try { process.kill(child.pid, 0); }
      catch (probeError) {
        if ((probeError as NodeJS.ErrnoException).code === 'ESRCH') return;
      }
      throw error;
    }
    await waitForExit(5_000);
    return;
  }
  process.kill(-child.pid, 'SIGTERM');
}

// Each attempt starts the source CLI's test-drive without --data-dir. The model
// and MCP provider are deterministic fixtures; authorization/cards/wakes are real.
for (const journey of ['connect', 'decline', 'restart'] as const) test(`fresh native runner connection journey: ${journey}`, async ({ page }, info) => {
  // This journey waits for two Windows PostgreSQL/server cold starts, each
  // bounded at 180s, before proving the persisted connection and native reply.
  if (journey === 'restart' && process.platform === 'win32') test.setTimeout(600_000);
  const root = resolve(import.meta.dirname, '../../..');
  let processHandle: ChildProcess | undefined;
  let logs = '';
  let diagnosticState = async () => ({});
  let nativeRunnerSettingEvidence: Record<string, unknown> | undefined;
  let nativeSkillEvidence: Record<string, unknown> | undefined;
  const calls: string[] = [];
  const fixture = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const part of req) chunks.push(Buffer.from(part));
    const message = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    calls.push(message.method);
    if (message.id === undefined) { res.writeHead(202); res.end(); return; }
    const result = message.method === 'initialize' ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'heliotrope', version: '1' } }
      : message.method === 'tools/list' ? { tools: [{ name: 'archive_read', description: 'Read heliotrope launch decisions', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] }
      : message.method === 'tools/call' ? { content: [{ type: 'text', text: 'HELIOTROPE-42: Launch in two stages; support handoff belongs to Mira. Source: https://example.invalid/launch/heliotrope-42' }] } : {};
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  try {
    const port = await listenOnFetchAllowedPort(fixture);
    const testDriveDataDir = await mkdtemp(join(os.tmpdir(), 'paperclip-in-feed-connection-'));
    const fixtureEntry = resolve(root, 'tests/e2e/fixtures/in-feed-codex.mjs');
    const fixtureLoader = resolve(root, 'tests/e2e/fixtures/in-feed-codex-loader.mjs');
    const shutdownHelper = resolve(root, 'tests/e2e/fixtures/native-test-drive-shutdown.mjs');
    const env = { ...process.env, IN_FEED_FIXTURE_KEY: 'not-a-real-model-key', NODE_ENV: 'test', IN_FEED_TEST_DRIVE_SHUTDOWN: '1', IN_FEED_TEST_CONNECTION_DELIVERY_HOLD: journey === 'restart' ? '1' : '0',
      IN_FEED_CODEX_ENTRY: fixtureEntry,
      IN_FEED_CODEX_MODE: 'connection',
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(fixtureLoader).href} --import=${pathToFileURL(shutdownHelper).href}` };
    delete env.DATABASE_URL; delete env.DATABASE_MIGRATION_URL;
    processHandle = spawn(process.execPath, ['cli/node_modules/tsx/dist/cli.mjs', 'tests/e2e/in-feed-native/launch.ts', 'In-feed native fixture', testDriveDataDir], { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    processHandle.stdout!.on('data', (chunk) => { logs += chunk.toString(); });
    processHandle.stderr!.on('data', (chunk) => { logs += chunk.toString(); });
    await expect.poll(() => testDriveBaseUrl(logs), { timeout: process.platform === 'win32' ? 180_000 : 100_000 }).toBeTruthy();
    let base = testDriveBaseUrl(logs)!;
    const api = async (path: string, method = 'GET', data?: unknown) => {
      const response = await page.request.fetch(`${base}/api${path}`, { method, data });
      expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
    };
    const isSettledRun = (run: { status: string; errorCode?: string }) => run.status === 'succeeded'
      || (run.status === 'cancelled' && run.errorCode === 'issue_not_in_progress');
    const expectedHealth = { status: 'ok', deploymentMode: 'local_trusted', bootstrapStatus: 'ready', serverInfo: { git: { branchName: execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim() } } };
    let health: Record<string, unknown> | undefined;
    await expect.poll(async () => {
      const response = await page.request.get(`${base}/api/health`);
      if (!response.ok()) return undefined;
      health = await response.json();
      return health;
    }, { timeout: process.platform === 'win32' ? 180_000 : 100_000 }).toMatchObject(expectedHealth);
    const [company] = await api('/companies');
    await expect.poll(async () => (await api(`/companies/${company.id}/agents`)).find((candidate: { name: string }) => candidate.name === 'CEO'), { timeout: 30_000 }).toBeTruthy();
    const agents = await api(`/companies/${company.id}/agents`);
    expect(agents).toHaveLength(1);
    const [agent] = agents;
    expect(agent).toMatchObject({ name: 'CEO', adapterType: 'codex_local' });
    expect(agent.adapterType).toBe('codex_local');
    expect(await api(`/companies/${company.id}/issues`)).toEqual([]);
    expect(await api(`/companies/${company.id}/heartbeat-runs`)).toEqual([]);
    expect((await api(`/companies/${company.id}/tools/connections`)).connections).toEqual([]);
    diagnosticState = async () => ({ base, companyId: company.id, agentId: agent.id,
      nativeRunnerSettingEvidence,
      nativeSkillEvidence,
      tasks: (await api(`/companies/${company.id}/issues`)).map((task: Record<string, unknown>) => ({ id: task.id, status: task.status, assigneeAgentId: task.assigneeAgentId })),
      runs: (await api(`/companies/${company.id}/heartbeat-runs`)).map((run: Record<string, unknown>) => ({ id: run.id, status: run.status, runtimeMode: run.runtimeMode, error: run.error, errorCode: run.errorCode })),
    });
    const dataDir = logs.match(/Data directory: ([^\n\r]+)/)![1]!.replace(/\u001b\[[0-9;]*m/g, '').trim();
    const prefix = `/${company.issuePrefix}`;
    await page.goto(base + prefix + '/dashboard');
    await expect(page.getByText('No runs yet').first()).toBeVisible({ timeout: 30_000 });
    await page.goto(base + prefix + '/company/settings/instance/experimental');
    const nativeRunnerToggle = page.getByRole('switch', { name: 'Toggle Paperclip Runner experimental setting' });
    const settingsBeforeToggle = await api('/instance/settings/experimental') as Record<string, unknown>;
    if (settingsBeforeToggle.enableNativeRunner !== true) {
      const patchResponse = page.waitForResponse((response) =>
        response.url() === `${base}/api/instance/settings/experimental` &&
        response.request().method() === 'PATCH',
      );
      await nativeRunnerToggle.click();
      const response = await patchResponse;
      const settingsAfterPatch = await response.json() as Record<string, unknown>;
      nativeRunnerSettingEvidence = {
        beforeEnableNativeRunner: settingsBeforeToggle.enableNativeRunner,
        patchPayload: response.request().postDataJSON(),
        patchResponseEnableNativeRunner: settingsAfterPatch.enableNativeRunner,
        patchResponseKeys: Object.keys(settingsAfterPatch).sort(),
      };
    } else {
      nativeRunnerSettingEvidence = { beforeEnableNativeRunner: true, patchSkipped: true };
    }
    await expect(nativeRunnerToggle).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => {
      const settingsAfterToggle = await api('/instance/settings/experimental') as Record<string, unknown>;
      nativeRunnerSettingEvidence = {
        ...nativeRunnerSettingEvidence,
        afterEnableNativeRunner: settingsAfterToggle.enableNativeRunner,
        afterKeys: Object.keys(settingsAfterToggle).sort(),
      };
      return settingsAfterToggle.enableNativeRunner;
    }).toBe(true);
    await page.goto(base + prefix + `/agents/${agent.id}/configuration`);
    await page.getByRole('button', { name: 'Codex', exact: true }).click();
    await page.getByRole('button', { name: /Paperclip Runner/ }).click();
    await page.getByRole('button', { name: /^Save(?: changes)?$/ }).first().click();
    await expect.poll(async () => (await api(`/agents/${agent.id}`)).adapterType).toBe('paperclip_runner');
    const nativeAgent = await api(`/agents/${agent.id}`);
    expect(nativeAgent.adapterConfig.env).toEqual(agent.adapterConfig.env);
    // Test-drive may seed desired skills. Windows cannot seal immutable native
    // skills, so prepare this disposable test agent using the public skill API.
    const skillSnapshotBefore = await api(`/agents/${agent.id}/skills?companyId=${company.id}`);
    const skillSync = await api(`/agents/${agent.id}/skills/sync?companyId=${company.id}`, 'POST', { desiredSkills: [], mode: 'replace' });
    const skillSnapshotAfter = await api(`/agents/${agent.id}/skills?companyId=${company.id}`);
    nativeSkillEvidence = {
      beforeDesiredSkills: skillSnapshotBefore.desiredSkills,
      syncDesiredSkills: skillSync.desiredSkills,
      afterDesiredSkills: skillSnapshotAfter.desiredSkills,
    };
    expect(skillSnapshotAfter.desiredSkills).toEqual([]);
    const holder = await api(`/companies/${company.id}/agents`, 'POST', { name: 'Archive holder', role: 'qa', adapterType: 'process', adapterConfig: { command: process.execPath, args: ['-e', 'process.exit(0)'] } });
    await page.goto(base + prefix + '/apps');
    const custom = page.getByRole('list', { name: 'Connector list' }).getByRole('listitem').filter({ hasText: 'Connect your own tool' });
    await custom.getByRole('button', { name: 'Connect', exact: true }).click();
    await custom.getByRole('button', { name: 'Connect your own MCP server' }).click();
    await page.getByPlaceholder('https://example.com/actions').fill(`http://127.0.0.1:${port}/`);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Change', exact: true }).click();
    await page.getByRole('radio', { name: 'Just agents I pick' }).click();
    await page.getByRole('button', { name: /Select agents/ }).click();
    await page.getByRole('checkbox', { name: /Archive holder/ }).check();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Check link/i }).click();
    await expect(page.getByRole('heading', { name: /is ready/i })).toBeVisible({ timeout: 30_000 });
    const [connection] = (await api(`/companies/${company.id}/tools/connections`)).connections;
    const installs = (await api(`/tool-connections/${connection.id}/installs`)).installs;
    expect(installs).toEqual([expect.objectContaining({ targetId: holder.id })]);
    await page.getByRole('link', { name: 'Tasks', exact: true }).click();
    await page.getByRole('button', { name: 'New Task', exact: true }).last().click();
    await page.getByRole('textbox', { name: 'Editable markdown' }).fill('Find the heliotrope launch notes and summarize the decisions with a source link');
    await page.getByRole('button', { name: 'Select assignee', exact: true }).click();
    await page.getByRole('option').filter({ hasText: agent.name }).click();
    await expect(page.getByRole('searchbox', { name: 'Search assignees', includeHidden: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Create task', exact: true }).click();
    await page.getByRole('complementary').getByRole('link', { name: /Find the heliotrope launch notes/ }).click();
    await expect(page).toHaveURL(/issues\/(?:[a-f0-9-]+|INF-\d+)/);
    const connectionIntent = page.getByTestId('connection-intent-focus-target');
    await expect(connectionIntent).toContainText(new RegExp(`Grant ${agent.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} access`), { timeout: 60_000 });
    // This is a scoped access request for the exact tool returned by our local
    // MCP fixture. Verify it before granting; do not treat it as a broad
    // connection setup or approve unrelated tool actions.
    await expect(connectionIntent.getByRole('list', { name: 'Tool permissions' })).toContainText('archive_read');
    const grantAccess = connectionIntent.getByRole('button', { name: 'Grant access', exact: true });
    await expect(grantAccess).toBeVisible();
    await expect.poll(async () => (await api(`/companies/${company.id}/heartbeat-runs`)).every((run: { status: string }) => run.status === 'succeeded'), { timeout: 60_000 }).toBe(true);
    await page.screenshot({ path: info.outputPath('pending-card.png'), fullPage: true });
    const composer = page.getByRole('textbox').last();
    await composer.fill('While I connect, organize the checklist.');
    await expect(composer).toBeEditable();
    if (journey === 'connect') await page.getByRole('button', { name: 'Send', exact: true }).click();
    else await composer.fill('');
    await expect(page.getByTestId('connection-intent-focus-target')).toHaveCount(1);
    if (journey === 'decline') {
      await page.getByRole('button', { name: 'Not now', exact: true }).click();
      await expect(connectionIntent.getByText('Access declined', { exact: true })).toBeVisible();
      await expect(page.getByText(/I will use the information already in this task/).first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('connection-intent-focus-target')).toHaveCount(1);
      expect(calls.filter((method) => method === 'tools/call')).toHaveLength(0);
      await expect.poll(async () => (await api(`/companies/${company.id}/heartbeat-runs`)).every((run: { status: string }) => run.status === 'succeeded'), { timeout: 60_000 }).toBe(true);
      const runs = await Promise.all((await api(`/companies/${company.id}/heartbeat-runs`)).map((run: { id: string }) => api(`/heartbeat-runs/${run.id}`)));
      expect(runs.every((run: { runtimeMode: string }) => run.runtimeMode === 'native')).toBe(true);
      await writeFile(info.outputPath('instance-and-runs.json'), JSON.stringify({ base, dataDir, health, journey, companyId: company.id, agentId: agent.id,
        connectionId: connection.id, dependency: 'fixture', provider: 'codex', fixtureModel: 'in-feed-fixture',
        runs: runs.map((run: Record<string, unknown>) => ({ id: run.id, status: run.status, runtimeMode: run.runtimeMode })) }, null, 2));
      await page.screenshot({ path: info.outputPath('declined-continuation.png'), fullPage: true });
      return;
    }
    await grantAccess.click();
    await expect(page.getByTestId('connection-intent-focus-target').getByText(/access granted$/i)).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('connection-intent-focus-target').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('granted-card.png'), fullPage: true });
    if (journey === 'restart') {
      expect(calls.filter((method) => method === 'tools/call')).toHaveLength(0);
      await writeFile(info.outputPath('before-restart.log'), logs);
      const exit = new Promise<void>((done) => processHandle!.once('exit', () => done()));
      await stopTestDrive(processHandle); await exit;
      logs = '';
      processHandle = spawn(process.execPath, ['cli/node_modules/tsx/dist/cli.mjs', 'tests/e2e/in-feed-native/launch.ts', '', dataDir], { cwd: root, env: { ...env, IN_FEED_TEST_CONNECTION_DELIVERY_HOLD: '0' }, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      processHandle.stdout!.on('data', (chunk) => { logs += chunk.toString(); });
      processHandle.stderr!.on('data', (chunk) => { logs += chunk.toString(); });
      await expect.poll(() => testDriveBaseUrl(logs), { timeout: process.platform === 'win32' ? 180_000 : 100_000 }).toBeTruthy();
      base = testDriveBaseUrl(logs)!;
      expect((await api('/companies'))[0].id).toBe(company.id);
      const taskId = (await api(`/companies/${company.id}/issues`))[0].id;
      await page.goto(base + prefix + '/issues/' + taskId);
    }
    // The gateway keeps the read-only MCP invocation behind a separate,
    // human-only approval. It is intentionally not folded into the access
    // grant above: assert the exact fixture tool before approving it.
    const approval = page.getByRole('region', { name: 'Approve tool action' });
    await expect(approval).toContainText('archive_read', { timeout: 30_000 });
    const approveArchiveRead = approval.getByRole('button', { name: 'Approve & run', exact: true });
    await expect(approveArchiveRead).toBeVisible({ timeout: 30_000 });
    await approveArchiveRead.click();
    await expect(page.getByText(/HELIOTROPE-42: Launch in two stages/).first()).toBeVisible({ timeout: 60_000 });
    expect(calls.filter((method) => method === 'tools/call')).toHaveLength(1);
    await expect.poll(async () => (await api(`/companies/${company.id}/heartbeat-runs`)).every(isSettledRun), { timeout: 60_000 }).toBe(true);
    await expect(page.getByText(/HELIOTROPE-42: Launch in two stages/).first()).toBeVisible();
    await expect(async () => { await page.getByText(/HELIOTROPE-42: Launch in two stages/).first().scrollIntoViewIfNeeded(); }).toPass({ timeout: 10_000 });
    const runs = await Promise.all((await api(`/companies/${company.id}/heartbeat-runs`)).map((run: { id: string }) => api(`/heartbeat-runs/${run.id}`)));
    expect(runs.filter((run: { status: string }) => run.status === 'succeeded').length).toBeGreaterThanOrEqual(2);
    if (runs.some((run: { status: string }) => run.status === 'cancelled')) {
      // Independent work may consume the new access before the queued outcome
      // runs. Closing the task must cancel that redundant wake, not reopen it.
      expect((await api(`/companies/${company.id}/issues`))[0].status).toBe('done');
    }
    expect(runs.filter((run: { status: string }) => run.status === 'succeeded').every((run: { runtimeMode: string }) => run.runtimeMode === 'native')).toBe(true);
    await expect(page.getByText('The runner returned no user-facing response.', { exact: true })).not.toBeVisible();
    await page.screenshot({ path: info.outputPath('connected-answer.png'), fullPage: true });
    await page.reload();
    await expect(page.getByText(/HELIOTROPE-42: Launch in two stages/).first()).toBeVisible();
    if (journey === 'connect') {
      const response = page.getByText(/HELIOTROPE-42: Launch in two stages/);
      const priorResponseCount = await response.count();
      const priorRunIds = new Set((await api(`/companies/${company.id}/heartbeat-runs`)).map((run: { id: string }) => run.id));
      await page.getByRole('textbox').last().fill('What is the support handoff decision in the archive?');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      // The approved invocation is idempotently replayed for the follow-up.
      // The user still receives a new native response, while the MCP server is
      // not called a second time with the same read-only action.
      await expect.poll(async () => {
        const newRuns = (await api(`/companies/${company.id}/heartbeat-runs`)).filter((run: { id: string; status: string }) => !priorRunIds.has(run.id));
        if (newRuns.length === 0 || !newRuns.every((run: { status: string }) => isSettledRun(run) && run.status === 'succeeded')) return false;
        const newRunDetails = await Promise.all(newRuns.map((run: { id: string }) => api(`/heartbeat-runs/${run.id}`)));
        return newRunDetails.every((run: { runtimeMode: string }) => run.runtimeMode === 'native');
      }, { timeout: 60_000 }).toBe(true);
      await expect(response).toHaveCount(priorResponseCount + 1, { timeout: 60_000 });
      await expect(response.nth(priorResponseCount)).toContainText('support handoff belongs to Mira');
      expect(calls.filter((method) => method === 'tools/call')).toHaveLength(1);
      await expect(page.getByTestId('connection-intent-focus-target')).toHaveCount(1);
    }
    const finalRuns = await Promise.all((await api(`/companies/${company.id}/heartbeat-runs`)).map((run: { id: string }) => api(`/heartbeat-runs/${run.id}`)));
    expect(finalRuns.filter((run: { status: string }) => run.status === 'succeeded').every((run: { runtimeMode: string }) => run.runtimeMode === 'native')).toBe(true);
    const evidence = JSON.stringify({ base, dataDir, health, journey, companyId: company.id, agentId: agent.id, connectionId: connection.id, runs: finalRuns.map((r: Record<string, unknown>) => ({ id: r.id, runtimeMode: r.runtimeMode, status: r.status })), dependency: 'fixture', provider: 'codex', fixtureModel: 'in-feed-fixture' }, null, 2);
    await writeFile(info.outputPath('instance-and-runs.json'), evidence);
    await info.attach('instance-and-runs', { body: evidence, contentType: 'application/json' });
  } finally {
    try {
      try {
        await writeFile(info.outputPath('diagnostics.json'), JSON.stringify(await diagnosticState().catch(() => ({})), null, 2));
      } finally {
        await writeFile(info.outputPath('test-drive.log'), logs);
      }
    } finally {
      await stopTestDrive(processHandle);
      fixture.closeAllConnections();
      await new Promise<void>((done) => fixture.close(() => done()));
    }
  }
});

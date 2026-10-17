import { expect, test } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
  if (!child?.pid) return;
  const signal = (name: NodeJS.Signals) => {
    try { process.kill(-child.pid!, name); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  const waitForExit = (timeoutMs: number) => {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    return new Promise<boolean>((done) => {
      const exited = () => { clearTimeout(timer); done(true); };
      const timer = setTimeout(() => { child.removeListener('exit', exited); done(false); }, timeoutMs);
      child.once('exit', exited);
    });
  };
  if (child.exitCode !== null || child.signalCode !== null) return;
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
    return;
  }
  const stopped = waitForExit(15_000);
  signal('SIGTERM');
  if (await stopped) return;
  const killed = waitForExit(5_000);
  signal('SIGKILL');
  if (!(await killed)) throw new Error('test-drive process did not exit after SIGKILL');
}

test('a completion tool does not cut off a delayed final answer', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const root = resolve(import.meta.dirname, '../../..');
  let child: ChildProcess | undefined;
  let logs = '';
  try {
    const dataDir = await mkdtemp(join(os.tmpdir(), 'paperclip-in-feed-completion-'));
    const fixtureEntry = resolve(root, 'tests/e2e/fixtures/in-feed-codex.mjs');
    const fixtureLoader = resolve(root, 'tests/e2e/fixtures/in-feed-codex-loader.mjs');
    const shutdownHelper = resolve(root, 'tests/e2e/fixtures/native-test-drive-shutdown.mjs');
    const env = { ...process.env, STREAM_FIXTURE_KEY: 'not-a-real-model-key', NODE_ENV: 'test',
      IN_FEED_CODEX_ENTRY: fixtureEntry,
      IN_FEED_CODEX_MODE: 'completion',
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(fixtureLoader).href} --import=${pathToFileURL(shutdownHelper).href}` };
    delete env.DATABASE_URL;
    delete env.DATABASE_MIGRATION_URL;
    env.IN_FEED_FIXTURE_KEY = env.STREAM_FIXTURE_KEY;
    env.IN_FEED_TEST_DRIVE_SHUTDOWN = '1';
    child = spawn(process.execPath, ['cli/node_modules/tsx/dist/cli.mjs', 'tests/e2e/in-feed-native/launch.ts',
      'Stream completion', dataDir],
    { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout!.on('data', (chunk) => { logs += chunk.toString(); });
    child.stderr!.on('data', (chunk) => { logs += chunk.toString(); });
    await expect.poll(() => testDriveBaseUrl(logs), { timeout: process.platform === 'win32' ? 180_000 : 100_000 }).toBeTruthy();
    const base = testDriveBaseUrl(logs)!;
    const api = async (path: string, method = 'GET', data?: unknown) => {
      const response = await page.request.fetch(`${base}/api${path}`, { method, data });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    };
    const expectedHealth = { status: 'ok', deploymentMode: 'local_trusted', bootstrapStatus: 'ready',
      serverInfo: { git: { branchName: execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim() } } };
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
    expect(await api(`/companies/${company.id}/issues`)).toEqual([]);
    expect(await api(`/companies/${company.id}/heartbeat-runs`)).toEqual([]);
    const prefix = `/${company.issuePrefix}`;
    await page.goto(base + prefix + '/dashboard');
    await page.goto(base + prefix + '/company/settings/instance/experimental');
    if (!(await api('/instance/settings/experimental')).enableNativeRunner) {
      await page.getByRole('switch', { name: 'Toggle Paperclip Runner experimental setting' }).click();
    }
    await expect.poll(async () => (await api('/instance/settings/experimental')).enableNativeRunner).toBe(true);
    await page.goto(base + prefix + `/agents/${agent.id}/configuration`);
    await page.getByRole('button', { name: 'Codex', exact: true }).click();
    await page.getByRole('button', { name: /Paperclip Runner/ }).click();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(async () => (await api(`/agents/${agent.id}`)).adapterType).toBe('paperclip_runner');
    // Native runtime skill sealing is intentionally unavailable on Windows.
    // Test-drive can seed default desired skills, so clear only this disposable
    // agent through its supported API before starting the native run.
    const skillSnapshotBefore = await api(`/agents/${agent.id}/skills?companyId=${company.id}`);
    const skillSync = await api(`/agents/${agent.id}/skills/sync?companyId=${company.id}`, 'POST', { desiredSkills: [], mode: 'replace' });
    const skillSnapshotAfter = await api(`/agents/${agent.id}/skills?companyId=${company.id}`);
    expect(skillSnapshotAfter.desiredSkills).toEqual([]);
    await page.getByRole('link', { name: 'Tasks', exact: true }).click();
    await page.getByRole('button', { name: 'New Task', exact: true }).last().click();
    await page.getByRole('textbox', { name: 'Editable markdown' }).fill('Summarize the launch decisions and include the source link');
    await page.getByRole('button', { name: 'Select assignee', exact: true }).click();
    await page.getByRole('option').filter({ hasText: agent.name }).click();
    await expect(page.getByRole('searchbox', { name: 'Search assignees', includeHidden: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Create task', exact: true }).click();
    await expect.poll(async () => (await api(`/companies/${company.id}/issues`)).length).toBe(1);
    const [issue] = await api(`/companies/${company.id}/issues`);
    await page.goto(`${base}${prefix}/issues/${issue.identifier}`);
    await expect.poll(async () => (await api(`/companies/${company.id}/heartbeat-runs`))[0]?.status, { timeout: 60_000 }).toBe('succeeded');
    await expect(page.getByText('STREAM-42: The launch has two stages.', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'https://example.invalid/launch/STREAM-42', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Editable markdown', exact: true })).toBeEditable();
    await page.reload();
    await expect(page.getByText('STREAM-42: The launch has two stages.', { exact: false }).first()).toBeVisible();
    const runs = await api(`/companies/${company.id}/heartbeat-runs`);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'succeeded' });
    const run = await api(`/heartbeat-runs/${runs[0].id}`);
    expect(run.runtimeMode).toBe('native');
    expect(run.resultJson.presentationDecision.chosenSource).toBe('final_agent_message');
    const comments = await api(`/issues/${issue.id}/comments`);
    expect(comments.filter((comment: { body: string }) => comment.body.includes('STREAM-42'))).toHaveLength(1);
    await page.screenshot({ path: info.outputPath('delayed-final-answer.png'), fullPage: true });
    await writeFile(info.outputPath('evidence.json'), JSON.stringify({ base, health, companyId: company.id, issueId: issue.id,
      runId: run.id, dependency: 'deterministic Codex app-server fixture', delayMs: 31000,
      dataDir: logs.match(/Data directory: ([^\n\r]+)/)?.[1], presentation: run.resultJson.presentationDecision,
      skills: { before: skillSnapshotBefore.desiredSkills, sync: skillSync.desiredSkills, after: skillSnapshotAfter.desiredSkills } }, null, 2));
  } finally {
    try { await stopTestDrive(child); }
    finally { await writeFile(info.outputPath('test-drive.log'), logs); }
  }
});

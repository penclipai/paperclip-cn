import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { BRANDING } from '@penclipai/shared/branding';
import { prepareReportLock } from '../../tests/runner-e2e/prepare-report-lock.mjs';

// A Dependabot lockfile is not in the proof yet. The pr-trusted policy job verifies that it comes from
// a verified Dependabot commit, and the lockfile refresh renews the proof after it merges.
// See .github/scripts/lockfile-trust.mjs.
const pendingDependabotLock = process.env.PAPERCLIP_CI_PR_AUTHOR === 'dependabot[bot]';
// The upstream proof authorizes its paid reporter, not a CN controller lock.
// GitHub's repository identity wins in CI. Only the known CN fork takes the
// rejection path; unknown repositories still have to satisfy the proof.
const controllerRepository = process.env.GITHUB_REPOSITORY?.trim()
  || BRANDING.repositoryUrl.replace(/^https:\/\/github\.com\//, '');
const cnController = controllerRepository === 'penclipai/paperclip-cn';

it.skipIf(!cnController && pendingDependabotLock)(cnController
  ? 'keeps the CN controller lock outside upstream paid reporting authority'
  : 'admits the committed controller lock through the reviewed reporting policy before paid execution', async () => {
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  const root = await mkdtemp(path.join(tmpdir(), 'controller-report-policy-'));
  const relative = 'tests/runner-e2e';
  try {
    await mkdir(path.join(root, relative), { recursive: true });
    for (const file of ['report-lock.json', 'report-lock.patch']) {
      await copyFile(path.join(repository, relative, file), path.join(root, relative, file));
    }
    const committedLock = execFileSync('git', ['show', 'HEAD:pnpm-lock.yaml'], { cwd: repository });
    await writeFile(path.join(root, 'pnpm-lock.yaml'), committedLock);
    if (cnController) {
      await expect(prepareReportLock(root)).rejects.toThrow('Reporting lock changed; review the dependency correction before install');
      expect(await readFile(path.join(root, 'pnpm-lock.yaml'))).toEqual(committedLock);
      return;
    }
    await prepareReportLock(root);
    const policy = JSON.parse(await readFile(path.join(root, relative, 'report-lock.json'), 'utf8'));
    expect(createHash('sha256').update(await readFile(path.join(root, 'pnpm-lock.yaml'))).digest('hex')).toBe(policy.outputSha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

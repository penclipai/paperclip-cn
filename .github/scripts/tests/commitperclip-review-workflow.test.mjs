import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const workflow = readFileSync(path.join(repoRoot, '.github/workflows/commitperclip-review.yml'), 'utf8').replace(/\r\n/g, '\n');

function step(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = workflow.match(new RegExp(`      - name: ${escapedName}\\n([\\s\\S]*?)(?=\\n      - |\\n  [a-z_]+:|$)`));
  assert.ok(match, `missing ${name} step`);
  return match[0];
}

function authScript() {
  const auth = step('Select review identity');
  const match = auth.match(/run: \|\n((?: {10}[^\n]*\n?)+)/);
  assert.ok(match, 'missing review identity shell');
  return match[1].replace(/^ {10}/gm, '');
}

async function selectIdentity(repository, repositoryId) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'commitperclip-review-auth-'));
  const output = path.join(root, 'github-output');
  try {
    const result = spawnSync(bash, ['--noprofile', '--norc', '-c', authScript()], {
      env: { ...process.env, GITHUB_REPOSITORY: repository, GITHUB_REPOSITORY_ID: repositoryId, GITHUB_OUTPUT: output },
      encoding: 'utf8',
    });
    return { status: result.status, stderr: result.stderr, output: result.status === 0 ? await readFile(output, 'utf8') : '' };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('review identity selects the token and comment author for each trusted repository', async () => {
  assert.deepEqual(await selectIdentity('penclipai/paperclip-cn', '1192887762'), {
    status: 0,
    stderr: '',
    output: 'mode=github-token\nauthor=github-actions[bot]\n',
  });
  assert.deepEqual(await selectIdentity('paperclipai/paperclip', '1170821064'), {
    status: 0,
    stderr: '',
    output: 'mode=commitperclip-app\nauthor=commitperclip[bot]\n',
  });
});

test('review identity fails closed for an unknown repository or incorrect repository ID', async () => {
  for (const [repository, repositoryId] of [
    ['unknown/paperclip', '1192887762'],
    ['penclipai/paperclip-cn', '1170821064'],
  ]) {
    const result = await selectIdentity(repository, repositoryId);
    assert.equal(result.status, 1, `${repository}:${repositoryId}`);
    assert.match(result.stderr, /not authorized for commitperclip review/);
  }
});

test('review workflow checks out only the immutable PR base and keeps CN out of the App-token path', () => {
  const checkout = step('Checkout base branch (never PR code)');
  const generateToken = step('Generate commitperclip token');
  const quality = step('Run quality gates');
  assert.match(checkout, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(checkout, /persist-credentials: false/);
  assert.doesNotMatch(checkout, /head\.(?:sha|ref)|github\.sha|ref: master/);
  assert.match(workflow, /^permissions:\n\s+pull-requests: write\n\s+contents: read$/m);
  assert.doesNotMatch(workflow, /^\s+checks: write$/m);
  assert.match(generateToken, /if: steps\.review_identity\.outputs\.mode == 'commitperclip-app'/);
  assert.match(quality, /GH_TOKEN: \$\{\{ steps\.review_identity\.outputs\.mode == 'github-token' && github\.token \|\| steps\.token\.outputs\.value \}\}/);
  assert.match(quality, /QUALITY_COMMENT_AUTHOR: \$\{\{ steps\.review_identity\.outputs\.author \}\}/);
  assert.doesNotMatch(quality, /COMMITPERCLIP_KEY/);
});

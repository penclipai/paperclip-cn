import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findExistingComment } from '../run-quality-gates.mjs';

test('findExistingComment: paginates until it finds the commitperclip comment', async () => {
  const seenPaths = [];
  const comment = await findExistingComment(async (path) => {
    seenPaths.push(path);
    if (path.endsWith('page=1')) {
      return Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        user: { login: 'someone-else' },
        body: 'unrelated',
      }));
    }
    if (path.endsWith('page=2')) {
      return [{
        id: 200,
        user: { login: 'commitperclip[bot]' },
        body: 'Looks good.\n\n— commitperclip',
      }];
    }
    return [];
  }, 'token', 'paperclipai/paperclip', 6469);

  assert.equal(comment.id, 200);
  assert.deepEqual(seenPaths, [
    '/repos/paperclipai/paperclip/issues/6469/comments?per_page=100&page=1',
    '/repos/paperclipai/paperclip/issues/6469/comments?per_page=100&page=2',
  ]);
});

test('findExistingComment: preserves legacy commitperclip authors by default', async () => {
  const comment = await findExistingComment(async () => ([{
    id: 2,
    user: { login: 'commitperclip' },
    body: 'Legacy status.\n\n— commitperclip',
  }]), 'token', 'penclipai/paperclip-cn', 164);

  assert.equal(comment.id, 2);
});

test('findExistingComment: accepts only the configured CN GitHub Actions author', async () => {
  const comment = await findExistingComment(async () => ([
    { id: 3, user: { login: 'commitperclip[bot]' }, body: 'Old status.\n\n— commitperclip' },
    { id: 4, user: { login: 'github-actions[bot]' }, body: 'CN status.\n\n— commitperclip' },
  ]), 'token', 'penclipai/paperclip-cn', 164, 'github-actions[bot]');

  assert.equal(comment.id, 4);
});

test('findExistingComment: rejects signed comments from an unexpected author', async () => {
  const comment = await findExistingComment(async () => ([{
    id: 5,
    user: { login: 'some-other-bot[bot]' },
    body: 'Impostor status.\n\n— commitperclip',
  }]), 'token', 'penclipai/paperclip-cn', 164, 'github-actions[bot]');

  assert.equal(comment, null);
});

test('findExistingComment: rejects an untrusted configured author instead of matching any bot', async () => {
  await assert.rejects(
    findExistingComment(async () => [], 'token', 'penclipai/paperclip-cn', 164, 'some-other-bot[bot]'),
    /QUALITY_COMMENT_AUTHOR is not trusted/,
  );
});

test('findExistingComment: returns null after every paginated comment misses the configured author', async () => {
  const seenPaths = [];
  const comment = await findExistingComment(async (path) => {
    seenPaths.push(path);
    if (path.endsWith('page=1')) {
      return Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        user: { login: 'commitperclip[bot]' },
        body: 'Signed, but not CN.\n\n— commitperclip',
      }));
    }
    return [{
      id: 101,
      user: { login: 'some-other-bot[bot]' },
      body: 'Still wrong.\n\n— commitperclip',
    }];
  }, 'token', 'penclipai/paperclip-cn', 164, 'github-actions[bot]');

  assert.equal(comment, null);
  assert.deepEqual(seenPaths, [
    '/repos/penclipai/paperclip-cn/issues/164/comments?per_page=100&page=1',
    '/repos/penclipai/paperclip-cn/issues/164/comments?per_page=100&page=2',
  ]);
});

test('findExistingComment: returns null when no signed comment exists', async () => {
  const comment = await findExistingComment(async () => ([
    {
      id: 1,
      user: { login: 'commitperclip[bot]' },
      body: 'Unsigned status update',
    },
  ]), 'token', 'paperclipai/paperclip', 6469);

  assert.equal(comment, null);
});

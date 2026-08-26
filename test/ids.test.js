import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRemoteUrl, repoKey, runId, extractTicket } from '../lib/ids.js';

test('normalizeRemoteUrl collapses ssh/https/case/.git to one key', () => {
  const expected = 'github.com/yaniv120892/finance-app';
  assert.equal(normalizeRemoteUrl('git@github.com:yaniv120892/finance-app.git'), expected);
  assert.equal(normalizeRemoteUrl('https://github.com/Yaniv120892/Finance-App.git'), expected);
  assert.equal(normalizeRemoteUrl('ssh://git@github.com/yaniv120892/finance-app'), expected);
  assert.equal(
    normalizeRemoteUrl('https://user:tok@github.com/yaniv120892/finance-app/'),
    expected,
  );
  assert.equal(normalizeRemoteUrl(null), null);
});

test('repoKey falls back to main worktree path', () => {
  assert.equal(repoKey({ remoteUrl: null, mainPath: '/home/u/repo' }), 'path:/home/u/repo');
  assert.equal(repoKey({ remoteUrl: 'git@github.com:a/b.git', mainPath: '/x' }), 'github.com/a/b');
});

test('runId is stable, 16 hex, and distinguishes birth', () => {
  const a = runId({
    repoKey: 'github.com/a/b',
    branch: 'feat/x',
    birthIso: '2026-08-25T10:00:00Z',
  });
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(
    a,
    runId({ repoKey: 'github.com/a/b', branch: 'feat/x', birthIso: '2026-08-25T10:00:00Z' }),
  );
  assert.notEqual(
    a,
    runId({ repoKey: 'github.com/a/b', branch: 'feat/x', birthIso: '2026-08-26T10:00:00Z' }),
  );
});

test('extractTicket finds identifiers case-insensitively', () => {
  assert.equal(extractTicket('yaniv/yan-61-remote-sessions'), 'YAN-61');
  assert.equal(extractTicket('fix: handle ABC-123 edge'), 'ABC-123');
  assert.equal(extractTicket('feat/price-alerts'), null);
  assert.equal(extractTicket(null), null);
});

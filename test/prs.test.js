import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGhClient } from '../lib/collectors/prs.js';

function stubExec(responses) {
  return async (cmd, args) => {
    const key = args.slice(0, 2).join(' ');
    const r = responses[key];
    if (r instanceof Error) {
      throw r;
    }
    return { stdout: typeof r === 'string' ? r : JSON.stringify(r) };
  };
}

test('authStatus gates on gh availability', async () => {
  const ok = createGhClient({ execFileP: stubExec({ 'auth status': '' }) });
  assert.equal((await ok.authStatus()).ok, true);
  const bad = createGhClient({
    execFileP: stubExec({ 'auth status': new Error('not logged in') }),
  });
  assert.equal((await bad.authStatus()).ok, false);
});

test('authStatus reports "gh not installed" when the binary is missing (M1)', async () => {
  const enoent = new Error('spawn gh ENOENT');
  enoent.code = 'ENOENT';
  const gh = createGhClient({ execFileP: async () => Promise.reject(enoent) });
  const out = await gh.authStatus();
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'gh not installed');
});

test('listOpenPrs parses gh json', async () => {
  const gh = createGhClient({
    execFileP: stubExec({
      'pr list': [
        { number: 7, title: 'fix', url: 'http://pr/7', headRefName: 'fix/x', isDraft: false },
      ],
    }),
  });
  const { ok, prs } = await gh.listOpenPrs('/repo');
  assert.equal(ok, true);
  assert.deepEqual(prs[0], {
    number: 7,
    title: 'fix',
    url: 'http://pr/7',
    headRefName: 'fix/x',
    isDraft: false,
  });
});

test('prDetail rolls up checks by conclusion', async () => {
  const gh = createGhClient({
    execFileP: stubExec({
      'pr view': {
        state: 'OPEN',
        url: 'u',
        isDraft: false,
        reviewDecision: 'APPROVED',
        statusCheckRollup: [
          { conclusion: 'SUCCESS' },
          { conclusion: 'FAILURE' },
          { status: 'IN_PROGRESS' },
        ],
      },
    }),
  });
  const { pr } = await gh.prDetail('/repo', 7);
  assert.deepEqual(pr.checks, { pass: 1, fail: 1, pending: 1 });
  assert.equal(typeof pr.fetchedAt, 'number');
});

test('failures come back as {ok:false, reason}', async () => {
  const gh = createGhClient({ execFileP: stubExec({ 'pr list': new Error('boom') }) });
  const out = await gh.listOpenPrs('/repo');
  assert.equal(out.ok, false);
  assert.match(out.reason, /boom/);
});

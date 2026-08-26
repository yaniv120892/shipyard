import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linearProvider } from '../lib/tracker/linear.js';
import { getProvider } from '../lib/tracker/provider.js';

const CFG = { provider: 'linear', workspace: 'w', teams: [], projects: [], states: [], cap: 3 };

function page(nodes, endCursor, hasNextPage) {
  return {
    ok: true,
    json: async () => ({
      data: {
        viewer: {
          assignedIssues: {
            nodes,
            pageInfo: { endCursor, hasNextPage },
          },
        },
      },
    }),
  };
}

const issue = (n) => ({
  identifier: `YAN-${n}`,
  title: `t${n}`,
  url: `http://i/${n}`,
  branchName: `me/yan-${n}-t`,
  state: { name: 'Todo', type: 'unstarted' },
});

test('paginates until the cap and flattens state fields', async () => {
  const pages = [page([issue(1), issue(2)], 'c1', true), page([issue(3), issue(4)], null, false)];
  const fetchImpl = async () => pages.shift();
  const out = await linearProvider.listMyOpenIssues(CFG, { fetchImpl, apiKey: 'k' });
  assert.equal(out.ok, true);
  assert.equal(out.issues.length, 3); // cap
  assert.deepEqual(out.issues[0], {
    identifier: 'YAN-1',
    title: 't1',
    url: 'http://i/1',
    branchName: 'me/yan-1-t',
    state: 'Todo',
    stateType: 'unstarted',
  });
});

test('GraphQL errors on HTTP 200 are failures', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ errors: [{ message: 'bad key' }] }),
  });
  const out = await linearProvider.listMyOpenIssues(CFG, { fetchImpl, apiKey: 'k' });
  assert.equal(out.ok, false);
  assert.match(out.reason, /bad key/);
});

test('missing API key fails soft without calling fetch', async () => {
  const out = await linearProvider.listMyOpenIssues(CFG, {
    fetchImpl: () => {
      throw new Error('called');
    },
    apiKey: undefined,
  });
  assert.equal(out.ok, false);
  assert.match(out.reason, /LINEAR_API_KEY/);
});

test('getProvider resolves linear and rejects unknown', () => {
  assert.equal(getProvider({ tracker: { provider: 'linear' } }).name, 'linear');
  assert.throws(() => getProvider({ tracker: { provider: 'jira' } }), /unknown tracker/i);
});

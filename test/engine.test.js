import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createEngine } from '../lib/engine.js';
import { makeArea, makeRepo, addWorktree } from './helpers/gitfix.js';

test('engine assembles a ship flow from a scanned worktree and archives it', async () => {
  const area = makeArea();
  const home = makeArea();
  const repo = makeRepo(area, 'app', { remote: 'git@github.com:me/app.git' });
  addWorktree(repo, path.join(area, 'wt'), 'feat/x');
  const ship = path.join(area, 'wt', '.claude', 'ship');
  fs.mkdirSync(path.join(ship, 'reports'), { recursive: true });
  fs.writeFileSync(
    path.join(ship, 'state.json'),
    JSON.stringify({
      slug: 'x',
      branch: 'feat/x',
      phase: 'ready-to-merge',
      pr: 5,
      history: [{ phase: 'plan', at: '2026-08-25T10:00:00Z' }],
    }),
  );

  const engine = createEngine({
    config: {
      roots: [area],
      maxDepth: 4,
      activityThresholdMinutes: 10,
      networkTtlSeconds: 90,
      ignore: [],
      history: { maxEntries: 10, maxAgeDays: 10 },
      tracker: { provider: 'linear', workspace: 'w', cap: 5 },
    },
    home,
    deps: {
      ghClient: {
        authStatus: async () => ({ ok: false, reason: 'stub' }),
        prState: async () => ({ ok: false, reason: 'stub' }),
      },
      tracker: { name: 'stub', listMyOpenIssues: async () => ({ ok: false, reason: 'stub' }) },
    },
  });
  await engine.refreshDiscovery();
  await engine.fastTick();
  const snap = engine.getSnapshot();
  const flow = snap.flows.find((f) => f.kind === 'ship');
  assert.equal(flow.group, 'needsYou');
  assert.equal(flow.action, 'merge');
  assert.equal(
    fs.existsSync(path.join(home, '.claude', 'shipyard', 'history', flow.id, 'ship', 'state.json')),
    true,
  );
  assert.equal(engine.docPath(flow.id, '.claude/ship/state.json') !== null, true);
  assert.equal(engine.docPath(flow.id, '../outside'), null);
});

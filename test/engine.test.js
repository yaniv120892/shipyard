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

function stubDeps() {
  return {
    ghClient: {
      authStatus: async () => ({ ok: false, reason: 'stub' }),
      prState: async () => ({ ok: false, reason: 'stub' }),
    },
    tracker: { name: 'stub', listMyOpenIssues: async () => ({ ok: false, reason: 'stub' }) },
  };
}

function baseConfig(area) {
  return {
    roots: [area],
    maxDepth: 4,
    activityThresholdMinutes: 10,
    networkTtlSeconds: 90,
    ignore: [],
    history: { maxEntries: 10, maxAgeDays: 10 },
    tracker: { provider: 'linear', workspace: 'w', cap: 5 },
  };
}

test('H1/H3 — plan.md resolves live, and a shipped run survives worktree deletion', async () => {
  const area = makeArea();
  const home = makeArea();
  const repo = makeRepo(area, 'app', { remote: 'git@github.com:me/app.git' });
  const wt = path.join(area, 'wt-shipped');
  addWorktree(repo, wt, 'feat/shipped-thing');
  const ship = path.join(wt, '.claude', 'ship');
  fs.mkdirSync(ship, { recursive: true });
  fs.writeFileSync(path.join(ship, 'plan.md'), '# the plan');
  fs.writeFileSync(
    path.join(ship, 'state.json'),
    JSON.stringify({
      slug: 'shipped-thing',
      branch: 'feat/shipped-thing',
      phase: 'merged',
      pr: 9,
      history: [{ phase: 'plan', at: '2026-08-25T10:00:00Z' }],
    }),
  );

  const engine = createEngine({ config: baseConfig(area), home, deps: stubDeps() });
  await engine.refreshDiscovery();
  await engine.fastTick();

  const live = engine.getSnapshot().flows.find((f) => f.kind === 'ship');
  assert.equal(live.group, 'shipped');
  const liveDocPath = engine.docPath(live.id, '.claude/ship/plan.md');
  assert.equal(liveDocPath, path.join(ship, 'plan.md'));
  assert.equal(fs.readFileSync(liveDocPath, 'utf8'), '# the plan');

  // simulate the normal post-merge cleanup this feature exists to survive
  fs.rmSync(wt, { recursive: true, force: true });
  await engine.refreshDiscovery();
  await engine.fastTick();

  const snap = engine.getSnapshot();
  const shipped = snap.flows.find((f) => f.id === live.id);
  assert.ok(shipped, 'archived run should still appear as a flow');
  assert.equal(shipped.kind, 'ship');
  assert.equal(shipped.group, 'shipped');
  assert.equal(shipped.branch, 'feat/shipped-thing');
  assert.equal(shipped.repo.name, 'app');

  const archivedDocPath = engine.docPath(shipped.id, '.claude/ship/plan.md');
  assert.notEqual(archivedDocPath, null);
  assert.equal(fs.readFileSync(archivedDocPath, 'utf8'), '# the plan');
});

test('H3 — an archived run pinned more than 7 days ago is not resurrected', async () => {
  const area = makeArea();
  const home = makeArea();
  const repo = makeRepo(area, 'app', { remote: 'git@github.com:me/app.git' });
  const wt = path.join(area, 'wt-old');
  addWorktree(repo, wt, 'feat/old-thing');
  const ship = path.join(wt, '.claude', 'ship');
  fs.mkdirSync(ship, { recursive: true });
  fs.writeFileSync(
    path.join(ship, 'state.json'),
    JSON.stringify({ slug: 'old', branch: 'feat/old-thing', phase: 'merged', history: [] }),
  );

  const engine = createEngine({ config: baseConfig(area), home, deps: stubDeps() });
  await engine.refreshDiscovery();
  await engine.fastTick();
  const live = engine.getSnapshot().flows.find((f) => f.kind === 'ship');

  const metaFile = path.join(home, '.claude', 'shipyard', 'history', live.id, 'meta.json');
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  meta.pinnedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(metaFile, JSON.stringify(meta));

  fs.rmSync(wt, { recursive: true, force: true });
  await engine.refreshDiscovery();
  await engine.fastTick();

  const snap = engine.getSnapshot();
  assert.equal(
    snap.flows.some((f) => f.id === live.id),
    false,
  );
});

function makeShipRepo(area, name, branch) {
  const repo = makeRepo(area, name, { remote: `git@github.com:me/${name}.git` });
  const wt = path.join(area, `${name}-wt`);
  addWorktree(repo, wt, branch);
  const ship = path.join(wt, '.claude', 'ship');
  fs.mkdirSync(ship, { recursive: true });
  fs.writeFileSync(
    path.join(ship, 'state.json'),
    JSON.stringify({ slug: name, branch, phase: 'implement', history: [] }),
  );
}

test('H2 — updateConfig applies a saved partial and re-scans the new roots', async () => {
  const areaA = makeArea();
  const areaB = makeArea();
  const home = makeArea();
  makeShipRepo(areaA, 'repo-a', 'feat/a');
  makeShipRepo(areaB, 'repo-b', 'feat/b');

  const engine = createEngine({ config: baseConfig(areaA), home, deps: stubDeps() });
  await engine.refreshDiscovery();
  await engine.fastTick();
  const liveNames = (flows) =>
    flows.filter((f) => f.kind === 'ship' && f.group !== 'shipped').map((f) => f.repo.name);

  let snap = engine.getSnapshot();
  assert.deepEqual(liveNames(snap.flows), ['repo-a']);

  // route-level effect under test: a Setup-panel save (H2) must reach the running
  // engine's in-memory config, not just the disk file
  await engine.updateConfig({ roots: [areaB] });
  snap = engine.getSnapshot();
  assert.deepEqual(snap.setup.roots, [areaB]);
  assert.deepEqual(liveNames(snap.flows), ['repo-b']);
});

test('L2 — a permanently torn state.json over a cached read surfaces a degraded entry', async () => {
  const area = makeArea();
  const home = makeArea();
  const repo = makeRepo(area, 'app', { remote: 'git@github.com:me/app.git' });
  const wt = path.join(area, 'wt-torn');
  addWorktree(repo, wt, 'feat/torn');
  const ship = path.join(wt, '.claude', 'ship');
  fs.mkdirSync(ship, { recursive: true });
  fs.writeFileSync(
    path.join(ship, 'state.json'),
    JSON.stringify({ slug: 't', branch: 'feat/torn', phase: 'qa', history: [] }),
  );

  const engine = createEngine({ config: baseConfig(area), home, deps: stubDeps() });
  await engine.refreshDiscovery();
  await engine.fastTick();
  let flow = engine.getSnapshot().flows.find((f) => f.kind === 'ship');
  assert.equal(flow.degraded, undefined);

  fs.writeFileSync(path.join(ship, 'state.json'), '{"slug": "t", "pha'); // torn
  for (let i = 0; i < 3; i++) await engine.fastTick();

  flow = engine.getSnapshot().flows.find((f) => f.kind === 'ship');
  assert.deepEqual(flow.degraded, [
    { source: 'ship', reason: 'state.json unreadable — showing last good state' },
  ]);
  assert.equal(flow.state.phase, 'qa'); // still serving last-known-good
});

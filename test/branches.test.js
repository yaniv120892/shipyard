import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { discoverRepos } from '../lib/scan.js';
import { createBranchCollector } from '../lib/collectors/branches.js';
import { makeArea, makeRepo, addWorktree } from './helpers/gitfix.js';

test('collects non-default-branch worktrees with dirty count and last commit', async () => {
  const area = makeArea();
  const a = makeRepo(area, 'app', { remote: 'git@github.com:me/app.git' });
  addWorktree(a, path.join(area, 'wt'), 'feat/x');
  fs.writeFileSync(path.join(area, 'wt', 'new.txt'), 'dirty');
  const repos = await discoverRepos([area], { maxDepth: 3 });
  const cards = await createBranchCollector().collect(repos, { budget: 8 });
  assert.equal(cards.length, 1); // main worktree on default branch excluded
  const card = cards[0];
  assert.equal(card.branch, 'feat/x');
  assert.equal(card.dirtyFiles, 1);
  assert.equal(typeof card.lastCommitSubject, 'string');
});

test('budget staggers uncached worktrees', async () => {
  const area = makeArea();
  const a = makeRepo(area, 'app', { remote: null });
  addWorktree(a, path.join(area, 'w1'), 'feat/a');
  addWorktree(a, path.join(area, 'w2'), 'feat/b');
  const repos = await discoverRepos([area], { maxDepth: 3 });
  const collector = createBranchCollector();
  const first = await collector.collect(repos, { budget: 1 });
  // One worktree is over budget on this pass — its detail hasn't been fetched yet.
  assert.equal(first.filter((c) => c.lastCommitTs == null).length, 1);
  const second = await collector.collect(repos, { budget: 1 });
  assert.equal(second.filter((c) => c.lastCommitTs == null).length, 0); // cache filled over two calls
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { discoverRepos } from '../lib/scan.js';
import { makeArea, makeRepo, addWorktree } from './helpers/gitfix.js';

test('finds repos, classifies forge, and lists worktrees outside the roots', async () => {
  const area = makeArea();
  const outside = makeArea(); // NOT under the scanned root
  const a = makeRepo(area, 'app', { remote: 'git@github.com:me/app.git' });
  addWorktree(a, path.join(outside, 'wt-feat'), 'feat/x');
  makeRepo(area, 'lab', { remote: 'https://gitlab.com/me/lab.git' });
  fs.mkdirSync(path.join(area, 'node_modules', 'junk'), { recursive: true }); // must be pruned

  const repos = await discoverRepos([area], { maxDepth: 4 });
  const app = repos.find((r) => r.name === 'app');
  assert.equal(app.key, 'github.com/me/app');
  assert.equal(app.forge, 'github');
  assert.equal(app.defaultBranch, 'main');
  const branches = app.worktrees.map((w) => w.branch).sort();
  assert.deepEqual(branches, ['feat/x', 'main']);
  assert.equal(
    app.worktrees.some((w) => w.path === path.join(outside, 'wt-feat')),
    true,
  );
  assert.equal(repos.find((r) => r.name === 'lab').forge, 'gitlab');
});

test('a linked worktree under the root does not create a duplicate repo', async () => {
  const area = makeArea();
  const a = makeRepo(area, 'app', { remote: 'git@github.com:me/app.git' });
  fs.mkdirSync(path.join(area, '.worktrees'), { recursive: true });
  addWorktree(a, path.join(area, '.worktrees', 'feat-y'), 'feat/y');
  const repos = await discoverRepos([area], { maxDepth: 4 });
  assert.equal(repos.filter((r) => r.key === 'github.com/me/app').length, 1);
});

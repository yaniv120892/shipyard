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

test('M3: gitStats records real git-probe outcomes, including a broken .git dir', async () => {
  const area = makeArea();
  makeRepo(area, 'good', { remote: 'git@github.com:me/good.git' });
  // A directory that merely looks like a repo (has a `.git` entry) but isn't
  // one — `git worktree list --porcelain` fails inside it, same class of
  // failure a missing git binary or permission-broken repo would produce.
  fs.mkdirSync(path.join(area, 'broken', '.git'), { recursive: true });

  const gitStats = { calls: 0, failures: 0 };
  const repos = await discoverRepos([area], { maxDepth: 2, gitStats });

  assert.equal(repos.length, 1); // only 'good' is usable; 'broken' is skipped
  assert.equal(gitStats.calls, 2);
  assert.equal(gitStats.failures, 1);
});

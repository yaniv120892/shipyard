import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function makeArea() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shipyard-scan-')));
}

export function makeRepo(area, name, { remote } = {}) {
  const repo = path.join(area, name);
  fs.mkdirSync(repo, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: repo });
  git('init', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'README.md'), name);
  git('add', '.');
  git('commit', '-m', 'init');
  if (remote) git('remote', 'add', 'origin', remote);
  return { repo, git };
}

export function addWorktree({ git }, worktreePath, branch) {
  git('worktree', 'add', worktreePath, '-b', branch);
}

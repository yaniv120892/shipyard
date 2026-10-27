import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { repoKey } from './ids.js';

const SKIP = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
  'coverage',
  '.cache',
  '.terraform',
]);

// `stats`, when passed, is mutated in place with real call/failure counts — the
// wiring health.git (engine.js) uses to report actual git-subsystem outcomes
// instead of an unconditional { ok: true }.
export function gitP(args, cwd, stats) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (stats) {
        stats.calls += 1;
        if (err) {
          stats.failures += 1;
        }
      }
      resolve(err ? null : stdout.toString().trim());
    });
  });
}

function classifyForge(remoteUrl) {
  if (!remoteUrl) {
    return 'none';
  }
  if (remoteUrl.includes('github.com')) {
    return 'github';
  }
  if (remoteUrl.includes('gitlab')) {
    return 'gitlab';
  }
  return 'other';
}

function parseWorktrees(porcelain) {
  const worktrees = [];
  let current = null;
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice(9), branch: null };
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice(7).replace('refs/heads/', '');
    } else if (line === '' && current) {
      worktrees.push(current);
      current = null;
    }
  }
  if (current) {
    worktrees.push(current);
  }
  return worktrees;
}

async function walkForGitDirs(root, maxDepth) {
  const found = [];
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (existsSync(path.join(dir, '.git'))) {
      found.push(dir);
      continue;
    }
    if (depth >= maxDepth) {
      continue;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name)) {
        continue;
      }
      if (e.name.startsWith('.') && e.name !== '.worktrees') {
        continue;
      }
      queue.push({ dir: path.join(dir, e.name), depth: depth + 1 });
    }
  }
  return found;
}

export async function discoverRepos(roots, { maxDepth = 6, gitStats } = {}) {
  const gitDirs = (await Promise.all(roots.map((r) => walkForGitDirs(r, maxDepth)))).flat();
  const byMainPath = new Map();
  for (const dir of gitDirs) {
    // Only this call is tracked for health.git: it runs for every discovered
    // repo and fails on a missing git binary or a permission-broken repo,
    // unlike `remote get-url`/`symbolic-ref` below, which fail routinely for
    // ordinary remote-less repos and would make honest health noisy, not honest.
    const porcelain = await gitP(['worktree', 'list', '--porcelain'], dir, gitStats);
    if (!porcelain) {
      continue;
    }
    const worktrees = parseWorktrees(porcelain);
    const mainPath = worktrees[0]?.path;
    if (!mainPath || byMainPath.has(mainPath)) {
      // linked worktree of a known repo
      continue;
    }
    const remoteUrl = await gitP(['remote', 'get-url', 'origin'], mainPath);
    const head = await gitP(['symbolic-ref', 'refs/remotes/origin/HEAD'], mainPath);
    byMainPath.set(mainPath, {
      key: repoKey({ remoteUrl, mainPath }),
      name: path.basename(mainPath),
      mainPath,
      remoteUrl,
      forge: classifyForge(remoteUrl),
      defaultBranch: head ? head.replace('refs/remotes/origin/', '') : 'main',
      worktrees,
    });
  }
  return [...byMainPath.values()];
}

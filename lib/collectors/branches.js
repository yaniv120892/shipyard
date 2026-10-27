import fs from 'node:fs';
import path from 'node:path';
import { gitP } from '../scan.js';

function headMtime(worktreePath) {
  try {
    const gitPath = path.join(worktreePath, '.git');
    const stat = fs.statSync(gitPath);
    if (stat.isDirectory()) {
      return fs.statSync(path.join(gitPath, 'HEAD')).mtimeMs;
    }
    const gitdir = fs.readFileSync(gitPath, 'utf8').trim().replace('gitdir: ', '');
    return fs.statSync(path.join(gitdir, 'HEAD')).mtimeMs;
  } catch {
    return 0;
  }
}

async function fetchDetail(repo, wt) {
  const [status, log, counts] = await Promise.all([
    gitP(['status', '--porcelain'], wt.path),
    gitP(['log', '-1', '--format=%ct\t%s'], wt.path),
    gitP(['rev-list', '--left-right', '--count', `origin/${repo.defaultBranch}...HEAD`], wt.path),
  ]);
  const [behind, ahead] = counts ? counts.split('\t').map(Number) : [null, null];
  return {
    dirtyFiles: status === null ? null : status ? status.split('\n').length : 0,
    lastCommitTs: log ? Number(log.split('\t')[0]) * 1000 : null,
    lastCommitSubject: log ? log.split('\t').slice(1).join('\t') : null,
    aheadBehind: counts ? { ahead, behind } : null,
  };
}

export function createBranchCollector() {
  const cache = new Map(); // worktree path -> { key: headMtime, detail }
  return {
    async collect(repos, { budget = 8 } = {}) {
      const cards = [];
      let spent = 0;
      for (const repo of repos) {
        for (const wt of repo.worktrees) {
          if (!wt.branch || wt.branch === repo.defaultBranch) {
            continue;
          }
          const key = headMtime(wt.path);
          let cached = cache.get(wt.path);
          if ((!cached || cached.key !== key) && spent < budget) {
            cached = { key, detail: await fetchDetail(repo, wt) };
            cache.set(wt.path, cached);
            spent += 1;
          }
          cards.push({
            repoKey: repo.key,
            repoName: repo.name,
            branch: wt.branch,
            path: wt.path,
            ...(cached?.detail ?? {
              dirtyFiles: null,
              lastCommitTs: null,
              lastCommitSubject: null,
              aheadBehind: null,
            }),
          });
        }
      }
      return cards;
    },
  };
}

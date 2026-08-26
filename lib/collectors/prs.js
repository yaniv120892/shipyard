import { execFile } from 'node:child_process';

export function defaultExecFileP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15000, maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout) =>
      err ? reject(err) : resolve({ stdout: stdout.toString() }),
    );
  });
}

const FAIL_CONCLUSIONS = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED']);

function rollupChecks(rollup) {
  const checks = { pass: 0, fail: 0, pending: 0 };
  for (const c of rollup ?? []) {
    const concl = (c.conclusion ?? '').toUpperCase();
    if (concl === 'SUCCESS') checks.pass += 1;
    else if (FAIL_CONCLUSIONS.has(concl)) checks.fail += 1;
    else checks.pending += 1;
  }
  return checks;
}

export function createGhClient({ execFileP = defaultExecFileP } = {}) {
  const call = async (args, cwd) => {
    try {
      const { stdout } = await execFileP('gh', args, { cwd });
      return { ok: true, stdout };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  };
  return {
    async authStatus() {
      const r = await call(['auth', 'status']);
      return r.ok ? { ok: true } : { ok: false, reason: 'gh not authenticated' };
    },
    async listOpenPrs(repoPath) {
      const r = await call(
        [
          'pr',
          'list',
          '--author',
          '@me',
          '--state',
          'open',
          '--json',
          'number,title,url,headRefName,isDraft',
        ],
        repoPath,
      );
      if (!r.ok) return r;
      try {
        return { ok: true, prs: JSON.parse(r.stdout) };
      } catch (err) {
        return { ok: false, reason: err.message };
      }
    },
    async prDetail(repoPath, number) {
      const r = await call(
        [
          'pr',
          'view',
          String(number),
          '--json',
          'state,url,isDraft,reviewDecision,statusCheckRollup',
        ],
        repoPath,
      );
      if (!r.ok) return r;
      try {
        const raw = JSON.parse(r.stdout);
        return {
          ok: true,
          pr: {
            state: raw.state,
            url: raw.url,
            isDraft: raw.isDraft,
            reviewDecision: raw.reviewDecision ?? null,
            checks: rollupChecks(raw.statusCheckRollup),
            fetchedAt: Date.now(),
          },
        };
      } catch (err) {
        return { ok: false, reason: err.message };
      }
    },
    async prState(repoPath, number) {
      const r = await call(['pr', 'view', String(number), '--json', 'state,mergedAt'], repoPath);
      if (!r.ok) return r;
      try {
        const raw = JSON.parse(r.stdout);
        return { ok: true, state: raw.state, mergedAt: raw.mergedAt ?? null };
      } catch (err) {
        return { ok: false, reason: err.message };
      }
    },
  };
}

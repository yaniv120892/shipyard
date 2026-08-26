import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { discoverRepos as realDiscover } from './scan.js';
import { createShipCollector, listDocs, parseHistory, FAIL_LIMIT } from './collectors/ship.js';
import { createBranchCollector } from './collectors/branches.js';
import { createSessionCollector } from './collectors/sessions.js';
import { createGhClient } from './collectors/prs.js';
import { getProvider } from './tracker/provider.js';
import { buildFlows } from './merge.js';
import { runId } from './ids.js';
import { snapshotRun, resolveFates, prune, listArchived } from './archive.js';
import { isInside } from './security.js';
import { applyUserConfig } from './config.js';

const SHIPPED_ARCHIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function underRoot(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Archived ship runs whose worktree is gone still belong on the board (in the
// "shipped" group) as long as they were pinned within the last 7 days and aren't
// already represented by a live flow — this is what survives worktree deletion.
function archivedShipFlows(historyDir, liveRunIds) {
  const cutoff = Date.now() - SHIPPED_ARCHIVE_WINDOW_MS;
  const out = [];
  for (const entry of listArchived(historyDir)) {
    if (liveRunIds.has(entry.runId)) continue;
    const pinnedMs = Date.parse(entry.meta.pinnedAt ?? '');
    if (!Number.isFinite(pinnedMs) || pinnedMs < cutoff) continue;

    const shipDir = path.join(entry.dir, 'ship');
    let state = null;
    try {
      state = JSON.parse(fs.readFileSync(path.join(shipDir, 'state.json'), 'utf8'));
    } catch {
      /* archived state.json unreadable — still show the archived shell */
    }
    const lastActivityMs = Date.parse(entry.meta.mergedAt ?? entry.meta.pinnedAt ?? '');

    out.push({
      id: entry.runId,
      kind: 'ship',
      title: state?.slug ?? entry.meta.branch,
      repo: { key: entry.meta.repoKey, name: entry.meta.repoName },
      branch: entry.meta.branch,
      sources: ['ship'],
      state,
      timeline: parseHistory(state?.history),
      docs: listDocs(shipDir),
      worktree: null,
      pr: entry.meta.pr ?? null,
      task: null,
      session: null,
      lastActivityMs: Number.isFinite(lastActivityMs) ? lastActivityMs : null,
      broken: false,
      sameTicketAs: null,
      group: 'shipped',
      action: null,
      statusLine: entry.meta.fate ?? 'shipped',
      waitingSince: Number.isFinite(lastActivityMs) ? lastActivityMs : null,
    });
  }
  return out;
}

export function createEngine({ config, home = os.homedir(), setup = {}, deps = {} }) {
  const historyDir = path.join(home, '.claude', 'shipyard', 'history');
  fs.mkdirSync(historyDir, { recursive: true });
  const gh = deps.ghClient ?? createGhClient({});
  const tracker = deps.tracker ?? getProvider(config);
  const shipCollector = deps.shipCollector ?? createShipCollector();
  const branchCollector = deps.branchCollector ?? createBranchCollector();
  const sessionCollector = deps.sessionCollector ?? createSessionCollector();
  const discover = deps.discoverRepos ?? realDiscover;

  let repos = [],
    flows = [],
    watchers = [],
    timers = [];
  const health = {
    git: { ok: true },
    gh: { ok: false, reason: 'not checked yet' },
    linear: { ok: false, reason: 'not checked yet' },
  };
  const network = { prsByRepo: new Map(), prDetail: new Map(), tasks: [] };
  const shipSnapshotCache = new Map(); // shipDir -> lastActivityMs
  let scannedAt = 0;
  let debounceTimer = null;

  function shipRunsFrom(repos) {
    const runs = [];
    for (const repo of repos) {
      for (const wt of repo.worktrees) {
        const shipDir = path.join(wt.path, '.claude', 'ship');
        if (!fs.existsSync(path.join(shipDir, 'state.json'))) continue;
        const read = shipCollector.read(shipDir);
        const run = {
          repoKey: repo.key,
          repoName: repo.name,
          worktree: wt.path,
          branch: read.state?.branch ?? wt.branch,
          ...read,
        };
        // A cached (non-null) state that has failed to read FAIL_LIMIT times in a
        // row is permanently stale, not a transient torn write — flag it so the UI
        // doesn't silently keep showing it as ordinary last-known-good data.
        if (run.state != null && run.failCount >= FAIL_LIMIT) {
          run.degraded = [
            { source: 'ship', reason: 'state.json unreadable — showing last good state' },
          ];
        }
        runs.push(run);
        const id = runId({
          repoKey: run.repoKey,
          branch: run.branch,
          birthIso: run.birthIso ?? '',
        });
        if (shipSnapshotCache.get(shipDir) !== run.lastActivityMs) {
          shipSnapshotCache.set(shipDir, run.lastActivityMs);
          snapshotRun(
            {
              shipDir,
              runId: id,
              meta: {
                runId: id,
                repoKey: run.repoKey,
                repoName: run.repoName,
                branch: run.branch,
                birthIso: run.birthIso ?? '',
                repoPath: run.worktree,
                pr: run.state?.pr ?? null,
              },
            },
            historyDir,
          );
        }
      }
    }
    return runs;
  }

  async function assemble() {
    const shipRuns = shipRunsFrom(repos);
    const branchCards = await branchCollector.collect(repos);
    const sessions = sessionCollector.collect(path.join(home, '.claude', 'projects'));

    const prs = [];
    for (const [repoKey, entry] of network.prsByRepo) {
      for (const pr of entry.prs ?? []) {
        prs.push({
          ...pr,
          repoKey,
          repoPath: entry.repoPath,
          repoName: entry.repoName,
          detail: network.prDetail.get(`${repoKey}:${pr.number}`) ?? null,
        });
      }
    }

    const states = config.tracker?.states ?? [];
    const tasks = states.length
      ? network.tasks.filter((t) => states.includes(t.state))
      : network.tasks;

    flows = buildFlows({ shipRuns, branchCards, prs, tasks, sessions, now: Date.now(), config });

    for (const flow of flows) {
      const repo = repos.find((r) => r.key === flow.repo.key);
      if (repo?.forge === 'gitlab' && flow.pr == null) {
        flow.degraded = [{ source: 'gh', reason: 'PR state unavailable (GitLab)' }];
      }
    }

    const liveRunIds = new Set(flows.filter((f) => f.kind === 'ship').map((f) => f.id));
    flows.push(...archivedShipFlows(historyDir, liveRunIds));

    const bestSessionByRepo = new Map(); // repoKey -> {repo, session}
    for (const session of sessions) {
      const repo = repos.find((r) => r.worktrees.some((wt) => underRoot(wt.path, session.cwd)));
      if (!repo) continue;
      const existing = bestSessionByRepo.get(repo.key);
      if (!existing || session.lastActiveAt > existing.session.lastActiveAt) {
        bestSessionByRepo.set(repo.key, { repo, session });
      }
    }
    for (const { repo, session } of bestSessionByRepo.values()) {
      if (flows.some((f) => f.repo.key === repo.key)) continue;
      flows.push({
        id: `session:${repo.key}`,
        kind: 'session',
        title: repo.name,
        repo: { key: repo.key, name: repo.name },
        branch: null,
        sources: ['session'],
        state: null,
        timeline: [],
        docs: [],
        worktree: null,
        pr: null,
        task: null,
        session,
        lastActivityMs: session.lastActiveAt,
        broken: false,
        sameTicketAs: null,
        group: 'active',
        action: null,
        statusLine: 'session running, no tracked work',
        waitingSince: session.lastActiveAt,
      });
    }

    scannedAt = Date.now();
  }

  return {
    // Applies a saved Setup-panel partial to the running config in place, so
    // in-memory roots/tracker/etc. don't stay stale after a `/api/config` save,
    // then re-scans with the new roots.
    async updateConfig(savedUserKeys) {
      const { config: merged, missingRoots } = applyUserConfig(config, savedUserKeys, { home });
      Object.assign(config, merged);
      setup.missingRoots = missingRoots;
      setup.roots = config.roots;
      await this.refreshDiscovery();
    },
    async refreshDiscovery() {
      repos = await discover(config.roots, { maxDepth: config.maxDepth });
      setup.repoCount = repos.length;
      await this.fastTick();
      this.rewatch();
    },
    async fastTick() {
      await assemble();
    },
    async refreshNetwork() {
      const auth = await gh.authStatus();
      health.gh = auth.ok
        ? { ok: true, lastOkAt: Date.now() }
        : { ok: false, reason: auth.reason, lastOkAt: health.gh.lastOkAt };

      if (auth.ok) {
        for (const repo of repos) {
          if (repo.forge !== 'github') continue;
          const r = await gh.listOpenPrs(repo.mainPath);
          if (r.ok) {
            network.prsByRepo.set(repo.key, {
              prs: r.prs,
              repoPath: repo.mainPath,
              repoName: repo.name,
            });
            health.gh = { ok: true, lastOkAt: Date.now() };
          } else {
            health.gh = { ok: false, reason: r.reason, lastOkAt: health.gh.lastOkAt };
          }
        }
      }

      for (const flow of flows) {
        if (flow.action === 'merge' && flow.pr?.number != null) {
          const repoPath = flow.pr.repoPath ?? repos.find((r) => r.key === flow.repo.key)?.mainPath;
          if (!repoPath) continue;
          const r = await gh.prDetail(repoPath, flow.pr.number);
          if (r.ok) network.prDetail.set(`${flow.repo.key}:${flow.pr.number}`, r.pr);
        }
      }

      const trackerResult = await tracker.listMyOpenIssues(config.tracker);
      if (trackerResult.ok) {
        network.tasks = trackerResult.issues;
        health.linear = { ok: true, lastOkAt: Date.now() };
      } else {
        health.linear = {
          ok: false,
          reason: trackerResult.reason,
          lastOkAt: health.linear.lastOkAt,
        };
      }

      // Archived-shipped flows (added in assemble()) also carry kind 'ship' but have
      // no worktree — exclude them so resolveFates still resolves their fate.
      const liveRunIds = new Set(
        flows.filter((f) => f.kind === 'ship' && f.worktree != null).map((f) => f.id),
      );
      await resolveFates(historyDir, liveRunIds, gh);
      prune(historyDir, config.history);

      await assemble();
    },
    rewatch() {
      for (const w of watchers) w.close();
      watchers = [];
      const shipDirs = [];
      for (const repo of repos) {
        for (const wt of repo.worktrees) {
          const shipDir = path.join(wt.path, '.claude', 'ship');
          if (fs.existsSync(shipDir)) shipDirs.push(shipDir);
        }
      }
      for (const dir of shipDirs) {
        try {
          const watcher = fs.watch(dir, () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              this.fastTick();
            }, 250).unref();
          });
          watcher.unref();
          watchers.push(watcher);
        } catch {
          /* dir may vanish between check and watch */
        }
      }
    },
    start() {
      this.refreshDiscovery();
      this.refreshNetwork();
      timers.push(
        setInterval(
          () => {
            this.refreshDiscovery();
          },
          5 * 60 * 1000,
        ).unref(),
      );
      timers.push(
        setInterval(() => {
          this.fastTick();
        }, 5 * 1000).unref(),
      );
      timers.push(
        setInterval(
          () => {
            this.refreshNetwork();
          },
          (config.networkTtlSeconds ?? 90) * 1000,
        ).unref(),
      );
    },
    stop() {
      for (const t of timers) clearInterval(t);
      timers = [];
      clearTimeout(debounceTimer);
      debounceTimer = null;
      for (const w of watchers) w.close();
      watchers = [];
    },
    getSnapshot() {
      return { flows, health, scannedAt, setup };
    },
    async flowDetail(id) {
      const flow = flows.find((f) => f.id === id);
      if (!flow) return null;
      if (flow.pr && !flow.pr.detail) {
        const repoPath = flow.pr.repoPath ?? repos.find((r) => r.key === flow.repo.key)?.mainPath;
        if (repoPath) {
          const key = `${flow.repo.key}:${flow.pr.number}`;
          let detail = network.prDetail.get(key);
          if (!detail) {
            const r = await gh.prDetail(repoPath, flow.pr.number);
            if (r.ok) {
              detail = r.pr;
              network.prDetail.set(key, detail);
            }
          }
          if (detail) flow.pr.detail = detail;
        }
      }
      return flow;
    },
    docPath(flowId, rel) {
      const flow = flows.find((f) => f.id === flowId);
      const archiveDir = listArchived(historyDir).find((e) => e.runId === flowId)?.dir;
      const candidates = [];
      if (flow?.worktree) candidates.push({ root: flow.worktree, rel });
      if (archiveDir) {
        // Live docs live at `<worktree>/.claude/ship/<name>`; the archive mirrors
        // just the `ship/` subtree at `<archiveDir>/ship/<name>` — remap the prefix.
        const archiveRel = rel.startsWith('.claude/ship/')
          ? rel.replace('.claude/ship/', 'ship/')
          : rel;
        candidates.push({ root: archiveDir, rel: archiveRel });
      }
      for (const { root, rel: r } of candidates) {
        const abs = path.resolve(root, r);
        if (isInside(root, abs)) return abs;
      }
      return null;
    },
    openTarget(flowId, rel = '.') {
      return this.docPath(flowId, rel);
    },
    openInEditor(abs) {
      return new Promise((resolve) => execFile(config.openCommand, [abs], (err) => resolve(!err)));
    },
  };
}

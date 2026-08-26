import { runId, extractTicket } from './ids.js';

function ignored(flow, patterns) {
  for (const p of patterns ?? []) {
    const [repoPart, branchGlob] = p.split('#');
    if (flow.repo.key !== repoPart && flow.repo.name !== repoPart) continue;
    if (!branchGlob) return true;
    const re = new RegExp(
      '^' + branchGlob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    );
    if (flow.branch && re.test(flow.branch)) return true;
  }
  return false;
}

function taskMatchesBranch(task, branch, prTitle) {
  if (!branch && !prTitle) return false;
  const ticket = extractTicket(branch) ?? extractTicket(prTitle);
  if (ticket && ticket === task.identifier.toUpperCase()) return true;
  return task.branchName != null && task.branchName === branch;
}

export function buildFlows({ shipRuns, branchCards, prs, tasks, sessions, now, config }) {
  const flows = [];
  const claimedBranches = new Set(); // `${repoKey}\n${branch}`
  const bkey = (repoKey, branch) => `${repoKey}\n${branch}`;

  for (const run of shipRuns) {
    const flow = {
      id: runId({ repoKey: run.repoKey, branch: run.branch, birthIso: run.birthIso ?? '' }),
      kind: 'ship',
      title: run.state?.slug ?? run.branch,
      repo: { key: run.repoKey, name: run.repoName },
      branch: run.branch,
      sources: ['ship'],
      state: run.state,
      timeline: run.timeline,
      docs: run.docs,
      worktree: run.worktree,
      pr: null,
      task: null,
      session: null,
      lastActivityMs: run.lastActivityMs,
      broken: run.broken,
      sameTicketAs: null,
    };
    if (run.degraded) flow.degraded = run.degraded;
    claimedBranches.add(bkey(run.repoKey, run.branch));
    flows.push(flow);
  }

  for (const pr of prs) {
    const owner = flows.find(
      (f) =>
        f.kind === 'ship' &&
        f.repo.key === pr.repoKey &&
        (f.branch === pr.headRefName || f.state?.pr === pr.number),
    );
    if (owner) {
      owner.pr = pr;
      owner.sources.push('pr');
      claimedBranches.add(bkey(pr.repoKey, pr.headRefName));
      continue;
    }
    claimedBranches.add(bkey(pr.repoKey, pr.headRefName));
    flows.push({
      id: `pr:${pr.repoKey}#${pr.number}`,
      kind: 'pr',
      title: pr.title,
      repo: { key: pr.repoKey, name: pr.repoName ?? pr.repoKey.split('/').pop() },
      branch: pr.headRefName,
      sources: ['pr', 'branch'],
      state: null,
      timeline: [],
      docs: [],
      worktree: null,
      pr,
      task: null,
      session: null,
      lastActivityMs: null,
      broken: false,
      sameTicketAs: null,
    });
  }

  for (const card of branchCards) {
    const key = bkey(card.repoKey, card.branch);
    const owner = flows.find((f) => f.repo.key === card.repoKey && f.branch === card.branch);
    if (owner) {
      if (!owner.sources.includes('branch')) owner.sources.push('branch');
      owner.git = card;
      owner.worktree ??= card.path;
      owner.lastActivityMs =
        Math.max(owner.lastActivityMs ?? 0, card.lastCommitTs ?? 0) || owner.lastActivityMs;
      continue;
    }
    if (claimedBranches.has(key)) continue;
    flows.push({
      id: `branch:${card.repoKey}#${card.branch}`,
      kind: 'branch',
      title: card.branch,
      repo: { key: card.repoKey, name: card.repoName },
      branch: card.branch,
      sources: ['branch'],
      state: null,
      timeline: [],
      docs: [],
      worktree: card.path,
      git: card,
      pr: null,
      task: null,
      session: null,
      lastActivityMs: card.lastCommitTs,
      broken: false,
      sameTicketAs: null,
    });
  }

  for (const task of tasks) {
    const candidates = flows.filter(
      (f) => f.kind !== 'task' && taskMatchesBranch(task, f.branch, f.pr?.title),
    );
    const rank = (f) => (f.kind === 'ship' ? 3 : f.pr ? 2 : 1) * 1e15 + (f.lastActivityMs ?? 0);
    candidates.sort((a, b) => rank(b) - rank(a));
    // Find the first candidate without a task already attached
    const available = candidates.find((f) => f.task == null);
    if (available) {
      available.task = task;
      if (!available.sources.includes('task')) available.sources.push('task');
      // Mark all other candidates with this task's identifier
      for (const loser of candidates) {
        if (loser !== available && !loser.sameTicketAs) loser.sameTicketAs = task.identifier;
      }
    } else {
      flows.push({
        id: `task:${task.identifier}`,
        kind: 'task',
        title: task.title,
        repo: { key: null, name: null },
        branch: null,
        sources: ['task'],
        state: null,
        timeline: [],
        docs: [],
        worktree: null,
        pr: null,
        task,
        session: null,
        lastActivityMs: null,
        broken: false,
        sameTicketAs: null,
      });
    }
  }

  for (const session of sessions) {
    const owner = flows.find((f) => f.worktree === session.cwd);
    if (owner) {
      owner.session = session;
      owner.sources.push('session');
      owner.lastActivityMs = Math.max(owner.lastActivityMs ?? 0, session.lastActiveAt);
    }
    // Standalone session cards are created by the engine only for repos with no flows at all.
  }

  return flows.filter((f) => !ignored(f, config.ignore)).map((f) => classify(f, { now, config }));
}

const GATE_DOC = { scope: 'scope.md', plan: 'plan.md' };
const GATE_ACTION = { scope: 'answer-questions', plan: 'approve-plan' };
const AGENT_PHASES = new Set(['plan-approved', 'implement', 'polish', 'qa']);
const STALE_BRANCH_MS = 24 * 60 * 60 * 1000;

export function classify(flow, { now, config }) {
  const thresholdMs = (config.activityThresholdMinutes ?? 10) * 60_000;
  const recent = flow.lastActivityMs != null && now - flow.lastActivityMs < thresholdMs;
  const set = (group, action = null, statusLine = '') =>
    Object.assign(flow, {
      group,
      action,
      statusLine,
      waitingSince: flow.lastActivityMs ?? flow.git?.lastCommitTs ?? null,
    });

  if (flow.broken) return set('failing', null, 'state.json unreadable — check the run');

  if (flow.kind === 'ship') {
    const phase = flow.state?.phase;
    const qaFailed = flow.timeline.some(
      (t) => /fail/i.test(t.note ?? '') && (t.phase === 'qa' || /qa/i.test(t.note ?? '')),
    );
    if (phase === 'merged' || phase === 'verified') return set('shipped', null, phase);
    if (phase === 'ready-to-merge') return set('needsYou', 'merge', 'ready to merge');
    if (phase in GATE_DOC) {
      const gateReady = flow.docs.some((d) => d.name === GATE_DOC[phase]);
      if (gateReady && !recent)
        return set(
          'needsYou',
          GATE_ACTION[phase],
          `waiting: ${GATE_ACTION[phase].replace('-', ' ')}`,
        );
      return set('active', null, `agent working: ${phase}`);
    }
    if (AGENT_PHASES.has(phase)) {
      if (qaFailed && !recent) return set('failing', null, 'QA reported failure');
      if (recent) return set('active', null, `agent working: ${phase}`);
      return set('failing', null, `run stalled mid-${phase}`);
    }
    return set('active', null, phase ?? 'unknown phase');
  }

  if (flow.kind === 'pr') {
    const checks = flow.pr?.detail?.checks;
    if (checks && checks.fail > 0) return set('failing', null, `CI failing (${checks.fail})`);
    return set('active', null, 'open PR');
  }

  if (flow.kind === 'task') return set('notStarted', null, flow.task?.state ?? 'not started');

  // branch / session ambient cards
  const idleMs = now - (flow.lastActivityMs ?? 0);
  if (flow.lastActivityMs == null || idleMs > STALE_BRANCH_MS)
    return set('stale', null, 'no recent activity');
  return set('active', null, 'local work');
}

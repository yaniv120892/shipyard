import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlows } from '../lib/merge.js';

const NOW = Date.parse('2026-08-25T12:00:00Z');
const base = {
  shipRuns: [],
  branchCards: [],
  prs: [],
  tasks: [],
  sessions: [],
  now: NOW,
  config: { activityThresholdMinutes: 10, ignore: [] },
};

const shipRun = (over = {}) => ({
  repoKey: 'github.com/me/app',
  repoName: 'app',
  worktree: '/w/app-x',
  branch: 'feat/x',
  state: { slug: 'x', phase: 'implement', pr: null, request: 'r' },
  timeline: [{ phase: 'plan', at: '2026-08-25T10:00:00Z', note: null }],
  docs: [],
  lastActivityMs: NOW - 60_000,
  birthIso: '2026-08-25T10:00:00Z',
  broken: false,
  ...over,
});

test('ship run absorbs its branch card, PR, task, and session', () => {
  const flows = buildFlows({
    ...base,
    shipRuns: [shipRun()],
    branchCards: [
      {
        repoKey: 'github.com/me/app',
        repoName: 'app',
        branch: 'feat/x',
        path: '/w/app-x',
        dirtyFiles: 0,
        lastCommitTs: NOW,
        lastCommitSubject: 's',
        aheadBehind: null,
        pending: false,
      },
    ],
    prs: [
      {
        repoKey: 'github.com/me/app',
        repoPath: '/r/app',
        number: 5,
        headRefName: 'feat/x',
        title: 'feat: x',
        url: 'http://pr/5',
        isDraft: false,
      },
    ],
    tasks: [
      {
        identifier: 'YAN-9',
        title: 'do x',
        url: 'http://t/9',
        branchName: 'me/yan-9-x',
        state: 'In Progress',
        stateType: 'started',
      },
    ],
    sessions: [{ cwd: '/w/app-x', lastActiveAt: NOW - 30_000 }],
  });
  // Task YAN-9 does not match branch feat/x by ticket or branchName → stays standalone.
  assert.equal(flows.length, 2);
  const ship = flows.find((f) => f.kind === 'ship');
  assert.deepEqual(ship.sources.sort(), ['branch', 'pr', 'session', 'ship']);
  assert.equal(ship.pr.number, 5);
  assert.match(ship.id, /^[0-9a-f]{16}$/);
});

test('ticket in branch name joins the task; branchName is a secondary match', () => {
  const flows = buildFlows({
    ...base,
    branchCards: [
      {
        repoKey: 'k',
        repoName: 'app',
        branch: 'fix/yan-9-crash',
        path: '/w1',
        dirtyFiles: 0,
        lastCommitTs: NOW,
        lastCommitSubject: 's',
        aheadBehind: null,
        pending: false,
      },
    ],
    tasks: [
      {
        identifier: 'YAN-9',
        title: 'crash',
        url: 'u',
        branchName: 'me/other',
        state: 'Todo',
        stateType: 'unstarted',
      },
    ],
  });
  assert.equal(flows.length, 1);
  assert.deepEqual(flows[0].sources.sort(), ['branch', 'task']);
  assert.equal(flows[0].task.identifier, 'YAN-9');
});

test('multi-branch ticket tie-break prefers ship > pr > latest commit; losers get sameTicketAs', () => {
  const flows = buildFlows({
    ...base,
    shipRuns: [shipRun({ branch: 'feat/yan-9-real', worktree: '/w/real' })],
    branchCards: [
      {
        repoKey: 'github.com/me/app',
        repoName: 'app',
        branch: 'feat/yan-9-real',
        path: '/w/real',
        dirtyFiles: 0,
        lastCommitTs: NOW,
        lastCommitSubject: 's',
        aheadBehind: null,
        pending: false,
      },
      {
        repoKey: 'github.com/me/app',
        repoName: 'app',
        branch: 'old/yan-9-stale',
        path: '/w/stale',
        dirtyFiles: 0,
        lastCommitTs: NOW - 9e7,
        lastCommitSubject: 's',
        aheadBehind: null,
        pending: false,
      },
    ],
    tasks: [
      {
        identifier: 'YAN-9',
        title: 't',
        url: 'u',
        branchName: null,
        state: 'Todo',
        stateType: 'unstarted',
      },
    ],
  });
  const ship = flows.find((f) => f.kind === 'ship');
  assert.equal(ship.task.identifier, 'YAN-9');
  const stale = flows.find((f) => f.branch === 'old/yan-9-stale');
  assert.equal(stale.task, null);
  assert.equal(stale.sameTicketAs, 'YAN-9');
});

test('same branch name in two repos stays two flows', () => {
  const card = (repoKey, p) => ({
    repoKey,
    repoName: 'r',
    branch: 'feat/x',
    path: p,
    dirtyFiles: 0,
    lastCommitTs: NOW,
    lastCommitSubject: 's',
    aheadBehind: null,
    pending: false,
  });
  const flows = buildFlows({ ...base, branchCards: [card('k1', '/a'), card('k2', '/b')] });
  assert.equal(flows.length, 2);
});

test('two tasks matching same branch: first by ticket, second by branchName', () => {
  const flows = buildFlows({
    ...base,
    branchCards: [
      {
        repoKey: 'k',
        repoName: 'app',
        branch: 'fix/yan-9-crash',
        path: '/w1',
        dirtyFiles: 0,
        lastCommitTs: NOW,
        lastCommitSubject: 's',
        aheadBehind: null,
        pending: false,
      },
    ],
    tasks: [
      {
        identifier: 'YAN-9',
        title: 'crash',
        url: 'u1',
        branchName: null,
        state: 'Todo',
        stateType: 'unstarted',
      },
      {
        identifier: 'YAN-77',
        title: 'follow-up',
        url: 'u2',
        branchName: 'fix/yan-9-crash',
        state: 'Todo',
        stateType: 'unstarted',
      },
    ],
  });
  // Exactly 2 flows: branch flow and task flow
  assert.equal(flows.length, 2);
  // Branch flow should have T1 attached (first match wins)
  const branchFlow = flows.find((f) => f.kind === 'branch');
  assert.equal(branchFlow.task.identifier, 'YAN-9');
  // sources should contain 'task' exactly once
  assert.equal(branchFlow.sources.filter((s) => s === 'task').length, 1);
  // T2 should be a standalone task flow
  const taskFlow = flows.find((f) => f.kind === 'task');
  assert.equal(taskFlow.task.identifier, 'YAN-77');
  assert.equal(taskFlow.sources.length, 1);
  assert.equal(taskFlow.sources[0], 'task');
});

test('config.ignore silences repo and repo#branch globs', () => {
  const flows = buildFlows({
    ...base,
    config: { activityThresholdMinutes: 10, ignore: ['k1', 'k2#spike/*'] },
    branchCards: [
      {
        repoKey: 'k1',
        repoName: 'a',
        branch: 'feat/x',
        path: '/a',
        dirtyFiles: 0,
        lastCommitTs: NOW,
        lastCommitSubject: 's',
        aheadBehind: null,
        pending: false,
      },
      {
        repoKey: 'k2',
        repoName: 'b',
        branch: 'spike/z',
        path: '/b',
        dirtyFiles: 0,
        lastCommitTs: NOW,
        lastCommitSubject: 's',
        aheadBehind: null,
        pending: false,
      },
    ],
  });
  assert.equal(flows.length, 0);
});

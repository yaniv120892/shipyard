import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../lib/merge.js';

const NOW = Date.parse('2026-08-25T12:00:00Z');
const OPTS = { now: NOW, config: { activityThresholdMinutes: 10 } };
const RECENT = NOW - 5 * 60_000; // within threshold
const OLD = NOW - 60 * 60_000; // beyond threshold

function ship({ phase, docs = [], lastActivityMs, qaFailedNote = false }) {
  return {
    kind: 'ship',
    sources: ['ship'],
    branch: 'b',
    repo: { key: 'k', name: 'r' },
    state: { phase },
    docs: docs.map((name) => ({ name, rel: name, mtimeMs: OLD })),
    timeline: qaFailedNote ? [{ phase: 'qa', at: null, note: 'QA FAILED: login broken' }] : [],
    pr: null,
    task: null,
    session: null,
    lastActivityMs,
    broken: false,
  };
}

const CASES = [
  [
    ship({ phase: 'scope', docs: ['scope.md'], lastActivityMs: OLD }),
    'needsYou',
    'answer-questions',
  ],
  [ship({ phase: 'scope', lastActivityMs: RECENT }), 'active', null],
  // (b) — gate doc never showed up and the agent has gone quiet: the run died
  // before writing it, not "still working". Previously misclassified 'active'.
  [ship({ phase: 'scope', lastActivityMs: OLD }), 'failing', null],
  [ship({ phase: 'plan', docs: ['plan.md'], lastActivityMs: OLD }), 'needsYou', 'approve-plan'],
  [ship({ phase: 'plan', lastActivityMs: RECENT }), 'active', null],
  [ship({ phase: 'plan', lastActivityMs: OLD }), 'failing', null],
  [ship({ phase: 'implement', lastActivityMs: RECENT }), 'active', null],
  [ship({ phase: 'implement', lastActivityMs: OLD }), 'failing', null],
  [ship({ phase: 'qa', lastActivityMs: OLD, qaFailedNote: true }), 'failing', null],
  [ship({ phase: 'ready-to-merge', lastActivityMs: OLD }), 'needsYou', 'merge'],
  [ship({ phase: 'merged', lastActivityMs: OLD }), 'shipped', null],
  [ship({ phase: 'verified', lastActivityMs: OLD }), 'shipped', null],
];

for (const [flow, group, action] of CASES) {
  test(`ship phase=${flow.state.phase} activity=${flow.lastActivityMs === RECENT ? 'recent' : 'old'} → ${group}`, () => {
    const out = classify(flow, OPTS);
    assert.equal(out.group, group);
    assert.equal(out.action, action);
  });
}

test('(b) stalled gate phase reports "run stalled before <gate doc>"', () => {
  const scopeOut = classify(ship({ phase: 'scope', lastActivityMs: OLD }), OPTS);
  assert.equal(scopeOut.statusLine, 'run stalled before scope.md');
  const planOut = classify(ship({ phase: 'plan', lastActivityMs: OLD }), OPTS);
  assert.equal(planOut.statusLine, 'run stalled before plan.md');
});

test('L1: an innocent "0 failures" note is not read as a QA failure verdict', () => {
  const flow = ship({ phase: 'qa', lastActivityMs: OLD });
  flow.timeline = [{ phase: 'qa', at: null, note: 'qa: 0 failures' }];
  const out = classify(flow, OPTS);
  // Still failing (the run is stalled either way), but for the honest reason —
  // not misreported as a QA failure verdict it never gave.
  assert.equal(out.group, 'failing');
  assert.equal(out.statusLine, 'run stalled mid-qa');
});

test('L1: a genuine "QA FAILED" verdict is still reported as a QA failure', () => {
  const out = classify(ship({ phase: 'qa', lastActivityMs: OLD, qaFailedNote: true }), OPTS);
  assert.equal(out.group, 'failing');
  assert.equal(out.statusLine, 'QA reported failure');
});

test('broken state.json becomes a failing error card', () => {
  const out = classify(
    { ...ship({ phase: 'qa', lastActivityMs: OLD }), broken: true, state: null },
    OPTS,
  );
  assert.equal(out.group, 'failing');
  assert.match(out.statusLine, /state\.json/);
});

test('ambient PR with failing checks → failing; clean PR → active', () => {
  const pr = (checks) => ({
    kind: 'pr',
    sources: ['pr'],
    repo: { key: 'k', name: 'r' },
    branch: 'b',
    state: null,
    docs: [],
    timeline: [],
    task: null,
    session: null,
    pr: { number: 1, detail: { checks } },
    lastActivityMs: OLD,
    broken: false,
  });
  assert.equal(classify(pr({ pass: 4, fail: 1, pending: 0 }), OPTS).group, 'failing');
  assert.equal(classify(pr({ pass: 5, fail: 0, pending: 0 }), OPTS).group, 'active');
});

test('task → notStarted; idle branch → stale; recently-committed branch → active', () => {
  const task = {
    kind: 'task',
    sources: ['task'],
    repo: {},
    state: null,
    docs: [],
    timeline: [],
    pr: null,
    task: { identifier: 'YAN-1' },
    session: null,
    lastActivityMs: null,
    broken: false,
  };
  assert.equal(classify(task, OPTS).group, 'notStarted');
  const branch = (ts) => ({
    kind: 'branch',
    sources: ['branch'],
    repo: { key: 'k', name: 'r' },
    branch: 'spike/x',
    state: null,
    docs: [],
    timeline: [],
    pr: null,
    task: null,
    session: null,
    git: { lastCommitTs: ts, dirtyFiles: 0 },
    lastActivityMs: ts,
    broken: false,
  });
  assert.equal(classify(branch(NOW - 3 * 86_400_000), OPTS).group, 'stale');
  assert.equal(classify(branch(NOW - 60_000), OPTS).group, 'active');
});

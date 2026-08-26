import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { snapshotRun, listArchived, resolveFates, prune } from '../lib/archive.js';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shipyard-arch-'));
}

function makeShipDir() {
  const ship = path.join(tmp(), '.claude', 'ship');
  fs.mkdirSync(path.join(ship, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(ship, 'state.json'), '{"phase":"qa","pr":5}');
  fs.writeFileSync(path.join(ship, 'plan.md'), '# plan');
  return ship;
}

const META = {
  runId: 'aaaa000011112222',
  repoKey: 'k',
  repoName: 'r',
  branch: 'b',
  birthIso: '2026-08-25T10:00:00Z',
  repoPath: '/r',
  pr: 5,
};

test('snapshotRun mirrors the ship dir and pins meta once', () => {
  const history = tmp();
  const ship = makeShipDir();
  snapshotRun({ shipDir: ship, runId: META.runId, meta: META }, history);
  const entry = listArchived(history)[0];
  assert.equal(entry.runId, META.runId);
  assert.equal(fs.readFileSync(path.join(entry.dir, 'ship', 'plan.md'), 'utf8'), '# plan');
  const pinnedAt = entry.meta.pinnedAt;
  fs.writeFileSync(path.join(ship, 'plan.md'), '# plan v2');
  snapshotRun({ shipDir: ship, runId: META.runId, meta: { ...META, pr: null } }, history);
  const again = listArchived(history)[0];
  assert.equal(fs.readFileSync(path.join(again.dir, 'ship', 'plan.md'), 'utf8'), '# plan v2');
  assert.equal(again.meta.pr, 5); // never overwritten with null
  assert.equal(again.meta.pinnedAt, pinnedAt); // pinned once
});

test('resolveFates queries gh once for vanished runs and persists the verdict', async () => {
  const history = tmp();
  snapshotRun({ shipDir: makeShipDir(), runId: META.runId, meta: META }, history);
  let calls = 0;
  const gh = {
    prState: async () => {
      calls += 1;
      return { ok: true, state: 'MERGED', mergedAt: '2026-08-25T12:00:00Z' };
    },
  };
  await resolveFates(history, new Set(), gh);
  await resolveFates(history, new Set(), gh);
  assert.equal(calls, 1);
  assert.equal(listArchived(history)[0].meta.fate, 'merged');
});

test('resolveFates skips live runs', async () => {
  const history = tmp();
  snapshotRun({ shipDir: makeShipDir(), runId: META.runId, meta: META }, history);
  const gh = {
    prState: async () => {
      throw new Error('must not be called');
    },
  };
  await resolveFates(history, new Set([META.runId]), gh);
  assert.equal(listArchived(history)[0].meta.fate, undefined);
});

test('prune enforces maxEntries by pinnedAt age', () => {
  const history = tmp();
  for (let i = 0; i < 3; i++) {
    const id = `run${i}`.padEnd(16, '0');
    snapshotRun({ shipDir: makeShipDir(), runId: id, meta: { ...META, runId: id } }, history);
    const metaFile = path.join(history, id, 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    meta.pinnedAt = new Date(Date.parse('2026-08-01T00:00:00Z') + i * 86_400_000).toISOString();
    fs.writeFileSync(metaFile, JSON.stringify(meta));
  }
  prune(history, { maxEntries: 2, maxAgeDays: 365 });
  assert.equal(listArchived(history).length, 2);
  assert.equal(
    listArchived(history).some((e) => e.runId.startsWith('run0')),
    false,
  );
});

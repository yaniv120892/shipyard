import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseHistory, createShipCollector } from '../lib/collectors/ship.js';

function makeShipDir(state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipyard-ship-'));
  const ship = path.join(dir, '.claude', 'ship');
  fs.mkdirSync(path.join(ship, 'reports'), { recursive: true });
  fs.writeFileSync(
    path.join(ship, 'state.json'),
    typeof state === 'string' ? state : JSON.stringify(state),
  );
  return ship;
}

test('parseHistory handles objects, legacy strings, and mixed arrays', () => {
  const parsed = parseHistory([
    'scouted the code',
    { phase: 'plan', at: '2026-08-25T10:00:00Z' },
    { phase: 'implement', at: '2026-08-25T11:00:00Z', note: 'all green' },
  ]);
  assert.deepEqual(parsed, [
    { phase: null, at: null, note: 'scouted the code' },
    { phase: 'plan', at: '2026-08-25T10:00:00Z', note: null },
    { phase: 'implement', at: '2026-08-25T11:00:00Z', note: 'all green' },
  ]);
  assert.deepEqual(parseHistory(undefined), []);
});

test('read returns state, docs, and birth from first timestamped entry', () => {
  const ship = makeShipDir({
    slug: 's',
    branch: 'feat/s',
    phase: 'implement',
    history: [{ phase: 'plan', at: '2026-08-25T10:00:00Z' }],
  });
  fs.writeFileSync(path.join(ship, 'plan.md'), '# plan');
  fs.writeFileSync(path.join(ship, 'reports', 'scout.md'), 'r');
  const out = createShipCollector().read(ship);
  assert.equal(out.state.phase, 'implement');
  assert.equal(out.birthIso, '2026-08-25T10:00:00Z');
  const names = out.docs.map((d) => d.name).sort();
  assert.deepEqual(names, ['plan.md', 'reports/scout.md']);
  assert.equal(out.lastActivityMs > 0, true);
  assert.equal(out.broken, false);
});

test('doc rel paths point under .claude/ship/, not the bare name (H1)', () => {
  const ship = makeShipDir({ slug: 's', branch: 'feat/s', phase: 'plan', history: [] });
  fs.writeFileSync(path.join(ship, 'plan.md'), '# plan');
  fs.writeFileSync(path.join(ship, 'reports', 'scout.md'), 'r');
  const out = createShipCollector().read(ship);
  const byName = Object.fromEntries(out.docs.map((d) => [d.name, d.rel]));
  assert.equal(byName['plan.md'], '.claude/ship/plan.md');
  assert.equal(byName['reports/scout.md'], '.claude/ship/reports/scout.md');
});

test('torn writes serve last-known-good; broken only after 3 straight failures', () => {
  const collector = createShipCollector();
  const ship = makeShipDir({ slug: 's', branch: 'b', phase: 'qa', history: [] });
  assert.equal(collector.read(ship).state.phase, 'qa');
  fs.writeFileSync(path.join(ship, 'state.json'), '{"slug": "s", "pha'); // torn
  for (let i = 1; i <= 2; i++) {
    const out = collector.read(ship);
    assert.equal(out.state.phase, 'qa'); // cached
    assert.equal(out.failCount, i);
    assert.equal(out.broken, false);
  }
  assert.equal(collector.read(ship).failCount, 3);
  const never = createShipCollector(); // no cache to fall back on
  never.read(ship);
  never.read(ship);
  assert.equal(never.read(ship).broken, true);
});

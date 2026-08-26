import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSessionCollector } from '../lib/collectors/sessions.js';

test('maps project dirs to real cwd via first transcript line, mtime as activity', () => {
  const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'shipyard-sess-'));
  const p = path.join(projects, '-home-u-my-repo');
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(
    path.join(p, 'a.jsonl'),
    JSON.stringify({ cwd: '/home/u/my-repo', type: 'x' }) + '\n' + '{"more":"lines"}\n',
  );
  const out = createSessionCollector().collect(projects);
  assert.equal(out.length, 1);
  assert.equal(out[0].cwd, '/home/u/my-repo');
  assert.equal(typeof out[0].lastActiveAt, 'number');
});

test('a dir with unreadable first line is skipped, not fatal', () => {
  const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'shipyard-sess-'));
  const p = path.join(projects, 'bad');
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, 'a.jsonl'), 'not json\n');
  assert.deepEqual(createSessionCollector().collect(projects), []);
});

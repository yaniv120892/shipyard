import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const packageJson = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipyard-prepare-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function runPrepare(t, binDir) {
  const cwd = makeTempDir(t);
  const PATH = binDir ? `${binDir}:/usr/bin:/bin` : '/usr/bin:/bin';
  return run('sh', ['-c', packageJson.scripts.prepare], { cwd, env: { PATH } });
}

// The README installs with a bare `npm link`, which runs `prepare` without devDependencies.
test('prepare succeeds when husky is not installed', async (t) => {
  await assert.doesNotReject(runPrepare(t));
});

test('prepare surfaces a husky failure when husky is installed', async (t) => {
  const binDir = makeTempDir(t);
  fs.writeFileSync(path.join(binDir, 'husky'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await assert.rejects(runPrepare(t, binDir));
});

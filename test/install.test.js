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

// The README installs with a bare `npm link`, which runs `prepare` without devDependencies.
test('prepare succeeds when husky is not installed', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shipyard-prepare-'));
  await assert.doesNotReject(
    run('sh', ['-c', packageJson.scripts.prepare], { cwd, env: { PATH: '/usr/bin:/bin' } }),
  );
});

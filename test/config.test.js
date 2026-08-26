import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULTS, loadConfig, saveUserConfig, applyUserConfig } from '../lib/config.js';

function fakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shipyard-home-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  return home;
}

test('loadConfig with no file bootstraps defaults and flags created', () => {
  const home = fakeHome();
  fs.mkdirSync(path.join(home, 'Develop'));
  const { config, created, missingRoots } = loadConfig({ home });
  assert.equal(created, true);
  assert.deepEqual(config.roots, [path.join(home, 'Develop')]);
  assert.equal(missingRoots.length >= 1, true); // e.g. ~/dev did not exist
  assert.equal(config.port, DEFAULTS.port);
});

test('loadConfig merges file over defaults and reports missing roots', () => {
  const home = fakeHome();
  fs.mkdirSync(path.join(home, 'code'));
  fs.writeFileSync(
    path.join(home, '.claude', 'shipyard.config.json'),
    JSON.stringify({ roots: ['~/code', '~/gone'], openCommand: 'code' }),
  );
  const { config, created, missingRoots } = loadConfig({ home });
  assert.equal(created, false);
  assert.deepEqual(config.roots, [path.join(home, 'code')]);
  assert.deepEqual(missingRoots, ['~/gone']);
  assert.equal(config.openCommand, 'code');
});

test('loadConfig on corrupt JSON reports configError instead of pretending first run (M2)', () => {
  const home = fakeHome();
  fs.mkdirSync(path.join(home, 'code'));
  fs.writeFileSync(
    path.join(home, '.claude', 'shipyard.config.json'),
    '{ "roots": ["~/code"], INVALID JSON HERE !!!',
  );
  const { config, created, missingRoots, configError } = loadConfig({ home });
  assert.equal(created, false);
  assert.notEqual(configError, null);
  assert.match(configError, /JSON/);
  // still falls back to usable (default) roots rather than crashing or losing
  // the session, using whichever DEFAULTS.roots actually exist on disk
  assert.deepEqual(config.roots, [path.join(home, 'code')]);
  assert.deepEqual(
    missingRoots,
    DEFAULTS.roots.filter((r) => r !== '~/code'),
  );
});

test('loadConfig with no file has no configError', () => {
  const home = fakeHome();
  const { created, configError } = loadConfig({ home });
  assert.equal(created, true);
  assert.equal(configError, null);
});

test('applyUserConfig merges a saved partial into a live config, expanding roots (H2)', () => {
  const home = fakeHome();
  fs.mkdirSync(path.join(home, 'areaB'));
  const config = { ...DEFAULTS, roots: ['/somewhere/areaA'] };
  const { config: next, missingRoots } = applyUserConfig(
    config,
    { roots: ['~/areaB', '~/gone'] },
    { home },
  );
  assert.deepEqual(next.roots, [path.join(home, 'areaB')]);
  assert.deepEqual(missingRoots, ['~/gone']);
  assert.equal(config.roots[0], '/somewhere/areaA'); // input left untouched
});

test('saveUserConfig writes only allow-listed keys', () => {
  const home = fakeHome();
  saveUserConfig(
    {
      roots: ['~/x'],
      openCommand: 'bash',
      port: 9999,
      tracker: { provider: 'linear', workspace: 'w' },
    },
    { home },
  );
  const onDisk = JSON.parse(
    fs.readFileSync(path.join(home, '.claude', 'shipyard.config.json'), 'utf8'),
  );
  assert.deepEqual(onDisk.roots, ['~/x']);
  assert.equal(onDisk.tracker.workspace, 'w');
  assert.equal('openCommand' in onDisk, false);
  assert.equal('port' in onDisk, false);
});

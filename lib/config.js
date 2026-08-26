import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULTS = Object.freeze({
  port: 4111,
  roots: ['~/Develop', '~/dev', '~/Projects', '~/code'],
  maxDepth: 6,
  activityThresholdMinutes: 10,
  networkTtlSeconds: 90,
  openCommand: 'cursor',
  ignore: [],
  history: { maxEntries: 200, maxAgeDays: 90 },
  tracker: {
    provider: 'linear',
    workspace: 'yaniv-daye-personal',
    teams: [],
    projects: [],
    states: [],
    cap: 50,
  },
});

export const USER_EDITABLE = [
  'roots',
  'ignore',
  'tracker',
  'activityThresholdMinutes',
  'networkTtlSeconds',
  'history',
];

export function configPath(home) {
  return path.join(home, '.claude', 'shipyard.config.json');
}

function expandHome(p, home) {
  return p.startsWith('~') ? path.join(home, p.slice(1)) : p;
}

export function loadConfig({ home = os.homedir() } = {}) {
  const file = configPath(home);
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* absent or invalid: bootstrap */
  }
  const created = raw === null;
  const config = {
    ...DEFAULTS,
    ...raw,
    history: { ...DEFAULTS.history, ...raw?.history },
    tracker: { ...DEFAULTS.tracker, ...raw?.tracker },
  };
  const missingRoots = [];
  config.roots = (raw?.roots ?? DEFAULTS.roots)
    .filter((r) => {
      const abs = expandHome(r, home);
      if (fs.existsSync(abs)) return true;
      missingRoots.push(r);
      return false;
    })
    .map((r) => expandHome(r, home));
  return { config, path: file, created, missingRoots };
}

export function saveUserConfig(partial, { home = os.homedir() } = {}) {
  const file = configPath(home);
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* first save */
  }
  for (const key of USER_EDITABLE) {
    if (key in partial) existing[key] = partial[key];
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(existing, null, 2) + '\n');
  return existing;
}

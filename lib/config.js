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

// Shared by loadConfig (whole file) and applyUserConfig (a saved partial): expand
// `~` and drop roots that don't exist on disk, reporting which ones were dropped.
function resolveRoots(rawRoots, home) {
  const missingRoots = [];
  const roots = (rawRoots ?? DEFAULTS.roots)
    .filter((r) => {
      const abs = expandHome(r, home);
      if (fs.existsSync(abs)) return true;
      missingRoots.push(r);
      return false;
    })
    .map((r) => expandHome(r, home));
  return { roots, missingRoots };
}

export function loadConfig({ home = os.homedir() } = {}) {
  const file = configPath(home);
  let raw = null;
  let configError = null;
  let existed = true;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      existed = false; // genuinely first run
    } else {
      configError = err.message; // file is there but broken — do not mistake for first run
    }
  }
  const created = !existed;
  const config = {
    ...DEFAULTS,
    ...raw,
    history: { ...DEFAULTS.history, ...raw?.history },
    tracker: { ...DEFAULTS.tracker, ...raw?.tracker },
  };
  const { roots, missingRoots } = resolveRoots(raw?.roots, home);
  config.roots = roots;
  return { config, path: file, created, missingRoots, configError };
}

// Merges a saved user-editable partial (as returned by saveUserConfig) into a live
// config object, applying the same root expansion/filtering as loadConfig — so the
// running engine can pick up a Setup-panel save without duplicating that logic.
export function applyUserConfig(config, partial, { home = os.homedir() } = {}) {
  const next = { ...config };
  let missingRoots = [];
  for (const key of USER_EDITABLE) {
    if (!(key in partial)) continue;
    if (key === 'roots') {
      const resolved = resolveRoots(partial.roots, home);
      next.roots = resolved.roots;
      missingRoots = resolved.missingRoots;
    } else if (key === 'history') {
      next.history = { ...DEFAULTS.history, ...partial.history };
    } else if (key === 'tracker') {
      next.tracker = { ...DEFAULTS.tracker, ...partial.tracker };
    } else {
      next[key] = partial[key];
    }
  }
  return { config: next, missingRoots };
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

import fs from 'node:fs';
import path from 'node:path';

const DOC_NAMES = ['scope.md', 'plan.md', 'proof-of-work.md'];
export const FAIL_LIMIT = 3;

export function parseHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }
  return history.map((entry) =>
    typeof entry === 'string'
      ? { phase: null, at: null, note: entry }
      : { phase: entry.phase ?? null, at: entry.at ?? null, note: entry.note ?? null },
  );
}

// `rel` is resolved against the flow's worktree root by engine.docPath, so it must
// include the `.claude/ship/` segment that real /ship docs actually live under —
// `name` stays the bare display name shown in the UI.
export function listDocs(shipDir) {
  const docs = [];
  const push = (name, file) => {
    try {
      const st = fs.statSync(file);
      docs.push({ name, rel: `.claude/ship/${name}`, mtimeMs: st.mtimeMs });
    } catch {
      /* absent */
    }
  };
  for (const name of DOC_NAMES) {
    push(name, path.join(shipDir, name));
  }
  try {
    for (const f of fs.readdirSync(path.join(shipDir, 'reports'))) {
      if (f.endsWith('.md')) {
        push(`reports/${f}`, path.join(shipDir, 'reports', f));
      }
    }
  } catch {
    /* no reports yet */
  }
  return docs;
}

export function createShipCollector() {
  const cache = new Map(); // shipDir -> { state, failCount }
  return {
    read(shipDir) {
      const stateFile = path.join(shipDir, 'state.json');
      const entry = cache.get(shipDir) ?? { state: null, failCount: 0 };
      let stateStat = null;
      try {
        stateStat = fs.statSync(stateFile);
        entry.state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        entry.failCount = 0;
      } catch {
        entry.failCount += 1;
      }
      cache.set(shipDir, entry);
      const timeline = parseHistory(entry.state?.history);
      const docs = listDocs(shipDir);
      const mtimes = docs.map((d) => d.mtimeMs);
      if (stateStat) {
        mtimes.push(stateStat.mtimeMs);
      }
      return {
        state: entry.state,
        timeline,
        docs,
        lastActivityMs: mtimes.length ? Math.max(...mtimes) : null,
        birthIso:
          timeline.find((t) => t.at)?.at ??
          (stateStat
            ? stateStat.birthtime.getTime() === 0
              ? stateStat.mtime.toISOString()
              : stateStat.birthtime.toISOString()
            : null),
        failCount: entry.failCount,
        broken: entry.state === null && entry.failCount >= FAIL_LIMIT,
      };
    },
  };
}

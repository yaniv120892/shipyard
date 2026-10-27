import fs from 'node:fs';
import path from 'node:path';

export function snapshotRun({ shipDir, runId, meta }, historyDir) {
  const dest = path.join(historyDir, runId);
  const staging = path.join(historyDir, `.tmp-${runId}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  fs.cpSync(shipDir, path.join(staging, 'ship'), { recursive: true });

  const metaFile = path.join(dest, 'meta.json');
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  } catch {
    /* first snapshot */
  }
  const merged = { ...existing };
  for (const [k, v] of Object.entries(meta)) {
    if (v != null && merged[k] == null) {
      merged[k] = v;
    }
  }
  merged.pinnedAt ??= new Date().toISOString();
  fs.writeFileSync(path.join(staging, 'meta.json'), JSON.stringify(merged, null, 2));

  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(staging, dest);
}

export function listArchived(historyDir) {
  let entries;
  try {
    entries = fs.readdirSync(historyDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.tmp-')) {
      continue;
    }
    const dir = path.join(historyDir, e.name);
    try {
      out.push({
        runId: e.name,
        dir,
        meta: JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')),
      });
    } catch {
      /* torn entry — skip */
    }
  }
  return out;
}

const FATE_BY_STATE = { MERGED: 'merged', CLOSED: 'abandoned' };

export async function resolveFates(historyDir, liveRunIds, ghClient) {
  for (const entry of listArchived(historyDir)) {
    if (
      liveRunIds.has(entry.runId) ||
      entry.meta.fate ||
      entry.meta.pr == null ||
      !entry.meta.repoPath
    ) {
      continue;
    }
    const r = await ghClient.prState(entry.meta.repoPath, entry.meta.pr);
    if (!r.ok) {
      // retry next cycle; never persist a guess
      continue;
    }
    entry.meta.fate = FATE_BY_STATE[r.state] ?? 'unknown';
    if (r.mergedAt) {
      entry.meta.mergedAt = r.mergedAt;
    }
    fs.writeFileSync(path.join(entry.dir, 'meta.json'), JSON.stringify(entry.meta, null, 2));
  }
}

export function prune(historyDir, { maxEntries, maxAgeDays }) {
  const entries = listArchived(historyDir).sort(
    (a, b) => Date.parse(b.meta.pinnedAt ?? 0) - Date.parse(a.meta.pinnedAt ?? 0),
  );
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  entries.forEach((entry, i) => {
    if (i >= maxEntries || Date.parse(entry.meta.pinnedAt ?? 0) < cutoff) {
      fs.rmSync(entry.dir, { recursive: true, force: true });
    }
  });
}

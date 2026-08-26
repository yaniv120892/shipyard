import fs from 'node:fs';
import path from 'node:path';

export function createSessionCollector() {
  const cwdCache = new Map(); // project dir -> cwd
  return {
    collect(projectsDir) {
      let dirs = [];
      try {
        dirs = fs.readdirSync(projectsDir, { withFileTypes: true });
      } catch {
        return [];
      }
      const out = [];
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const dir = path.join(projectsDir, d.name);
        let newest = null;
        try {
          for (const f of fs.readdirSync(dir)) {
            if (!f.endsWith('.jsonl')) continue;
            const st = fs.statSync(path.join(dir, f));
            if (!newest || st.mtimeMs > newest.mtimeMs)
              newest = { file: path.join(dir, f), mtimeMs: st.mtimeMs };
          }
        } catch {
          continue;
        }
        if (!newest) continue;
        let cwd = cwdCache.get(dir);
        if (!cwd) {
          try {
            const firstLine = fs.readFileSync(newest.file, 'utf8').split('\n', 1)[0];
            cwd = JSON.parse(firstLine).cwd;
            if (cwd) cwdCache.set(dir, cwd);
          } catch {
            continue;
          }
        }
        if (cwd) out.push({ cwd, lastActiveAt: newest.mtimeMs });
      }
      return out;
    },
  };
}

import fs from 'node:fs';
import { createServer, startServer } from '../server.js';
import { createToken } from '../lib/security.js';

export function buildDemoEngine() {
  const flows = JSON.parse(
    fs.readFileSync(new URL('../test/fixtures/demo-flows.json', import.meta.url), 'utf8'),
  );
  return {
    getSnapshot: () => ({
      flows,
      scannedAt: Date.now(),
      setup: {
        created: false,
        missingRoots: [],
        roots: ['~/Develop'],
        repoCount: new Set(flows.map((f) => f.repo?.key).filter(Boolean)).size,
      },
      health: {
        git: { ok: true, lastOkAt: Date.now() },
        gh: { ok: false, reason: 'demo' },
        linear: { ok: true, lastOkAt: Date.now() },
      },
    }),
    flowDetail: async (id) => flows.find((f) => f.id === id) ?? null,
    docPath: () => null,
    openTarget: () => null,
    openInEditor: async () => false,
    refreshNetwork: async () => {},
    // `server.js` calls these unconditionally from "Refresh now" and the
    // Setup-panel save route; demo mode has no filesystem/config to re-scan,
    // so both are no-ops rather than 500s.
    refreshDiscovery: async () => {},
    updateConfig: async () => {},
    start() {},
  };
}

// Standalone entrypoint: `node scripts/demo.js` boots the demo board on its own,
// without going through bin/shipyard's single-instance / config / open-browser logic.
if (process.argv[1] && new URL(process.argv[1], 'file:').href === import.meta.url) {
  const token = createToken();
  const engine = buildDemoEngine();
  const server = createServer({ token, version: 'demo', engine, config: { port: 0 } });
  const port = await startServer(server, 4111);
  console.log(`demo: http://127.0.0.1:${port}`);
}

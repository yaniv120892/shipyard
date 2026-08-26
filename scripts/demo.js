import fs from 'node:fs';
import { createServer, startServer } from '../server.js';
import { createToken } from '../lib/security.js';

const flows = JSON.parse(
  fs.readFileSync(new URL('../test/fixtures/demo-flows.json', import.meta.url), 'utf8'),
);
const engine = {
  getSnapshot: () => ({
    flows,
    scannedAt: Date.now(),
    setup: { created: false, missingRoots: [], roots: ['~/Develop'] },
    health: {
      git: { ok: true, lastOkAt: Date.now() },
      gh: { ok: false, reason: 'demo' },
      linear: { ok: true, lastOkAt: Date.now() },
    },
  }),
  flowDetail: (id) => flows.find((f) => f.id === id) ?? null,
  docPath: () => null,
  openTarget: () => null,
  openInEditor: async () => false,
  refreshNetwork: async () => {},
};
const token = createToken();
const server = createServer({ token, version: 'demo', engine, config: { port: 0 } });
const port = await startServer(server, 4111);
console.log(`demo: http://127.0.0.1:${port}`);

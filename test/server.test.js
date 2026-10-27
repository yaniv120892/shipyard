import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, startServer } from '../server.js';

export async function boot(extra = {}) {
  const token = 'test-token';
  const server = createServer({
    token,
    version: '0.1.0',
    engine: extra.engine ?? null,
    config: extra.config ?? {},
  });
  const port = await startServer(server, 0);
  const base = `http://127.0.0.1:${port}`;
  return { server, port, base, token, close: () => new Promise((r) => server.close(r)) };
}

test('GET /api/health reports name and version', async () => {
  const { base, close } = await boot();
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { name: 'shipyard', version: '0.1.0' });
  await close();
});

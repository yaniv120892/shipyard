import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { boot } from './server.test.js';

// fetch() cannot deliver a spoofed Host header: per the WHATWG Fetch spec, "host" is a
// forbidden request-header name and Node's undici silently overwrites it with the real
// connection target. http.request has no such restriction, so it's used here to actually
// exercise the Host guard against a non-local Host value.
function requestWithHost(url, host) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'GET',
        headers: { Host: host },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function stubEngine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipyard-doc-'));
  fs.writeFileSync(path.join(dir, 'plan.md'), '# p');
  return {
    dir,
    getSnapshot: () => ({ flows: [], health: {}, scannedAt: 1, setup: {} }),
    flowDetail: () => null,
    refreshNetwork: async () => {},
    docPath: (flow, rel) => (rel === 'plan.md' ? path.join(dir, 'plan.md') : null),
    openTarget: () => null,
  };
}

test('Host header outside localhost is rejected on every route', async () => {
  const { base, close } = await boot({ engine: stubEngine() });
  const res = await requestWithHost(`${base}/api/flows`, 'evil.example:4111');
  assert.equal(res.status, 403);
  await close();
});

test('non-GET without token is 403; with token passes', async () => {
  const { base, token, close } = await boot({ engine: stubEngine() });
  assert.equal((await fetch(`${base}/api/refresh`, { method: 'POST' })).status, 403);
  assert.equal(
    (
      await fetch(`${base}/api/refresh`, {
        method: 'POST',
        headers: { 'X-Shipyard-Token': token },
      })
    ).status,
    200,
  );
  await close();
});

test('doc endpoint serves only engine-approved paths', async () => {
  const { base, close } = await boot({ engine: stubEngine() });
  const ok = await fetch(`${base}/api/doc?flow=f&file=plan.md`);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).content, '# p');
  const bad = await fetch(`${base}/api/doc?flow=f&file=../../etc/passwd`);
  assert.equal(bad.status, 404);
  await close();
});

test('GET / injects the token, not the placeholder', async () => {
  const { base, token, close } = await boot({ engine: stubEngine() });
  const html = await (await fetch(base + '/')).text();
  assert.equal(html.includes('__TOKEN__'), false);
  assert.equal(html.includes(token), true);
  await close();
});

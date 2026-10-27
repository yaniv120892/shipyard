import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveUserConfig } from './lib/config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function hostAllowed(req, port) {
  const host = req.headers.host ?? '';
  return (
    host === `127.0.0.1:${port}` ||
    host === `localhost:${port}` ||
    host === '127.0.0.1' ||
    host === 'localhost'
  );
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
  }
  return data ? JSON.parse(data) : {};
}

export function createServer({ token, version, engine, config }) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      const port = server.address()?.port ?? config.port;
      if (!hostAllowed(req, port)) {
        return json(res, 403, { error: 'bad host' });
      }
      if (req.method !== 'GET' && req.headers['x-shipyard-token'] !== token) {
        return json(res, 403, { error: 'missing or bad token' });
      }

      if (req.method === 'GET' && url.pathname === '/') {
        const html = fs
          .readFileSync(path.join(HERE, 'public', 'index.html'), 'utf8')
          .replaceAll('__TOKEN__', token);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return json(res, 200, { name: 'shipyard', version });
      }
      if (req.method === 'GET' && url.pathname === '/api/flows') {
        return json(res, 200, engine.getSnapshot());
      }
      if (req.method === 'GET' && url.pathname === '/api/flow') {
        const flow = await engine.flowDetail(url.searchParams.get('id'));
        return flow ? json(res, 200, flow) : json(res, 404, { error: 'unknown flow' });
      }
      if (req.method === 'GET' && url.pathname === '/api/doc') {
        const abs = engine.docPath(
          url.searchParams.get('flow'),
          url.searchParams.get('file') ?? '',
        );
        if (!abs) {
          return json(res, 404, { error: 'not found' });
        }
        return json(res, 200, { file: abs, content: fs.readFileSync(abs, 'utf8') });
      }
      if (req.method === 'POST' && url.pathname === '/api/open') {
        const body = await readBody(req);
        const abs = engine.openTarget(body.flow, body.file ?? '.');
        if (!abs) {
          return json(res, 404, { error: 'not found' });
        }
        return json(res, 200, { opened: abs, ok: await engine.openInEditor(abs) });
      }
      if (req.method === 'POST' && url.pathname === '/api/refresh') {
        // "Refresh now" should also pick up brand-new repos/worktrees, not just
        // poll gh/Linear on the existing set.
        await engine.refreshDiscovery();
        await engine.refreshNetwork();
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/config') {
        const saved = saveUserConfig(await readBody(req), {});
        await engine.updateConfig(saved);
        return json(res, 200, { saved });
      }
      json(res, 404, { error: 'not found' });
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });
  server.shipyard = { token, engine, config };
  return server;
}

export function startServer(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

export function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

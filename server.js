import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveUserConfig } from './lib/config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function hostAllowed(request, port) {
  const host = request.headers.host ?? '';
  return (
    host === `127.0.0.1:${port}` ||
    host === `localhost:${port}` ||
    host === '127.0.0.1' ||
    host === 'localhost'
  );
}

async function readBody(request) {
  let data = '';
  for await (const chunk of request) {
    data += chunk;
  }
  return data ? JSON.parse(data) : {};
}

export function createServer({ token, version, engine, config }) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    try {
      const port = server.address()?.port ?? config.port;
      if (!hostAllowed(request, port)) {
        return json(response, 403, { error: 'bad host' });
      }
      if (request.method !== 'GET' && request.headers['x-shipyard-token'] !== token) {
        return json(response, 403, { error: 'missing or bad token' });
      }

      if (request.method === 'GET' && url.pathname === '/') {
        const html = fs
          .readFileSync(path.join(HERE, 'public', 'index.html'), 'utf8')
          .replaceAll('__TOKEN__', token);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return response.end(html);
      }
      if (request.method === 'GET' && url.pathname === '/api/health') {
        return json(response, 200, { name: 'shipyard', version });
      }
      if (request.method === 'GET' && url.pathname === '/api/flows') {
        return json(response, 200, engine.getSnapshot());
      }
      if (request.method === 'GET' && url.pathname === '/api/flow') {
        const flow = await engine.flowDetail(url.searchParams.get('id'));
        return flow ? json(response, 200, flow) : json(response, 404, { error: 'unknown flow' });
      }
      if (request.method === 'GET' && url.pathname === '/api/doc') {
        const abs = engine.docPath(
          url.searchParams.get('flow'),
          url.searchParams.get('file') ?? '',
        );
        if (!abs) {
          return json(response, 404, { error: 'not found' });
        }
        return json(response, 200, { file: abs, content: fs.readFileSync(abs, 'utf8') });
      }
      if (request.method === 'POST' && url.pathname === '/api/open') {
        const body = await readBody(request);
        const abs = engine.openTarget(body.flow, body.file ?? '.');
        if (!abs) {
          return json(response, 404, { error: 'not found' });
        }
        return json(response, 200, { opened: abs, ok: await engine.openInEditor(abs) });
      }
      if (request.method === 'POST' && url.pathname === '/api/refresh') {
        // "Refresh now" should also pick up brand-new repos/worktrees, not just
        // poll gh/Linear on the existing set.
        await engine.refreshDiscovery();
        await engine.refreshNetwork();
        return json(response, 200, { ok: true });
      }
      if (request.method === 'POST' && url.pathname === '/api/config') {
        const saved = saveUserConfig(await readBody(request), {});
        await engine.updateConfig(saved);
        return json(response, 200, { saved });
      }
      json(response, 404, { error: 'not found' });
    } catch (err) {
      json(response, 500, { error: err.message });
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

export function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

import crypto from 'node:crypto';

export function normalizeRemoteUrl(url) {
  if (!url) return null;
  let u = url.trim().replace(/\.git\/?$/i, '');
  if (/^https?:\/\//i.test(u)) {
    const parsed = new URL(u);
    u = `${parsed.hostname}/${parsed.pathname.replace(/^\/+|\/+$/g, '')}`;
  } else {
    const m = u.match(/^(?:ssh:\/\/)?(?:[\w.-]+@)?([\w.-]+)[:/](.+)$/);
    if (m) u = `${m[1]}/${m[2].replace(/^\/+|\/+$/g, '')}`;
  }
  return u.toLowerCase();
}

export function repoKey({ remoteUrl, mainPath }) {
  return normalizeRemoteUrl(remoteUrl) ?? `path:${mainPath}`;
}

export function runId({ repoKey, branch, birthIso }) {
  return crypto
    .createHash('sha256')
    .update(`${repoKey}\n${branch}\n${birthIso}`)
    .digest('hex')
    .slice(0, 16);
}

const TICKET_RE = /\b([A-Za-z][A-Za-z0-9]+-\d+)\b/;

export function extractTicket(text) {
  const m = TICKET_RE.exec(text ?? '');
  return m ? m[1].toUpperCase() : null;
}

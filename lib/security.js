import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function isInside(root, target) {
  let realRoot, realTarget;
  try {
    realRoot = fs.realpathSync(root);
    realTarget = fs.realpathSync(target);
  } catch {
    return false;
  }
  const rel = path.relative(realRoot, realTarget);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function createToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Plain subtree containment on path strings (no realpath resolution — used for
// matching against paths, like a session's `cwd`, that need not exist on disk).
// `target` matches when it equals `root` or is nested under it.
export function underRoot(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

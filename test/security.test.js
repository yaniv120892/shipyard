import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isInside, createToken } from '../lib/security.js';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shipyard-'));
}

test('isInside accepts contained paths and the root itself', () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, 'a'));
  fs.writeFileSync(path.join(root, 'a', 'f.md'), 'x');
  assert.equal(isInside(root, path.join(root, 'a', 'f.md')), true);
  assert.equal(isInside(root, root), true);
});

test('isInside rejects .. traversal, sibling-prefix dirs, and symlink escapes', () => {
  const root = tmpdir();
  const sibling = root + '-evil';
  fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(sibling, 'secret'), 'x');
  assert.equal(isInside(root, path.join(root, '..', path.basename(sibling), 'secret')), false);
  assert.equal(isInside(root, path.join(sibling, 'secret')), false);
  const outside = tmpdir();
  fs.writeFileSync(path.join(outside, 'target'), 'x');
  fs.symlinkSync(path.join(outside, 'target'), path.join(root, 'link'));
  assert.equal(isInside(root, path.join(root, 'link')), false);
});

test('isInside is false for nonexistent paths', () => {
  assert.equal(isInside(tmpdir(), '/no/such/path'), false);
});

test('createToken returns 48 hex chars, unique per call', () => {
  const t = createToken();
  assert.match(t, /^[0-9a-f]{48}$/);
  assert.notEqual(t, createToken());
});

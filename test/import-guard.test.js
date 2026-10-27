import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: new URL('..', import.meta.url).pathname });
const bareImport = "import x from 'lodash';\nexport default x;\n";

async function guardErrors(filePath) {
  const [result] = await eslint.lintText(bareImport, { filePath });
  return result.messages.filter((message) => message.ruleId === 'no-restricted-imports');
}

const runtimeFiles = [
  'server.js',
  'bin/shipyard',
  'lib/tracker/new.js',
  'scripts/new.js',
  'new-dir/new.js',
];

for (const filePath of runtimeFiles) {
  test(`runtime file ${filePath} may not import a package`, async () => {
    assert.equal((await guardErrors(filePath)).length, 1);
  });
}

test('tests may import packages', async () => {
  assert.equal((await guardErrors('test/new.test.js')).length, 0);
});

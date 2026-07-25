import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

test('package-lock contains an installable Electron package', async () => {
  const lockfile = JSON.parse(
    await readFile(new URL('../package-lock.json', import.meta.url), 'utf8')
  );
  const electron = lockfile.packages['node_modules/electron'];

  assert.equal(electron.version, '41.2.2');
  assert.equal(electron.link, undefined);
  assert.match(electron.resolved, /^https:\/\/registry\.npmjs\.org\//);
});

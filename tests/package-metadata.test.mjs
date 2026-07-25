import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

test('package metadata is sufficient for Linux package targets', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  );

  assert.equal(packageJson.name, 'savvy');
  assert.equal(packageJson.version, '0.0.1-alpha.1');
  assert.equal(packageJson.homepage, 'https://github.com/Alamonall/Savvy');
  assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
  assert.equal(packageJson.build.appId, 'com.alamonall.savvy');
  assert.equal(packageJson.build.productName, 'Savvy');
  assert.match(packageJson.build.linux.maintainer, /^Alamonall <[^>]+>$/);
});

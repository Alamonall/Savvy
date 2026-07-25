import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

test('package metadata is sufficient for Linux package targets', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  );

  assert.equal(packageJson.name, 'savvy');
  assert.equal(packageJson.homepage, 'https://github.com/Alamonall/Savvy');
  assert.equal(packageJson.version, '0.3.2');
  assert.equal(packageJson.build.appId, 'com.alamonall.savvy');
  assert.equal(packageJson.build.productName, 'Savvy');
  assert.match(packageJson.build.linux.maintainer, /^Alamonall <[^>]+>$/);
});

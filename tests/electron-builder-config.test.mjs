import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('electron-builder publishes mac update metadata to the nightly channel', () => {
  assert.equal(packageJson.build.artifactName, '${name}-${version}-${os}-${arch}.${ext}');

  assert.equal(packageJson.repository.type, 'git');
  assert.equal(packageJson.repository.url, 'git+ssh://git@github.com/Alamonall/Savvy.git');

  assert.deepEqual(packageJson.build.publish, [
    {
      provider: 'github',
      owner: 'Alamonall',
      repo: 'Savvy',
      channel: 'nightly',
      releaseType: 'prerelease'
    }
  ]);
});

test('mac release keeps the zip target required by electron-updater', () => {
  assert.deepEqual(packageJson.build.mac.target, ['dmg', 'zip']);
});

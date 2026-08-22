import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('electron-builder publishes mac update metadata to the alpha channel', () => {
  assert.equal(packageJson.build.artifactName, '${name}-${version}-${os}-${arch}.${ext}');

  assert.equal(packageJson.repository.type, 'git');
  assert.equal(packageJson.repository.url, 'git+ssh://git@github.com/Alamonall/Savvy.git');

  assert.deepEqual(packageJson.build.publish, [
    {
      provider: 'github',
      owner: 'Alamonall',
      repo: 'Savvy',
      channel: 'alpha',
      releaseType: 'prerelease'
    }
  ]);
});

test('mac release keeps the zip target required by electron-updater', () => {
  assert.deepEqual(packageJson.build.mac.target, ['dmg', 'zip']);
});

test('packaged application includes the downloaded yt-dlp binary', () => {
  assert.equal(packageJson.scripts['prepare:ytdlp'], 'node scripts/download-ytdlp.mjs');
  assert.match(packageJson.scripts.dist, /npm run prepare:ytdlp/);
  assert.match(packageJson.scripts['dist:linux'], /npm run prepare:ytdlp/);
  assert.match(packageJson.scripts['dist:mac'], /npm run prepare:ytdlp/);
  assert.match(packageJson.scripts['dist:windows'], /npm run prepare:ytdlp/);
  assert.match(packageJson.scripts.publish, /npm run prepare:ytdlp/);
  assert.match(packageJson.scripts['publish:mac'], /npm run prepare:ytdlp/);
  assert.deepEqual(packageJson.build.extraResources, [{ from: 'build/ytdlp', to: 'bin' }]);
});

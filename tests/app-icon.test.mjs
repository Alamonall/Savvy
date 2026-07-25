import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const iconPath = new URL('../src/renderer/public/savvy.png', import.meta.url);

test('application uses the circular Savvy icon everywhere', async () => {
  await access(iconPath);

  const rendererHtml = await readFile(
    new URL('../src/renderer/index.html', import.meta.url),
    'utf8'
  );
  const electronApplication = await readFile(
    new URL('../src/main/electron-application.ts', import.meta.url),
    'utf8'
  );
  const rendererMain = await readFile(
    new URL('../src/renderer/src/main.ts', import.meta.url),
    'utf8'
  );
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  );

  assert.match(rendererHtml, /savvy\.png/);
  assert.match(electronApplication, /savvy\.png/);
  assert.match(electronApplication, /dock\.setIcon/);
  assert.doesNotMatch(electronApplication, /savvy-pirate-dock\.png/);
  assert.match(rendererMain, /class="app-brand-icon"[^>]+savvy\.png/);
  assert.equal(packageJson.build.mac.icon, 'src/renderer/public/savvy.icns');
  await access(new URL('../src/renderer/public/savvy.icns', import.meta.url));
  assert.equal(packageJson.build.linux.icon, 'src/renderer/public/savvy.png');
  assert.equal(packageJson.build.win.icon, 'src/renderer/public/savvy.ico');
  await access(new URL('../src/renderer/public/savvy.ico', import.meta.url));
  assert.doesNotMatch(rendererHtml, /media-download\.svg/);
  assert.doesNotMatch(electronApplication, /media-download\.svg/);
});

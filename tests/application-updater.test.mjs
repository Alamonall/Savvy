import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const sharedTypes = await readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8');
const preload = await readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

test('приложение использует electron-updater и alpha-канал GitHub Releases', async () => {
  const updaterService = await readFile(
    new URL('../src/main/services/application-updater.service.ts', import.meta.url),
    'utf8'
  );
  const packageJsonText = await readFile(new URL('../package.json', import.meta.url), 'utf8');

  assert.equal(packageJson.dependencies['electron-updater'], '6.8.9');
  assert.match(packageJsonText, /channel": "alpha"/);
  assert.match(updaterService, /autoDownload = false/);
  assert.match(updaterService, /allowPrerelease = true/);
  assert.match(updaterService, /autoInstallOnAppQuit = false/);
  assert.match(updaterService, /quitAndInstall\(false, true\)/);
  assert.match(updaterService, /process\.platform === 'linux' && !process\.env\.APPIMAGE/);
});

test('IPC-контракт обновления передаёт состояние, скачивание и безопасную установку', () => {
  assert.match(sharedTypes, /export interface ApplicationUpdateState/);
  assert.match(sharedTypes, /getApplicationUpdate\(\): Promise<ApplicationUpdateState>/);
  assert.match(sharedTypes, /downloadApplicationUpdate\(\): Promise<void>/);
  assert.match(sharedTypes, /confirmedActiveDownloadCount: number/);
  assert.match(sharedTypes, /confirmedQueuedDownloadCount: number/);
  assert.match(preload, /application-update:get/);
  assert.match(preload, /application-update:download/);
  assert.match(preload, /application-update:install/);
});

test('интерфейс показывает кнопку обновления, прогресс, детали релиза и предупреждает о задачах', () => {
  assert.match(renderer, /data-application-update/);
  assert.match(renderer, /Скачать обновление/);
  assert.match(renderer, /Установить обновление/);
  assert.match(renderer, /applicationUpdate\.releaseNotes/);
  assert.match(renderer, /isInstallUpdateModalOpen/);
  assert.match(renderer, /Активные и ожидающие загрузки будут прерваны/);
  assert.match(renderer, /onApplicationUpdate/);
  assert.match(renderer, /Открыть релиз/);
  assert.match(styles, /\.application-update-tooltip/);
  assert.match(styles, /\[data-theme='dark'\] \.application-update/);
});

test('релизный workflow публикует metadata обновлений и использует signing secrets macOS', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8'
  );

  assert.match(workflow, /dist\/\*\.ya?ml/);
  assert.match(workflow, /CSC_LINK:/);
  assert.match(workflow, /CSC_KEY_PASSWORD:/);
  assert.match(workflow, /APPLE_ID:/);
  assert.match(workflow, /APPLE_APP_SPECIFIC_PASSWORD:/);
  assert.match(workflow, /APPLE_TEAM_ID:/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const sharedTypes = await readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8');
const preload = await readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const updaterService = await readFile(
  new URL('../src/main/services/application-updater.service.ts', import.meta.url),
  'utf8'
);
const updaterCapabilities = await readFile(
  new URL('../src/main/application-update-capabilities.ts', import.meta.url),
  'utf8'
);

test('приложение использует electron-updater и alpha-канал GitHub Releases', async () => {
  const packageJsonText = await readFile(new URL('../package.json', import.meta.url), 'utf8');

  assert.equal(packageJson.dependencies['electron-updater'], '6.8.9');
  assert.match(packageJsonText, /channel": "alpha"/);
  assert.match(updaterService, /autoDownload = false/);
  assert.match(updaterService, /allowPrerelease = true/);
  assert.match(updaterService, /quitAndInstall\(false, true\)/);
});

test('скачанное обновление ставится при выходе, а установка по кнопке остаётся с проверкой загрузок', () => {
  assert.match(updaterService, /autoInstallOnAppQuit = true/);
  assert.doesNotMatch(updaterService, /autoInstallOnAppQuit = false/);
  assert.match(updaterService, /counts\.active !== confirmedActiveDownloadCount/);
  assert.match(updaterService, /counts\.queued !== confirmedQueuedDownloadCount/);
});

test('Linux без AppImage и macOS без подписи требуют ручного скачивания', () => {
  assert.match(
    updaterService,
    /isManualDownloadRequired\(process\.platform, process\.env\.APPIMAGE\)/
  );
  assert.match(updaterCapabilities, /platform === 'linux' && !appImagePath/);
  assert.match(updaterCapabilities, /platform === 'darwin' && !MAC_AUTO_UPDATE_ENABLED/);
  assert.match(updaterCapabilities, /export const MAC_AUTO_UPDATE_ENABLED = false;/);
  assert.match(updaterCapabilities, /Developer ID/);
});

test('список изменений разбирается общей функцией, а не хранится как сырой текст', () => {
  assert.match(updaterService, /import \{ parseReleaseChanges \} from '\.\.\/release-changes';/);
  assert.match(updaterService, /changes: parseReleaseChanges\(info\.releaseNotes\)/);
  assert.match(updaterService, /changes: \[\],/);
  assert.doesNotMatch(updaterService, /releaseNotes:/);
});

test('фоновая проверка идёт по расписанию, не сбрасывает скачивание и не отвлекает ошибкой', () => {
  assert.match(updaterService, /const UPDATE_CHECK_INTERVAL_MS = 12 \* 60 \* 60 \* 1000;/);
  assert.match(updaterService, /this\.checkTimer = setInterval\(/);
  assert.match(updaterService, /UPDATE_CHECK_INTERVAL_MS\);\s*this\.checkTimer\.unref\(\);/);
  assert.match(updaterService, /private hasDownloadInProgressOrReady\(\): boolean/);
  assert.match(
    updaterService,
    /return this\.state\.status === 'downloading' \|\| this\.state\.status === 'downloaded';/
  );
  assert.match(updaterService, /private async checkForUpdatesSilently\(\)/);
});

test('ручная проверка доступна через check() и показывает ошибки пользователю', () => {
  assert.match(updaterService, /async check\(\): Promise<void>/);
  assert.match(updaterService, /Проверка обновлений доступна только в установленной сборке\./);
  assert.match(updaterService, /Не удалось проверить обновления: \$\{getErrorMessage\(error\)\}/);
  assert.match(preload, /application-update:check/);
  assert.match(sharedTypes, /checkApplicationUpdate\(\): Promise<void>/);
});

test('ошибка скачивания переводит состояние в error и разрешает повтор скачивания', () => {
  assert.match(updaterService, /private markDownloadFailed\(error: unknown\): void/);
  assert.match(updaterService, /status: 'error',\s*downloadPercent: null,/);
  assert.match(
    updaterService,
    /this\.state\.status !== 'available' && this\.state\.status !== 'error'/
  );
});

test('обновление не перетирает состояние скачивания при новом событии update-available', () => {
  assert.match(
    updaterService,
    /private handleUpdateAvailable\(info: UpdateInfo\): void \{\s*if \(this\.hasDownloadInProgressOrReady\(\)\) \{\s*return;/
  );
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

test('ошибка фоновой проверки не переводит идущее скачивание в состояние ошибки', async () => {
  const updaterService = await readFile(
    new URL('../src/main/services/application-updater.service.ts', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(updaterService, /isExplicitDownloadRequested/);
  assert.match(updaterService, /status === 'downloaded'/);
});

test('отказ установки переводит состояние в ошибку с понятным текстом', async () => {
  const updaterService = await readFile(
    new URL('../src/main/services/application-updater.service.ts', import.meta.url),
    'utf8'
  );

  assert.match(updaterService, /Не удалось установить обновление/);
  assert.match(
    updaterService,
    /updater\.on\('error', \(error\) => this\.handleUpdaterError\(error\)\)/
  );
});

test('скачивание дожидается выполняющейся проверки, чтобы не сменить цель updater', async () => {
  const updaterService = await readFile(
    new URL('../src/main/services/application-updater.service.ts', import.meta.url),
    'utf8'
  );

  assert.match(updaterService, /pendingCheck/);
  assert.match(updaterService, /await this\.pendingCheck/);
});

test('отзыв ранее найденного релиза сбрасывает состояние обновления', async () => {
  const updaterService = await readFile(
    new URL('../src/main/services/application-updater.service.ts', import.meta.url),
    'utf8'
  );

  assert.match(updaterService, /updater\.on\('update-not-available'/);
});

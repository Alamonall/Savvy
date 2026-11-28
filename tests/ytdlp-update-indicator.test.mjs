import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const { isYtdlpUpdateAvailable } = await import('../src/shared/ytdlp-version.ts');

const sharedTypes = await readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8');
const preload = await readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const binaryLocator = await readFile(
  new URL('../src/main/services/binary-locator.service.ts', import.meta.url),
  'utf8'
);
const electronApplication = await readFile(
  new URL('../src/main/electron-application.ts', import.meta.url),
  'utf8'
);
const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

test('isYtdlpUpdateAvailable корректно сравнивает версии yt-dlp', () => {
  assert.equal(isYtdlpUpdateAvailable('2026.11.20', '2026.11.23'), true);
  assert.equal(isYtdlpUpdateAvailable('v2026.11.20', '2026.11.23'), true);
  assert.equal(isYtdlpUpdateAvailable('2026.11.23', '2026.11.23.1'), true);
  assert.equal(isYtdlpUpdateAvailable('2026.11.23', '2026.11.23.232856'), true);

  assert.equal(isYtdlpUpdateAvailable('2026.11.23', '2026.11.23'), false);
  assert.equal(isYtdlpUpdateAvailable('2026.11.28', '2026.11.23'), false);
  assert.equal(isYtdlpUpdateAvailable('2026.11.23.1', '2026.11.23'), false);

  assert.equal(isYtdlpUpdateAvailable(null, '2026.11.23'), false);
  assert.equal(isYtdlpUpdateAvailable('2026.11.23', null), false);
  assert.equal(isYtdlpUpdateAvailable('preview', 'preview-latest'), false);
});

test('IPC и BinaryLocatorService передают прогресс обновления yt-dlp', () => {
  assert.match(
    sharedTypes,
    /export type YtdlpUpdateStage = 'idle' \| 'updating' \| 'done' \| 'error';/
  );
  assert.match(sharedTypes, /export interface YtdlpUpdateProgress/);
  assert.match(
    sharedTypes,
    /onYtdlpUpdateProgress\(callback: \(progress: YtdlpUpdateProgress\) => void\): \(\) => void;/
  );

  assert.match(preload, /onYtdlpUpdateProgress\(/);
  assert.match(preload, /'ytdlp-update:progress'/);

  assert.match(binaryLocator, /setUpdateProgressSender\(/);
  assert.match(binaryLocator, /binaryResponse\.body\?\.getReader\(\)/);
  assert.match(electronApplication, /setUpdateProgressSender\(/);
  assert.match(electronApplication, /'ytdlp-update:progress'/);
});

test('topbar показывает кнопку обновить с прогрессом при наличии новой версии yt-dlp', () => {
  assert.match(
    renderer,
    /<div class="topbar-actions">\s*\$\{renderYtdlpUpdateBadge\(\)\}\s*\$\{renderApplicationUpdateButton\(\)\}/
  );
  assert.match(renderer, /function renderYtdlpUpdateBadge\(\): string/);
  assert.match(
    renderer,
    /isYtdlpUpdateAvailable\(ytdlpBinaryInfo\.version,\s*ytdlpLatestReleaseVersion\)/
  );
  assert.match(renderer, /data-ytdlp-update\b/);
  assert.match(renderer, /data-ytdlp-stage="\$\{stage\}"/);
  assert.match(renderer, /class="ytdlp-update-action">\$\{escapeHtml\(actionLabel\)\}<\/span>/);
  assert.match(renderer, /'Обновить'/);
  assert.match(renderer, /Обновление \$\{percentValue\}%/);
  assert.match(renderer, /'Повторить'/);
  assert.match(renderer, /class="ytdlp-update-progress/);
  assert.match(renderer, /id="ytdlp-update-tooltip"/);
});

test('клик по кнопке обновить запускает обновление yt-dlp с отслеживанием прогресса', () => {
  assert.match(renderer, /querySelector<HTMLButtonElement>\('\[data-ytdlp-update\]'\)/);
  assert.match(renderer, /void startYtdlpUpdateFromMain\(\);/);
  assert.match(renderer, /window\.ytdlp\.onYtdlpUpdateProgress\(/);
});

test('при запуске выполняется фоновая проверка новой версии yt-dlp без ошибок в UI', () => {
  assert.match(renderer, /async function checkYtdlpLatestReleaseInBackground\(\): Promise<void>/);
  assert.match(renderer, /void checkYtdlpLatestReleaseInBackground\(\);/);
});

test('стили кнопки обновления yt-dlp и прогресса поддерживают светлую и тёмную темы', () => {
  assert.match(styles, /\.ytdlp-update\b/);
  assert.match(styles, /\.ytdlp-update-button\b/);
  assert.match(styles, /\.ytdlp-update-action\b/);
  assert.match(styles, /\.ytdlp-update-progress\b/);
  assert.match(styles, /\.ytdlp-update-tooltip\b/);
  assert.match(styles, /\[data-theme='dark'\] \.ytdlp-update-button\b/);
  assert.match(styles, /\[data-theme='dark'\] \.ytdlp-update-tooltip\b/);
});

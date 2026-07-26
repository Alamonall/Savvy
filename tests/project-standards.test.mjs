import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const workflow = await readFile(
  new URL('../.github/workflows/release.yml', import.meta.url),
  'utf8'
);
const ciWorkflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('проект требует Node.js 24 и использует его в CI', async () => {
  assert.equal(packageJson.engines.node, '>=24.0.0');
  assert.match(workflow, /node-version:\s*24/);
  assert.equal(await readFile(new URL('../.nvmrc', import.meta.url), 'utf8'), '24\n');
});

test('скрипты качества кода доступны из package.json', () => {
  assert.equal(packageJson.scripts.test, 'node --test tests/*.test.mjs');
  assert.equal(packageJson.scripts['lint:fix'], 'eslint . --fix');
  assert.equal(
    packageJson.scripts.precommit,
    'eslint . --fix && prettier --write . && electron-vite build'
  );
  assert.equal(
    packageJson.scripts['quality:check'],
    'npm run format:check && npm run lint && npm run typecheck'
  );
});

test('CI проверяет стабильные и prerelease-ветки', () => {
  for (const branch of ['master', 'release/nightly', 'release/beta']) {
    assert.match(ciWorkflow, new RegExp(`- ${branch.replace('/', '\\/')}`));
  }

  assert.match(ciWorkflow, /npm ci/);
  assert.match(ciWorkflow, /npm run quality:check/);
  assert.match(ciWorkflow, /npm test/);
});

test('main-процесс разделён на Nest-модули', async () => {
  const moduleNames = [
    'binary-locator.module.ts',
    'downloads.module.ts',
    'electron-shell.module.ts',
    'settings.module.ts'
  ];

  await Promise.all(
    moduleNames.map((moduleName) =>
      access(new URL(`../src/main/modules/${moduleName}`, import.meta.url))
    )
  );

  const appModule = await readFile(new URL('../src/main/app.module.ts', import.meta.url), 'utf8');
  assert.match(appModule, /imports:/);
  assert.doesNotMatch(appModule, /providers:/);
});

test('renderer поддерживает сохранённую тёмную тему', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

  assert.match(renderer, /dataset\.theme/);
  assert.match(renderer, /Тёмная тема/);
  assert.match(styles, /\[data-theme='dark'\]/);
  assert.match(styles, /\[data-theme='dark'\] \.settings-mode-tabs[\s\S]*background: #1f2937/);
  assert.match(styles, /\[data-theme='dark'\] \.settings-mode-tabs[\s\S]*border-color: #374151/);
});

test('кнопки Eng раскрывают английский вариант настройки', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');

  assert.match(renderer, /data-original-text=/);
  assert.match(renderer, /class="eng-help-text" hidden/);
  assert.match(renderer, /querySelectorAll<HTMLButtonElement>\('\.eng-help'\)/);
  assert.match(renderer, /setAttribute\('aria-expanded'/);
});

test('все настройки получают всплывающую подсказку с режимами и примером', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

  assert.match(renderer, /class="settings-help-button"/);
  assert.match(renderer, /class="settings-help-tooltip"/);
  assert.match(renderer, /Варианты:/);
  assert.match(renderer, /Пример:/);
  assert.match(styles, /\.settings-help:hover \.settings-help-tooltip/);
  assert.match(styles, /\.settings-help-button/);
});

test('итоговая команда закреплена сверху и скрыта по умолчанию', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

  assert.doesNotMatch(renderer, /Унаследовано из yt-dlp/);
  assert.match(renderer, /<details class="panel settings-panel command-preview-panel">/);
  assert.match(renderer, /<summary class="command-preview-summary">/);
  assert.doesNotMatch(renderer, /<details class="panel settings-panel command-preview-panel" open>/);
  const settingsPanel = renderer.slice(renderer.indexOf('function renderSettingsPanel'));
  assert.ok(settingsPanel.indexOf('command-preview-panel') < settingsPanel.indexOf('${renderSettingsModeTabs()}'));
  assert.match(styles, /\.command-preview-panel\s*\{[\s\S]*position: sticky/);
});

test('секции настроек можно сворачивать независимо', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

  assert.match(renderer, /<details class="panel settings-panel settings-list-panel settings-group"/);
  assert.match(renderer, /data-settings-section=/);
  assert.match(renderer, /querySelectorAll<HTMLDetailsElement>\('\[data-settings-section\]'\)/);
  assert.match(renderer, /COLLAPSED_SETTINGS_SECTIONS_KEY/);
  assert.match(styles, /\.settings-group > summary/);
});

test('основные блоки очереди и модальные окна поддерживают тёмную тему', async () => {
  const styles = await readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

  for (const selector of [
    '.task',
    '.task-action',
    '.task-url-toggle',
    '.status.running',
    '.status.done',
    '.status.failed',
    '.progress-track',
    '.modal'
  ]) {
    assert.match(styles, new RegExp(`\\[data-theme='dark'\\] ${selector.replace('.', '\\.')}`));
  }
});

test('дефолтный config yt-dlp встроен в приложение', async () => {
  const settingsService = await readFile(
    new URL('../src/main/services/settings.service.ts', import.meta.url),
    'utf8'
  );
  const defaultConfig = await readFile(
    new URL('../src/main/default-ytdlp-config.ts', import.meta.url),
    'utf8'
  );

  assert.match(settingsService, /DEFAULT_YTDLP_CONFIG/);
  assert.doesNotMatch(settingsService, /getYtdlpConfigCandidates|homedir\(\)|inheritedConfigPaths/);
  assert.match(settingsService, /join\(app\.getPath\('userData'\), 'yt-dlp\.conf'\)/);
  assert.match(settingsService, /inlineConfigText: configText/);
  assert.match(settingsService, /inlineConfigText: undefined/);
  assert.match(defaultConfig, /--merge-output-format/);
  assert.match(defaultConfig, /--download-archive/);
  assert.match(defaultConfig, /__SAVVY_DOWNLOAD_DIR__/);
  assert.match(defaultConfig, /__SAVVY_DOWNLOAD_ARCHIVE__/);
  assert.doesNotMatch(defaultConfig, /\/Users\/alamonall\/Videos/);
  assert.match(settingsService, /app\.getPath\('downloads'\)/);
  assert.match(settingsService, /\.yt-dlp-archive\.txt/);
});

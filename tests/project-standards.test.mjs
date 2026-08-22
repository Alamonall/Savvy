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

test('линтер разрешает не более одного класса в TypeScript и JavaScript файле', async () => {
  const eslintConfig = await readFile(new URL('../eslint.config.js', import.meta.url), 'utf8');

  assert.match(eslintConfig, /files: \['\*\*\/\*\.\{ts,mjs\}'\]/);
  assert.match(eslintConfig, /'max-classes-per-file': \['error', 1\]/);
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
  assert.doesNotMatch(
    renderer,
    /<details class="panel settings-panel command-preview-panel" open>/
  );
  const settingsPanel = renderer.slice(renderer.indexOf('function renderSettingsPanel'));
  assert.ok(
    settingsPanel.indexOf('command-preview-panel') <
      settingsPanel.indexOf('${renderSettingsModeTabs()}')
  );
  assert.match(styles, /\.command-preview-panel\s*\{[\s\S]*position: sticky/);
});

test('секции настроек можно сворачивать независимо', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

  assert.match(
    renderer,
    /<details class="panel settings-panel settings-list-panel settings-group"/
  );
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

test('cookie-настройки отображаются только для выбранного источника', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');

  assert.match(renderer, /function isSettingsOptionVisible\(option: SettingsOption\)/);
  assert.match(renderer, /cookiesFromBrowser[\s\S]*browser/);
  assert.match(renderer, /cookiesFile[\s\S]*file/);
  assert.match(renderer, /isSettingsOptionVisible\(option\)/);
});

test('настройки можно искать через закреплённое поле сверху', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

  assert.match(renderer, /id="settings-search"/);
  assert.match(
    renderer,
    /function isSettingsOptionMatching\(option: SettingsOption, query: string\)/
  );
  assert.match(renderer, /settingsSearchQuery = input.value/);
  assert.match(styles, /\.settings-search-panel\s*\{[\s\S]*position: sticky/);
});

test('группа URL отдаёт приоритет имени успешной загрузки', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');

  assert.match(
    renderer,
    /function getUrlGroupTitle\(url: string, tasks: DownloadTask\[\]\): string/
  );
  assert.match(renderer, /task\.status === 'done' && task\.title && task\.title !== task\.url/);
  assert.match(renderer, /successfulTask/);
});

test('успешная попытка определяет статус группы URL', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

  assert.match(
    renderer,
    /if \(tasks\.some\(\(task\) => task\.status === 'done'\)\) \{[\s\S]*return 'done';/
  );
  assert.match(renderer, /actionableTask \? renderTaskActions\(actionableTask\) : ''/);
  assert.match(renderer, /class="task task-url-group-header"/);
  assert.match(styles, /\.task-url-group-header:has\(\.task-url-toggle:hover\)/);
});

test('имя ролика фиксируется при первом обнаружении и становится именем группы повторов', async () => {
  const downloadsService = await readFile(
    new URL('../src/main/services/downloads.service.ts', import.meta.url),
    'utf8'
  );
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');

  assert.match(downloadsService, /if \(title && task\.title === task\.url\) \{/);
  assert.match(downloadsService, /url: originalTask\.url,[\s\S]*title: originalTask\.url,/);
  assert.match(renderer, /successfulTask\?\.title[\s\S]*tasks\.find/);
});

test('UI-элементы переиспользуют общий стиль', async () => {
  const agents = await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8');

  assert.match(agents, /Actively reuse existing components and shared render helpers/);
  assert.match(agents, /Equivalent UI elements must use the same DOM structure/);
});

test('повторный клик по задаче сворачивает её лог', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');

  assert.match(renderer, /selectedTaskId === button\.dataset\.taskId/);
  assert.match(renderer, /refreshQueueView\(\);/);
  assert.doesNotMatch(renderer, /data-close-log/);
});

test('обновление лога сохраняет ручную прокрутку и позволяет вернуться к последним строкам', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

  assert.match(renderer, /function captureTaskLogScrollState\(taskList: HTMLElement\)/);
  assert.match(renderer, /function restoreTaskLogScrollState\(\s*taskList: HTMLElement/);
  assert.match(renderer, /data-scroll-task-log=/);
  assert.match(renderer, /\[data-scroll-task-log\]/);
  assert.match(renderer, /scrollTop = taskLog\.scrollHeight/);
  assert.match(styles, /\.task-log-jump/);
  assert.match(styles, /\.task-log-jump\[hidden\]/);
});

test('фоновое обновление очереди не переключает открытый лог', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');

  assert.match(renderer, /function applyQueueUpdate\(update: DownloadUpdate\): void/);
  assert.match(
    renderer,
    /if \(selectedTaskId && !getVisibleQueue\(\)\.some\(\(task\) => task\.id === selectedTaskId\)\) \{/
  );
  assert.doesNotMatch(renderer, /selectedTaskId = update\.task\.id;/);
});

test('клик по группе повторных попыток переключает группу и закрывает лог', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');

  assert.match(renderer, /data-url-group-toggle/);
  assert.match(renderer, /expandedUrlGroups\[groupKey\]/);
  assert.match(renderer, /selectedTaskId = null/);
});

test('загрузки сортируются от самых свежих к старым', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');

  assert.match(renderer, /rightTask\.createdAt - leftTask\.createdAt/);
});

test('предупреждает о незаполненном источнике cookies', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

  assert.match(renderer, /Опция не будет применена, пока не выбран браузер/);
  assert.match(renderer, /Опция не будет применена, пока не выбран файл/);
  assert.match(styles, /\.settings-warning/);
});

test('предупреждение cookies обновляется после выбора браузера или файла', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');

  assert.match(renderer, /key === 'cookiesFromBrowser' \|\| key === 'cookiesFile'/);
  assert.match(renderer, /updatePromise\.then\(\(\) => render\(\)\)/);
});

test('нетронутые настройки помечаются как raw', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');
  const sharedTypes = await readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

  assert.match(sharedTypes, /customizedOptionKeys: string\[\]/);
  assert.match(renderer, /function renderRawOptionLabel\(option: SettingsOption\)/);
  assert.match(renderer, /customizedOptionKeys/);
  assert.match(styles, /\.settings-option-raw/);
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

test('задача сохраняет итоговый config и поддерживает отмену', async () => {
  const sharedTypes = await readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8');
  const downloadsService = await readFile(
    new URL('../src/main/services/downloads.service.ts', import.meta.url),
    'utf8'
  );
  const preload = await readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
  const mainProcess = await readFile(
    new URL('../src/main/electron-application.ts', import.meta.url),
    'utf8'
  );
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');

  assert.match(sharedTypes, /'cancelled'/);
  assert.match(sharedTypes, /effectiveConfigText: string/);
  assert.match(downloadsService, /buildTaskConfiguration\(\s*taskId,/);
  assert.match(downloadsService, /Конфигурация yt-dlp:/);
  assert.match(downloadsService, /cancel\(taskId: string\)/);
  assert.match(downloadsService, /child\.kill\('SIGTERM'\)/);
  assert.match(preload, /cancelDownload/);
  assert.match(mainProcess, /downloads:cancel/);
  assert.match(renderer, /data-cancel-task/);
  assert.match(renderer, /Конфиг yt-dlp:/);
});

test('граф codebase-memory не отслеживается Git', async () => {
  const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');

  assert.match(gitignore, /^\.codebase-memory\/$/m);
});

test('HTTP 403 предлагает понятные действия вместо общего автоповтора', async () => {
  const downloadsService = await readFile(
    new URL('../src/main/services/downloads.service.ts', import.meta.url),
    'utf8'
  );
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

  assert.doesNotMatch(downloadsService, /MAX_HTTP_403_AUTO_RETRIES/);
  assert.match(renderer, /function renderHttp403Recommendations\(task: DownloadTask\)/);
  assert.match(renderer, /data-recommend-403-cookies/);
  assert.match(renderer, /data-recommend-403-throttle/);
  assert.match(renderer, /data-recommend-403-network/);
  assert.match(renderer, /data-recommend-403-update/);
  assert.match(renderer, /--sleep-requests 1/);
  assert.match(renderer, /function applyHttp403CookiesRecommendation\(taskId: string\)/);
  assert.match(renderer, /function revealSettingsSection\(optionId: string\): void/);
  assert.match(
    renderer,
    /async function applyHttp403CookiesRecommendation\(taskId: string\): Promise<void> \{[\s\S]*currentTab = 'settings';[\s\S]*settingsMode = 'ui';[\s\S]*settingsSearchQuery = 'cookies';[\s\S]*revealSettingsSection\('cookies-source'\);/
  );
  assert.match(renderer, /section\?\.scrollIntoView\(\{ block: 'start' \}\);/);
  assert.match(styles, /\.http-403-recommendations/);
});

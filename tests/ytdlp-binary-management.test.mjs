import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const sharedTypes = await readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8');
const binaryLocator = await readFile(
  new URL('../src/main/services/binary-locator.service.ts', import.meta.url),
  'utf8'
);
const electronApplication = await readFile(
  new URL('../src/main/electron-application.ts', import.meta.url),
  'utf8'
);
const preload = await readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');
const settingsService = await readFile(
  new URL('../src/main/services/settings.service.ts', import.meta.url),
  'utf8'
);

test('пользователь выбирает отдельный бинарник yt-dlp и обновляет только его', () => {
  assert.match(sharedTypes, /ytdlpPath: string;/);
  assert.match(sharedTypes, /interface YtdlpBinaryInfo/);
  assert.match(sharedTypes, /getYtdlpBinaryInfo\(\): Promise<YtdlpBinaryInfo>;/);
  assert.match(sharedTypes, /updateYtdlpBinary\(\): Promise<YtdlpBinaryInfo>;/);
  assert.match(sharedTypes, /chooseYtdlpBinary\(\): Promise<string \| null>;/);

  assert.match(binaryLocator, /getYtdlpBinaryInfo\(customPath: string\): Promise<YtdlpBinaryInfo>/);
  assert.match(binaryLocator, /async updateYtdlpBinary\(/);
  assert.match(binaryLocator, /Сначала выбери файл yt-dlp для обновления\./);
  assert.match(binaryLocator, /brew upgrade yt-dlp/);
  assert.match(binaryLocator, /python -m pip install -U yt-dlp/);
  assert.match(binaryLocator, /'--version'/);
  assert.match(binaryLocator, /'-U'/);

  assert.match(electronApplication, /'settings:get-ytdlp-binary-info'/);
  assert.match(electronApplication, /'settings:update-ytdlp-binary'/);
  assert.match(electronApplication, /'settings:choose-ytdlp-binary'/);
  assert.match(preload, /getYtdlpBinaryInfo\(\)/);
  assert.match(preload, /updateYtdlpBinary\(\)/);
  assert.match(preload, /chooseYtdlpBinary\(\)/);

  assert.match(renderer, /Бинарник yt-dlp/);
  assert.match(renderer, /Версия yt-dlp/);
  assert.match(renderer, /Выбрать файл yt-dlp/);
  assert.match(renderer, /Обновить выбранный yt-dlp/);
  assert.match(renderer, /Сбросить выбор/);
  assert.match(renderer, /!settings\.ytdlpPath \? 'disabled' : ''/);
  assert.match(renderer, /async function resetYtdlpBinarySelection\(\): Promise<void>/);
  assert.match(renderer, /updateLocalSettings\(\{ ytdlpPath: '' \}\)/);
});

test('приложение находит и безопасно устанавливает управляемый yt-dlp', () => {
  assert.match(sharedTypes, /export type YtdlpReleaseChannel = 'stable' \| 'nightly';/);
  assert.match(sharedTypes, /export interface YtdlpBinaryCandidate/);
  assert.match(sharedTypes, /findYtdlpBinaries\(\): Promise<YtdlpBinaryCandidate\[]>;/);
  assert.match(
    sharedTypes,
    /getYtdlpLatestRelease\(channel: YtdlpReleaseChannel\): Promise<string>;/
  );
  assert.match(
    sharedTypes,
    /installYtdlpBinary\(channel: YtdlpReleaseChannel\): Promise<YtdlpBinaryInfo>;/
  );

  assert.match(binaryLocator, /async findYtdlpBinaries\(\): Promise<YtdlpBinaryCandidate\[]>/);
  assert.match(
    binaryLocator,
    /async getYtdlpLatestRelease\(channel: YtdlpReleaseChannel\): Promise<string>/
  );
  assert.match(binaryLocator, /api\.github\.com\/repos\/\$\{repository\}\/releases\?per_page=1/);
  assert.match(
    binaryLocator,
    /async installYtdlpBinary\(channel: YtdlpReleaseChannel\): Promise<YtdlpBinaryInfo>/
  );
  assert.match(binaryLocator, /SHA2-256SUMS/);
  assert.match(binaryLocator, /createHash\('sha256'\)/);
  assert.match(binaryLocator, /app\.getPath\('userData'\), 'bin'/);
  assert.match(binaryLocator, /yt-dlp-nightly-builds/);
  assert.match(binaryLocator, /return this\.resolveBinaryPath\('yt-dlp'\);/);
  assert.match(binaryLocator, /copyFile\(temporaryPath, targetPath\)/);
  assert.match(binaryLocator, /MAX_MANAGED_BINARY_SIZE_BYTES/);

  assert.match(electronApplication, /'settings:find-ytdlp-binaries'/);
  assert.match(electronApplication, /'settings:install-ytdlp-binary'/);
  assert.match(preload, /findYtdlpBinaries\(\)/);
  assert.match(preload, /getYtdlpLatestRelease\(channel: YtdlpReleaseChannel\)/);
  assert.match(preload, /installYtdlpBinary\(channel: YtdlpReleaseChannel\)/);

  assert.match(renderer, /Найти yt-dlp/);
  assert.match(renderer, /Установить stable/);
  assert.match(renderer, /Установить nightly/);
  assert.match(renderer, /Проверить последнюю версию/);
  assert.match(renderer, /async function checkYtdlpLatestRelease\(\): Promise<void>/);
  assert.match(renderer, /async function findYtdlpBinaries\(\): Promise<void>/);
  assert.match(
    renderer,
    /async function installYtdlpBinary\(channel: YtdlpReleaseChannel\): Promise<void>/
  );
});

test('UI и текстовый режим формируют один config-файл с приоритетом UI без повторов', () => {
  assert.match(
    settingsService,
    /private buildEffectiveConfigText\(\): string \{[\s\S]*const managedArgs = this\.removeDuplicateManagedArgs\([\s\S]*this\.serializeArgs\(managedArgs\)/
  );
  assert.match(
    settingsService,
    /private removeDuplicateManagedArgs\(configText: string, managedArgs: string\[\]\): string\[\]/
  );
  assert.match(settingsService, /yt-dlp-\$\{taskId\}\.conf/);
  assert.match(
    settingsService,
    /writeFileSync\(configPath, `\$\{effectiveConfigText\}\\n`, 'utf8'\)/
  );
  assert.doesNotMatch(
    settingsService,
    /return \[this\.serializeArgs\(configArgs\), optionsText\.trim\(\)\]/
  );
});

test('не добавляет JS runtime автоматически для совместимости с системным yt-dlp', () => {
  assert.doesNotMatch(settingsService, /args\.push\('--js-runtimes', 'deno'\)/);
  assert.doesNotMatch(binaryLocator, /getDenoPath\(\): string \| null/);
});

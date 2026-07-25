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
    packageJson.scripts['quality:check'],
    'npm run format:check && npm run lint && npm run typecheck'
  );
});

test('CI проверяет стабильные и prerelease-ветки', () => {
  for (const branch of ['main', 'master', 'release/nightly', 'release/beta']) {
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
});

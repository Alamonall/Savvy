import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

/** Возвращает фрагмент исходника между двумя маркерами, чтобы проверять одну функцию. */
function sourceBetween(startMarker, endMarker) {
  const start = renderer.indexOf(startMarker);
  assert.notEqual(start, -1, `маркер не найден: ${startMarker}`);
  const end = renderer.indexOf(endMarker, start);
  assert.notEqual(end, -1, `маркер не найден: ${endMarker}`);
  return renderer.slice(start, end);
}

const topbarIconSource = () =>
  sourceBetween('function renderApplicationUpdateButton', 'function renderInstallUpdateModal');

test('иконка обновления в topbar заменяет текстовую кнопку и несёт этап в data-атрибуте', () => {
  const iconSource = topbarIconSource();

  assert.match(iconSource, /data-application-update\b/);
  assert.match(iconSource, /data-update-stage="\$\{/);
  assert.match(iconSource, /<svg class="application-update-icon"/);
  assert.match(iconSource, /class="application-update-indicator"/);
  assert.match(iconSource, /stroke-dashoffset="\$\{/);
  assert.match(iconSource, /status === 'idle'/);
  assert.doesNotMatch(
    iconSource,
    /if \(!applicationUpdate \|\| applicationUpdate\.status === 'idle'\) \{\s*return '';/
  );
  assert.doesNotMatch(iconSource, />\$\{escapeHtml\(label\)\}</);
  assert.match(
    renderer,
    /\$\{renderApplicationUpdateButton\(\)\}\s*<button class="ghost bordered theme-toggle"/
  );
});

test('aria-label иконки описывает этап и действие, а не текст на самой иконке', () => {
  const iconSource = topbarIconSource();

  assert.match(iconSource, /'Скачать обновление'/);
  assert.match(iconSource, /Скачивание обновления \$\{/);
  assert.match(iconSource, /'Установить обновление'/);
  assert.match(iconSource, /'Повторить скачивание'/);
  assert.match(iconSource, /'Открыть релиз'/);
  assert.match(
    iconSource,
    /aria-label="\$\{escapeHtml\(getApplicationUpdateActionLabel\(stage, update\)\)\}"/
  );
  assert.match(iconSource, /\$\{isDisabled \? 'disabled' : ''\}/);
});

test('иконка видна без найденного обновления и запускает проверку', () => {
  const iconSource = topbarIconSource();
  const handlerSource = sourceBetween(
    'async function handleApplicationUpdateAction',
    'function getPendingQueueTaskCounts'
  );

  assert.match(iconSource, /'Проверить обновления'/);
  assert.match(iconSource, /'Проверка обновлений…'/);
  assert.match(iconSource, /'Установлена последняя версия'/);
  assert.match(iconSource, /'Повторить проверку обновлений'/);
  assert.match(iconSource, /'checking'/);
  assert.match(iconSource, /'up-to-date'/);
  assert.match(iconSource, /'check-error'/);
  assert.match(
    handlerSource,
    /!applicationUpdate \|\| applicationUpdate\.status === 'idle'\) \{\s*await checkApplicationUpdate\(\)/
  );
});

test('tooltip обновления показывает версии, первые 5 пунктов и без кнопок', () => {
  const iconSource = topbarIconSource();

  assert.match(iconSource, /role="tooltip"/);
  assert.match(iconSource, /aria-describedby="application-update-tooltip"/);
  assert.match(iconSource, /id="application-update-tooltip"/);
  assert.match(renderer, /\$\{update\.currentVersion\} → \$\{update\.version\}/);
  assert.match(iconSource, /changes\.slice\(0, 5\)/);
  assert.match(iconSource, /и ещё \$\{/);
  assert.match(iconSource, /Список изменений недоступен/);
  assert.match(iconSource, /release-changes/);
  const tooltipSource = iconSource.slice(
    iconSource.indexOf('id="application-update-tooltip"'),
    iconSource.indexOf('function getApplicationUpdateActionLabel')
  );
  assert.doesNotMatch(tooltipSource, /<button/);
  assert.match(styles, /\.application-update-tooltip/);
});

test('клик по иконке выполняет действие этапа, включая повтор скачивания после ошибки', () => {
  const handlerSource = sourceBetween(
    'async function handleApplicationUpdateAction',
    'function getPendingQueueTaskCounts'
  );

  assert.match(handlerSource, /status === 'available' \|\| applicationUpdate\.status === 'error'/);
  assert.match(handlerSource, /requiresManualDownload && applicationUpdate\.releaseUrl/);
  assert.match(handlerSource, /openUrl\(applicationUpdate\.releaseUrl\)/);
  assert.match(handlerSource, /getPendingQueueTaskCounts\(\)/);
  assert.match(handlerSource, /isInstallUpdateModalOpen = true/);
  assert.match(handlerSource, /installApplicationUpdate\(\)/);
});

test('настройки содержат секцию обновления приложения с проверкой, списком изменений и GitHub', () => {
  const uiPanelSource = sourceBetween(
    'function renderSettingsUiPanel',
    'function renderYtdlpCandidates'
  );
  const sectionSource = sourceBetween(
    'function renderApplicationUpdateSettingsSection',
    'function renderSettingsTextPanel'
  );

  assert.match(uiPanelSource, /\$\{renderApplicationUpdateSettingsSection\(\)\}/);
  assert.match(sectionSource, /<h2>Обновление приложения<\/h2>/);
  assert.match(sectionSource, /Версия приложения: \$\{/);
  assert.match(sectionSource, /Новая версия: \$\{/);
  assert.match(sectionSource, /id="check-application-update"/);
  assert.match(sectionSource, /Проверить сейчас/);
  assert.match(sectionSource, /Проверка…/);
  assert.match(sectionSource, /Список изменений/);
  assert.match(sectionSource, /Список изменений недоступен/);
  assert.match(sectionSource, /'Скачать'/);
  assert.match(sectionSource, /Установить и перезапустить/);
  assert.match(sectionSource, /'Повторить'/);
  assert.match(sectionSource, /Открыть релиз/);
  assert.match(sectionSource, /Открыть на GitHub/);
  assert.match(sectionSource, /id="open-application-release"/);
  assert.match(sectionSource, /data-application-update-action/);
  assert.match(sectionSource, /applicationUpdateCheckError/);
  assert.match(sectionSource, /class="settings-warning"/);
  assert.match(sectionSource, /class="progress-track"/);
});

test('проверка обновления вызывает checkApplicationUpdate и показывает ошибку локально, без runtimeNotice', () => {
  const checkSource = sourceBetween(
    'async function checkApplicationUpdate',
    'function updateBrowserCookies'
  );

  assert.match(checkSource, /await window\.ytdlp\.checkApplicationUpdate\(\)/);
  assert.match(checkSource, /isApplicationUpdateCheckInProgress = true/);
  assert.match(checkSource, /applicationUpdateCheckError =\s+error instanceof Error/);
  assert.match(checkSource, /isApplicationUpdateCheckInProgress = false/);
  assert.doesNotMatch(checkSource, /runtimeNotice/);
});

test('кнопки секции обновления подключены к существующим обработчикам', () => {
  const bindingsSource = sourceBetween(
    'function bindSettingsEvents',
    'function refreshYtdlpBinaryInfo'
  );

  assert.match(bindingsSource, /#check-application-update/);
  assert.match(bindingsSource, /void checkApplicationUpdate\(\)/);
  assert.match(bindingsSource, /\[data-application-update-action\]/);
  assert.match(bindingsSource, /void handleApplicationUpdateAction\(\)/);
  assert.match(bindingsSource, /#open-application-release/);
});

test('browser preview API содержит checkApplicationUpdate и не использует releaseNotes', () => {
  assert.match(renderer, /async checkApplicationUpdate\(\)/);
  assert.match(renderer, /changes: \[\]/);
  assert.doesNotMatch(renderer, /releaseNotes/);
});

test('стили индикатора обновления описывают все этапы в светлой и тёмной теме', () => {
  assert.match(styles, /\.application-update-button/);
  assert.match(styles, /\.application-update-indicator/);
  assert.match(styles, /\.application-update-progress/);
  assert.match(styles, /\[data-update-stage='available'\]/);
  assert.match(styles, /\[data-update-stage='downloading'\]/);
  assert.match(styles, /\[data-update-stage='downloaded'\]/);
  assert.match(styles, /\[data-update-stage='error'\]/);
  assert.match(styles, /\[data-update-stage='checking'\]/);
  assert.match(styles, /\[data-update-stage='up-to-date'\]/);
  assert.match(styles, /\[data-update-stage='check-error'\]/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /\.application-update-button:disabled/);
  assert.match(styles, /\.application-update-button:focus-visible/);
  assert.match(styles, /\[data-theme='dark'\] \.application-update-button/);
  assert.match(styles, /\[data-theme='dark'\] \.application-update-indicator/);
  assert.match(styles, /\[data-theme='dark'\] \.application-update-tooltip/);
  assert.match(styles, /\[data-theme='dark'\] \.release-change-type/);
});

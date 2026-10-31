import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');

/** Возвращает тело функции от её объявления до следующего объявления верхнего уровня. */
function functionSource(name) {
  const start = renderer.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `функция не найдена: ${name}`);
  const end = renderer.indexOf('\nfunction ', start + 1);
  return renderer.slice(start, end === -1 ? undefined : end);
}

test('refreshQueueView заново вешает обработчик флажка «Скрыть неактивные»', () => {
  // Флажок рендерится внутри #task-list, который refreshQueueView пересоздаёт при каждом обновлении очереди.
  assert.match(functionSource('refreshQueueView'), /bindHideInactiveToggle\(\)/);
});

test('статические события очереди используют общий обработчик флажка', () => {
  assert.match(functionSource('bindQueueStaticEvents'), /bindHideInactiveToggle\(\)/);
});

test('оба фильтра списка и миникарты используют один предикат активных задач', () => {
  assert.match(functionSource('getVisibleQueue'), /queue\.filter\(isActiveTask\)/);
  assert.match(functionSource('renderTaskListMarkup'), /group\.tasks\.filter\(isActiveTask\)/);
});

test('активными считаются только выполняющиеся и ожидающие задачи', () => {
  const body = functionSource('isActiveTask');
  assert.match(body, /'running'/);
  assert.match(body, /'queued'/);
  assert.doesNotMatch(body, /'done'|'failed'|'cancelled'/);
});

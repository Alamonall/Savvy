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

test('refreshQueueView заново вешает обработчик флажка «Скрыть завершенные»', () => {
  // Флажок рендерится внутри #task-list, который refreshQueueView пересоздаёт при каждом обновлении очереди.
  assert.match(functionSource('refreshQueueView'), /bindHideCompletedToggle\(\)/);
});

test('статические события очереди используют общий обработчик флажка', () => {
  assert.match(functionSource('bindQueueStaticEvents'), /bindHideCompletedToggle\(\)/);
});

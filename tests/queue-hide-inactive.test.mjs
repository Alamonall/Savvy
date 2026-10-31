import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import { filterVisibleTasks, isActiveTask } from '../src/shared/task-activity.ts';

const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');

/** Возвращает тело функции от её объявления до следующего объявления верхнего уровня. */
function functionSource(name) {
  const start = renderer.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `функция не найдена: ${name}`);
  const end = renderer.indexOf('\nfunction ', start + 1);
  return renderer.slice(start, end === -1 ? undefined : end);
}

const STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'];
const tasks = STATUSES.map((status) => ({ id: status, status }));

test('активными считаются только выполняющиеся и ожидающие задачи', () => {
  assert.deepEqual(
    STATUSES.filter((status) => isActiveTask({ status })),
    ['queued', 'running']
  );
});

test('при включённом скрытии остаются только активные задачи в исходном порядке', () => {
  assert.deepEqual(
    filterVisibleTasks(tasks, true).map((task) => task.id),
    ['queued', 'running']
  );
});

test('при выключенном скрытии показываются все задачи, включая отменённые', () => {
  assert.deepEqual(filterVisibleTasks(tasks, false), tasks);
});

test('фильтр без активных задач возвращает пустой список', () => {
  assert.deepEqual(filterVisibleTasks(tasks.slice(2), true), []);
});

test('список и миникарта берут задачи через общий фильтр', () => {
  assert.match(functionSource('getVisibleQueue'), /filterVisibleTasks\(queue, hideInactive\)/);
  assert.match(
    functionSource('renderTaskListMarkup'),
    /filterVisibleTasks\(group\.tasks, hideInactive\)/
  );
});

test('refreshQueueView заново вешает обработчик флажка «Скрыть неактивные»', () => {
  // Флажок рендерится внутри #task-list, который refreshQueueView пересоздаёт при каждом обновлении очереди.
  assert.match(functionSource('refreshQueueView'), /bindHideInactiveToggle\(\)/);
});

test('статические события очереди используют общий обработчик флажка', () => {
  assert.match(functionSource('bindQueueStaticEvents'), /bindHideInactiveToggle\(\)/);
});

test('отмена задачи не выбирает её, когда неактивные скрыты', () => {
  assert.match(
    functionSource('cancelDownload'),
    /if \(!hideInactive\) \{\s*selectedTaskId = task\.id;\s*\}/
  );
});

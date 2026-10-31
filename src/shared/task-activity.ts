import type { DownloadTask } from './types';

/** Активная задача выполняется или ждёт запуска; остальные считаются неактивными. */
export function isActiveTask(task: DownloadTask): boolean {
  return task.status === 'running' || task.status === 'queued';
}

/** Возвращает задачи для показа: при включённом скрытии только активные. */
export function filterVisibleTasks(tasks: DownloadTask[], hideInactive: boolean): DownloadTask[] {
  return hideInactive ? tasks.filter(isActiveTask) : tasks;
}

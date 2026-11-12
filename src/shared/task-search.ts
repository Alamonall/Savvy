import type { DownloadTask } from './types';

/** Нормализует поисковый запрос для регистронезависимого поиска по токенам. */
export function normalizeSearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

/** Разбивает поисковый запрос на непустые слова-токены. */
export function tokenizeSearchQuery(query: string): string[] {
  const normalized = normalizeSearchQuery(query);
  return normalized ? normalized.split(/\s+/).filter(Boolean) : [];
}

/** Проверяет, соответствует ли задача поисковому запросу по названию, ссылке, сообщению или статусу. */
export function matchesTaskSearch(
  task: Pick<DownloadTask, 'title' | 'url' | 'userMessage' | 'status'>,
  query: string,
  statusLabel?: string
): boolean {
  const tokens = tokenizeSearchQuery(query);
  if (!tokens.length) {
    return true;
  }

  const searchableText = [task.title, task.url, task.userMessage, statusLabel, task.status]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();

  return tokens.every((token) => searchableText.includes(token));
}

/** Фильтрует список задач по поисковому запросу, сохраняя исходный порядок. */
export function filterTasksBySearch<
  T extends Pick<DownloadTask, 'title' | 'url' | 'userMessage' | 'status'>
>(tasks: T[], query: string, getStatusLabel?: (status: T['status']) => string): T[] {
  if (!normalizeSearchQuery(query)) {
    return tasks;
  }

  return tasks.filter((task) => matchesTaskSearch(task, query, getStatusLabel?.(task.status)));
}

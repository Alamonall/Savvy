/**
 * Определяет ошибку решателя YouTube n-challenge (например, `a.addOnDisposeCallback is not a function`),
 * возникающую в устаревших версиях yt-dlp (< 2026.11.23) при использовании cookies.
 */
export function isYoutubeNChallengeDisposeError(logText: string): boolean {
  if (/addOnDisposeCallback is not a function/i.test(logText)) {
    return true;
  }

  return (
    /Error solving n challenge request/i.test(logText) &&
    (/n challenge solving failed/i.test(logText) ||
      /Only images are available for download/i.test(logText) ||
      /Requested format is not available/i.test(logText))
  );
}

/** Проверяет, заданы ли cookies в эффективной конфигурации или аргументах запуска задачи. */
export function hasCookieConfiguration(effectiveConfigText: string, optionsText: string): boolean {
  const cookieFlagPattern = /(?:^|\s)--cookies(?:-from-browser)?(?:=|\s|$)/m;
  return cookieFlagPattern.test(effectiveConfigText) || cookieFlagPattern.test(optionsText);
}

/**
 * Формирует аргументы обходного запуска без cookies: удаляет явные флаги cookies
 * и добавляет `--no-cookies` / `--no-cookies-from-browser` для переопределения конфига.
 */
export function buildNoCookiesBypassArgs(baseArgs: string[]): string[] {
  const filteredArgs: string[] = [];

  for (let index = 0; index < baseArgs.length; index += 1) {
    const arg = baseArgs[index];
    if (arg === '--cookies' || arg === '--cookies-from-browser') {
      index += 1;
      continue;
    }

    if (arg.startsWith('--cookies=') || arg.startsWith('--cookies-from-browser=')) {
      continue;
    }

    filteredArgs.push(arg);
  }

  if (!filteredArgs.includes('--no-cookies')) {
    filteredArgs.push('--no-cookies');
  }

  if (!filteredArgs.includes('--no-cookies-from-browser')) {
    filteredArgs.push('--no-cookies-from-browser');
  }

  return filteredArgs;
}

/**
 * Определяет ошибку решателя YouTube n-challenge (`addOnDisposeCallback is not a function`),
 * возникающую в устаревших версиях yt-dlp (< 2026.11.23) при использовании cookies.
 */
export function isYoutubeNChallengeDisposeError(logText: string): boolean {
  return /(?:^|\n)[^\n]*Error solving n challenge request[\s\S]{0,300}?addOnDisposeCallback is not a function/i.test(
    logText
  );
}

/** Разбивает строку конфига или аргументов на токены с учётом кавычек. */
function tokenizeArgsLine(line: string): string[] {
  const tokens: string[] = [];
  const tokenPattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null = tokenPattern.exec(line);

  while (match !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
    match = tokenPattern.exec(line);
  }

  return tokens;
}

/** Удаляет комментарий `# ...` вне кавычек из строки конфигурации yt-dlp. */
function stripInlineConfigComment(line: string): string {
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '#') {
      return line.slice(0, index).trim();
    }
  }

  return line.trim();
}

/** Разбирает конфиг yt-dlp (без комментариев) и аргументы запуска в плоский список токенов. */
function parseEffectiveTokens(effectiveConfigText: string, optionsText: string): string[] {
  const configLines = effectiveConfigText
    .split(/\r?\n/)
    .map((line) => stripInlineConfigComment(line))
    .filter((line) => line.length > 0 && !line.startsWith(';'));

  const tokens: string[] = [];
  for (const line of configLines) {
    tokens.push(...tokenizeArgsLine(line));
  }
  tokens.push(...tokenizeArgsLine(optionsText));
  return tokens;
}

/** Проверяет, активны ли cookies в итоговой конфигурации или аргументах запуска задачи. */
export function hasCookieConfiguration(effectiveConfigText: string, optionsText: string): boolean {
  const tokens = parseEffectiveTokens(effectiveConfigText, optionsText);
  let hasCookiesFile = false;
  let hasCookiesBrowser = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === '--cookies') {
      hasCookiesFile = true;
      index += 1;
    } else if (token.startsWith('--cookies=')) {
      hasCookiesFile = true;
    } else if (token === '--no-cookies') {
      hasCookiesFile = false;
    } else if (token === '--cookies-from-browser') {
      hasCookiesBrowser = true;
      index += 1;
    } else if (token.startsWith('--cookies-from-browser=')) {
      hasCookiesBrowser = true;
    } else if (token === '--no-cookies-from-browser') {
      hasCookiesBrowser = false;
    }
  }

  return hasCookiesFile || hasCookiesBrowser;
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

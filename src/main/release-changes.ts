import type { ReleaseChange } from '../shared/types';

/** Типы Conventional Commits, которые сохраняются в отдельное поле пункта. */
const CONVENTIONAL_TYPES = new Set([
  'feat',
  'fix',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'docs',
  'chore',
  'revert'
]);

/** Маркер пункта списка в markdown: `-`, `*`, `+` или нумерованный `1.`. */
const BULLET_PATTERN = /^(?:[-*+]|\d+[.)])(?:\s+|$)/;
/** Коммит в начале пункта, оформленный обратными кавычками или тегом `<code>`. */
const LEADING_CODE_PATTERN = /^(?:`([^`]+)`|<code\b[^>]*>([\s\S]*?)<\/code>)/i;
/** Заголовок блока автоматизации, после которого идут служебные пункты. */
const POST_MERGE_HEADING_PATTERN = /^post-merge automation\b/i;
/** Префикс Conventional Commits: `type(scope)!: text`. */
const CONVENTIONAL_PREFIX_PATTERN = /^([a-z]+)(?:\([^)]*\))?!?:(.*)$/i;
/** Markdown- и HTML-ссылка, которая в GitHub-формате указывает на автора или коммит. */
const MARKDOWN_LINK_PATTERN = /\[+([^\]]*)\]\([^)]*\)\]*/g;
/** Начало хвоста авторства: ` by` и сразу за ним ссылка, тег `<a>` или `@`-упоминание. */
const AUTHORSHIP_START_PATTERN = /\s+by\s+(?=\[|<a\b|@)/gi;
/** Полный хвост авторства после кода: `by автор` или `by автор in коммит`. */
const AUTHORSHIP_TAIL_PATTERN = /^by\s+\S+(?:\s+in\s+\S+)?$/i;

/** Вход для разбора: строка release notes или список заметок из electron-updater. */
export type ReleaseNotesInput = string | Array<{ note: string | null }> | null | undefined;

/**
 * Превращает release notes GitHub (markdown из API или HTML из releases.atom)
 * в список изменений без служебных ссылок, авторов и блока Post-merge automation.
 */
export function parseReleaseChanges(notes: ReleaseNotesInput): ReleaseChange[] {
  const changes: ReleaseChange[] = [];
  let isPostMergeBlock = false;

  for (const rawLine of toMarkdownLines(notes)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const bulletMatch = BULLET_PATTERN.exec(line);
    const content = bulletMatch ? line.slice(bulletMatch[0].length).trim() : line;

    if (
      POST_MERGE_HEADING_PATTERN.test(
        cleanText(content)
          .replace(/[*_#`]/g, '')
          .trim()
      )
    ) {
      isPostMergeBlock = true;
      continue;
    }

    if (!bulletMatch) {
      isPostMergeBlock = false;
      continue;
    }

    if (isPostMergeBlock) {
      continue;
    }

    const change = parseChangeItem(content);
    if (change) {
      changes.push(change);
    }
  }

  return changes;
}

/** Склеивает заметки электрон-апдейтера в одну строку и разбивает её на строки. */
function toMarkdownLines(notes: ReleaseNotesInput): string[] {
  const text = Array.isArray(notes)
    ? notes
        .map((item) => item.note ?? '')
        .filter(Boolean)
        .join('\n')
    : (notes ?? '');

  // Markdown-код содержит буквальный текст: структурные теги в нём не трогаем.
  return text
    .split(/(`[^`\n]*`)/)
    .map((part, index) => (index % 2 === 1 ? part : replaceStructuralTags(part)))
    .join('')
    .split(/\r?\n/);
}

/** Превращает структурные HTML-теги списков и абзацев в переводы строк и маркеры пунктов. */
function replaceStructuralTags(html: string): string {
  return html
    .replace(/<li\b[^>]*>(?:\s*<(?:p|div)\b[^>]*>)*\s*/gi, '\n- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/?(?:p|div|ul|ol|h[1-6]|br|hr|blockquote|table|tr)\b[^>]*>/gi, '\n');
}

/** Извлекает тип и текст из содержимого пункта; пункт без текста пропускается. */
function parseChangeItem(content: string): ReleaseChange | null {
  const commitText = extractCommitText(content);
  const conventionalMatch = CONVENTIONAL_PREFIX_PATTERN.exec(commitText);

  if (conventionalMatch) {
    const type = conventionalMatch[1].toLowerCase();
    const text = conventionalMatch[2].trim();

    if (CONVENTIONAL_TYPES.has(type)) {
      return text ? { type, text } : null;
    }
  }

  return commitText ? { type: 'other', text: commitText } : null;
}

/**
 * Возвращает текст коммита: содержимое кода в начале пункта, либо всю строку
 * без ссылок, авторов и служебного хвоста GitHub.
 */
function extractCommitText(content: string): string {
  const leadingCodeMatch = LEADING_CODE_PATTERN.exec(content);
  if (leadingCodeMatch && isCommitReference(content.slice(leadingCodeMatch[0].length))) {
    // Содержимое markdown-кода — буквальный текст, в нём `<tag>` не является HTML.
    return leadingCodeMatch[1]
      ? leadingCodeMatch[1].replace(/\s+/g, ' ').trim()
      : cleanText(leadingCodeMatch[2] ?? '');
  }

  const withoutAuthorship = stripAuthorshipTail(content);
  return cleanText(withoutAuthorship.replace(MARKDOWN_LINK_PATTERN, '$1').replace(/`/g, ''));
}

/** Срезает хвост `by автор [in коммит]`, только если автор оформлен ссылкой или упоминанием. */
function stripAuthorshipTail(content: string): string {
  const matches = [...content.matchAll(AUTHORSHIP_START_PATTERN)];
  const lastMatch = matches.at(-1);
  if (lastMatch?.index === undefined) {
    return content;
  }

  const tail = cleanText(content.slice(lastMatch.index).replace(MARKDOWN_LINK_PATTERN, '$1'));
  return AUTHORSHIP_TAIL_PATTERN.test(tail) ? content.slice(0, lastMatch.index) : content;
}

/** Код в начале пункта — сообщение коммита, только если дальше нет ничего, кроме хвоста ` by автор in ...`. */
function isCommitReference(rest: string): boolean {
  const cleanedRest = cleanText(rest.replace(MARKDOWN_LINK_PATTERN, '$1'));
  // Хвост авторства GitHub всегда содержит ссылку или упоминание: без них это обычный текст.
  const hasAuthorMarkup = /\]\(|<a\b|@/i.test(rest);
  return !cleanedRest || (hasAuthorMarkup && AUTHORSHIP_TAIL_PATTERN.test(cleanedRest));
}

/** Удаляет HTML-теги, декодирует базовые сущности и схлопывает пробелы. */
function cleanText(text: string): string {
  return decodeEntities(text.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Декодирует базовые HTML-сущности; `&amp;` идёт последним, чтобы не раскрывать повторно. */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

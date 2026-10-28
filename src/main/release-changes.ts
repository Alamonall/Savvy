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
/** Хвост ` by автор in коммит`, который GitHub добавляет после текста коммита. */
const BY_IN_SUFFIX_PATTERN = /\s+by\s+\S+(?:\s+in\s+\S+)?\s*$/i;
/** Хвост ` by @автор in ...` без ссылки, если упоминание пришло как обычный текст. */
const MENTION_SUFFIX_PATTERN = /\s+by\s+@[\w-]+(?:\s+in\s+\S+)?\s*$/i;

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

    if (POST_MERGE_HEADING_PATTERN.test(content.replace(/[*_#`]/g, '').trim())) {
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

  return text
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/?(?:p|div|ul|ol|h[1-6]|br|hr|blockquote|table|tr)\b[^>]*>/gi, '\n')
    .split(/\r?\n/);
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
  if (leadingCodeMatch) {
    return cleanText(leadingCodeMatch[1] ?? leadingCodeMatch[2] ?? '');
  }

  const hasLinks = /\]\([^)]*\)|<a\b/i.test(content);
  let text = cleanText(content.replace(MARKDOWN_LINK_PATTERN, '$1').replace(/`/g, ''));

  if (hasLinks) {
    text = text.replace(BY_IN_SUFFIX_PATTERN, '');
  }

  return text.replace(MENTION_SUFFIX_PATTERN, '').trim();
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

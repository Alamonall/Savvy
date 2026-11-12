import type { DownloadTask } from './types';

export const SAVVY_TITLE_PREFIX = '__SAVVY_TITLE__:';

const FORMAT_SUFFIX_PATTERN = /\.(?:f\d+(?:-[a-z0-9-]+)?|fhls-\d+|fdash-[^.\s]+)$/i;
const TRAILING_VIDEO_ID_PATTERN = /_\[[A-Za-z0-9_-]{6,}\]$/;
const KNOWN_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.webm',
  '.mov',
  '.avi',
  '.flv',
  '.ts',
  '.m4v',
  '.3gp',
  '.mp3',
  '.m4a',
  '.opus',
  '.ogg',
  '.wav',
  '.flac',
  '.aac',
  '.part',
  '.ytdl',
  '.vtt',
  '.srt',
  '.ass',
  '.lrc',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.json',
  '.description'
]);

const GENERIC_HTML_TITLES = new Set([
  'youtube',
  'x',
  'twitter',
  'x.com',
  'log in',
  'sign in',
  'login',
  'just a moment...',
  'attention required!',
  '403 forbidden',
  'access denied',
  'page not found'
]);

/** Проверяет, что у задачи ещё нет человекочитаемого названия (оно пустое или совпадает с URL). */
export function isUnresolvedTaskTitle(task: Pick<DownloadTask, 'title' | 'url'>): boolean {
  const title = task.title?.trim();
  return !title || title === task.url.trim();
}

/** Очищает имя файла из лога yt-dlp от пути, расширения, суффикса потока и [id]. */
export function cleanExtractedFilenameTitle(rawPathOrName: string): string | null {
  const unquoted = rawPathOrName.trim().replace(/^["']|["']$/g, '');
  if (!unquoted) {
    return null;
  }

  const normalizedSlashes = unquoted.replaceAll('\\', '/');
  const fileName = normalizedSlashes.slice(normalizedSlashes.lastIndexOf('/') + 1).trim();
  if (!fileName) {
    return null;
  }

  let stem = fileName;
  if (stem.toLowerCase().endsWith('.info.json')) {
    stem = stem.slice(0, -'.info.json'.length);
  } else {
    const lastDotIndex = stem.lastIndexOf('.');
    if (lastDotIndex > 0) {
      const ext = stem.slice(lastDotIndex).toLowerCase();
      if (KNOWN_EXTENSIONS.has(ext) || /^\.[a-z0-9]{2,5}$/i.test(ext)) {
        stem = stem.slice(0, lastDotIndex);
      }
    }
  }

  const withoutFormat = stem.replace(FORMAT_SUFFIX_PATTERN, '').trim();
  const withoutId = withoutFormat.replace(TRAILING_VIDEO_ID_PATTERN, '').trim();
  return withoutId || withoutFormat || null;
}

/** Извлекает название видео из одной строки вывода yt-dlp. */
export function parseTitleFromLogLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith(SAVVY_TITLE_PREFIX)) {
    const printedTitle = trimmed.slice(SAVVY_TITLE_PREFIX.length).trim();
    return printedTitle && printedTitle !== 'NA' ? printedTitle : null;
  }

  const destinationMatch = trimmed.match(
    /\[(?:download|ExtractAudio|Merger|MoveFiles|VideoRemuxer|VideoConvertor|EmbedSubtitle|ModifyChapters|Metadata|Fixup[^\]]*)]\s+Destination:\s+(.+)$/
  );
  if (destinationMatch) {
    return cleanExtractedFilenameTitle(destinationMatch[1]);
  }

  const mergerMatch = trimmed.match(/\[Merger]\s+Merging formats into\s+(.+)$/);
  if (mergerMatch) {
    return cleanExtractedFilenameTitle(mergerMatch[1]);
  }

  const alreadyDownloadedMatch = trimmed.match(
    /\[download]\s+(.+?)\s+has already been downloaded$/
  );
  if (alreadyDownloadedMatch) {
    return cleanExtractedFilenameTitle(alreadyDownloadedMatch[1]);
  }

  const playlistMatch = trimmed.match(/\[download]\s+Downloading playlist:\s+(.+)$/);
  if (playlistMatch) {
    const playlistTitle = playlistMatch[1].trim();
    return playlistTitle || null;
  }

  return null;
}

/** Ищет первое пригодное название видео среди сохранённых строк лога задачи. */
export function extractTitleFromLogLines(lines: readonly string[]): string | null {
  for (const line of lines) {
    const title = parseTitleFromLogLine(line);
    if (title) {
      return title;
    }
  }

  return null;
}

/** Возвращает URL YouTube oEmbed для поддерживаемых ссылок YouTube, иначе null. */
export function getYoutubeOembedUrl(videoUrl: string): string | null {
  try {
    const parsed = new URL(videoUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }

    const host = parsed.hostname.toLowerCase();
    if (
      host === 'youtu.be' ||
      host === 'youtube.com' ||
      host === 'www.youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtube-nocookie.com' ||
      host === 'www.youtube-nocookie.com'
    ) {
      return `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
    }
  } catch {
    return null;
  }

  return null;
}

/** Возвращает URL Twitter/X oEmbed для ссылок на посты, иначе null. */
export function getTwitterOembedUrl(videoUrl: string): string | null {
  try {
    const parsed = new URL(videoUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }

    const host = parsed.hostname.toLowerCase();
    if (
      (host === 'x.com' ||
        host === 'www.x.com' ||
        host === 'twitter.com' ||
        host === 'www.twitter.com' ||
        host === 'mobile.twitter.com') &&
      /\/status\/\d+/.test(parsed.pathname)
    ) {
      return `https://publish.twitter.com/oembed?omit_script=true&url=${encodeURIComponent(videoUrl)}`;
    }
  } catch {
    return null;
  }

  return null;
}

/** Декодирует базовые именованные и числовые HTML-сущности. */
export function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&nbsp;', ' ')
    .replace(/&#(\d+);/g, (_match, dec: string) => {
      const codePoint = Number.parseInt(dec, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
    });
}

/** Извлекает заголовок из ответа oEmbed (YouTube или Twitter/X). */
export function parseOembedTitle(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }

  const record = data as Record<string, unknown>;
  if (typeof record.title === 'string' && record.title.trim()) {
    return record.title.trim();
  }

  const authorName = typeof record.author_name === 'string' ? record.author_name.trim() : '';
  if (typeof record.html === 'string' && record.html.trim()) {
    const paragraphMatch = record.html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const rawTweetText = paragraphMatch ? paragraphMatch[1] : record.html;
    const tweetText = decodeHtmlEntities(rawTweetText.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();

    if (tweetText && authorName) {
      const combined = `${authorName}: ${tweetText}`;
      return combined.length > 160 ? `${combined.slice(0, 157)}...` : combined;
    }

    if (tweetText) {
      return tweetText.length > 160 ? `${tweetText.slice(0, 157)}...` : tweetText;
    }
  }

  return authorName || null;
}

/** Извлекает осмысленный заголовок страницы из HTML-разметки (`og:title`, `twitter:title`, `<title>`). */
export function extractHtmlTitle(html: string): string | null {
  const metaPatterns = [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:title["'][^>]*>/i
  ];

  for (const pattern of metaPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const candidate = normalizeHtmlTitle(match[1]);
      if (candidate) {
        return candidate;
      }
    }
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    return normalizeHtmlTitle(titleMatch[1]);
  }

  return null;
}

function normalizeHtmlTitle(rawTitle: string): string | null {
  const decoded = decodeHtmlEntities(rawTitle).replace(/\s+/g, ' ').trim();
  if (!decoded) {
    return null;
  }

  const cleaned = decoded.replace(/\s+-\s+YouTube$/i, '').trim();
  if (!cleaned || GENERIC_HTML_TITLES.has(cleaned.toLowerCase())) {
    return null;
  }

  return cleaned;
}

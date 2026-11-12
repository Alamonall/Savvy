import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import {
  filterTasksBySearch,
  matchesTaskSearch,
  normalizeSearchQuery,
  tokenizeSearchQuery
} from '../src/shared/task-search.ts';
import {
  cleanExtractedFilenameTitle,
  decodeHtmlEntities,
  extractHtmlTitle,
  extractTitleFromLogLines,
  getTwitterOembedUrl,
  getYoutubeOembedUrl,
  isUnresolvedTaskTitle,
  parseOembedTitle,
  parseTitleFromLogLine,
  SAVVY_TITLE_PREFIX
} from '../src/shared/task-title.ts';

const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');
const downloadsService = await readFile(
  new URL('../src/main/services/downloads.service.ts', import.meta.url),
  'utf8'
);
const electronApp = await readFile(
  new URL('../src/main/electron-application.ts', import.meta.url),
  'utf8'
);

test('определяет неразрешённое название задачи по пустой строке или совпадению с URL', () => {
  assert.equal(isUnresolvedTaskTitle({ url: 'https://youtu.be/abc', title: '' }), true);
  assert.equal(
    isUnresolvedTaskTitle({ url: 'https://youtu.be/abc', title: 'https://youtu.be/abc' }),
    true
  );
  assert.equal(
    isUnresolvedTaskTitle({ url: 'https://youtu.be/abc', title: 'Классное видео' }),
    false
  );
});

test('очищает имя файла из лога yt-dlp от пути, потока, расширения и суффикса [id]', () => {
  assert.equal(
    cleanExtractedFilenameTitle('"/Users/test/Videos/Обзор Savvy_[dQw4w9WgXcQ].f137.mp4"'),
    'Обзор Savvy'
  );
  assert.equal(
    cleanExtractedFilenameTitle('C:\\Downloads\\Clip Name_[9OPoi123abc].fhls-720.mp4'),
    'Clip Name'
  );
  assert.equal(cleanExtractedFilenameTitle('/tmp/My Video.info.json'), 'My Video');
  assert.equal(cleanExtractedFilenameTitle('   '), null);
});

test('извлекает название видео из разных форматов строк лога yt-dlp', () => {
  assert.equal(
    parseTitleFromLogLine(`${SAVVY_TITLE_PREFIX}Живой разбор нового релиза`),
    'Живой разбор нового релиза'
  );
  assert.equal(parseTitleFromLogLine(`${SAVVY_TITLE_PREFIX}NA`), null);
  assert.equal(
    parseTitleFromLogLine('[download] Destination: /Users/user/Videos/Demo Video_[abc12345].webm'),
    'Demo Video'
  );
  assert.equal(
    parseTitleFromLogLine('[ExtractAudio] Destination: /Users/user/Music/Podcast Ep 12.mp3'),
    'Podcast Ep 12'
  );
  assert.equal(
    parseTitleFromLogLine('[Merger] Merging formats into "/Users/user/Videos/Final Cut.mkv"'),
    'Final Cut'
  );
  assert.equal(
    parseTitleFromLogLine(
      '[download] /Users/user/Videos/Already Here.mp4 has already been downloaded'
    ),
    'Already Here'
  );
  assert.equal(
    parseTitleFromLogLine('[download] Downloading playlist: Плейлист недели'),
    'Плейлист недели'
  );
  assert.equal(
    extractTitleFromLogLines([
      'Добавлено в очередь.',
      '[youtube] Extracting URL: https://youtu.be/abc',
      `${SAVVY_TITLE_PREFIX}Заголовок из pre_process`,
      '[download] Destination: /tmp/Заголовок из pre_process.mp4'
    ]),
    'Заголовок из pre_process'
  );
});

test('строит oEmbed URL для YouTube и Twitter/X и парсит ответ', () => {
  assert.equal(
    getYoutubeOembedUrl('https://youtu.be/9OPoi123?t=5'),
    'https://www.youtube.com/oembed?url=https%3A%2F%2Fyoutu.be%2F9OPoi123%3Ft%3D5&format=json'
  );
  assert.equal(getYoutubeOembedUrl('https://vimeo.com/123'), null);

  assert.equal(
    getTwitterOembedUrl('https://x.com/the_Mess/status/1234567890'),
    'https://publish.twitter.com/oembed?omit_script=true&url=https%3A%2F%2Fx.com%2Fthe_Mess%2Fstatus%2F1234567890'
  );
  assert.equal(getTwitterOembedUrl('https://x.com/the_Mess'), null);

  assert.equal(parseOembedTitle({ title: '  YouTube Title  ' }), 'YouTube Title');
  assert.equal(
    parseOembedTitle({
      author_name: 'The Mess',
      html: '<blockquote class="twitter-tweet"><p lang="en">Hello &amp; welcome&#39;s!</p></blockquote>'
    }),
    "The Mess: Hello & welcome's!"
  );
  assert.equal(parseOembedTitle(null), null);
});

test('извлекает осмысленный заголовок из HTML и игнорирует заглушки', () => {
  assert.equal(
    decodeHtmlEntities('Tom &amp; Jerry &#39;2026&#39; &#x2014; &quot;Special&quot;'),
    'Tom & Jerry \'2026\' \u2014 "Special"'
  );
  assert.equal(
    extractHtmlTitle(
      '<html><head><meta property="og:title" content="Заголовок из OG &amp; Meta"><title>YouTube</title></head></html>'
    ),
    'Заголовок из OG & Meta'
  );
  assert.equal(
    extractHtmlTitle('<html><head><title>Awesome Clip - YouTube</title></head></html>'),
    'Awesome Clip'
  );
  assert.equal(extractHtmlTitle('<html><head><title>Just a moment...</title></head></html>'), null);
});

test('фильтрует задачи по токенам названия, ссылки, сообщения и статуса', () => {
  assert.equal(normalizeSearchQuery('  Тест  '), 'тест');
  assert.deepEqual(tokenizeSearchQuery('gta   trailer '), ['gta', 'trailer']);

  const tasks = [
    {
      id: '1',
      url: 'https://youtu.be/9OPoi',
      title: 'Grand Theft Auto VI Trailer 2',
      userMessage: null,
      status: 'done'
    },
    {
      id: '2',
      url: 'https://x.com/the_Mess/status/123',
      title: 'The Mess: New teaser clip',
      userMessage: 'Сервер отклонил загрузку видео (HTTP 403)',
      status: 'failed'
    },
    {
      id: '3',
      url: 'https://youtu.be/VoHg',
      title: 'Музыкальный микс 2026',
      userMessage: null,
      status: 'running'
    }
  ];

  const statusLabel = (status) =>
    ({
      queued: 'В очереди',
      running: 'Скачивается',
      done: 'Готово',
      failed: 'Ошибка',
      cancelled: 'Отменено'
    })[status];

  assert.equal(matchesTaskSearch(tasks[0], 'trailer theft', statusLabel(tasks[0].status)), true);
  assert.equal(matchesTaskSearch(tasks[0], 'the_mess', statusLabel(tasks[0].status)), false);
  assert.deepEqual(
    filterTasksBySearch(tasks, 'ошибка 403', statusLabel).map((task) => task.id),
    ['2']
  );
  assert.deepEqual(
    filterTasksBySearch(tasks, 'скачивается микс', statusLabel).map((task) => task.id),
    ['3']
  );
  assert.deepEqual(filterTasksBySearch(tasks, '   ', statusLabel), tasks);
});

test('main-процесс определяет названия через pre_process и фоновую очередь без дубля уведомлений', () => {
  assert.match(downloadsService, /implements OnModuleDestroy/);
  assert.match(downloadsService, /'--no-simulate'/);
  assert.match(downloadsService, /pre_process:\$\{SAVVY_TITLE_PREFIX\}%\(playlist_title,title\)s/);
  assert.match(downloadsService, /partialLogBuffers/);
  assert.match(downloadsService, /flushPartialLogBuffer/);
  assert.match(downloadsService, /extractTitleFromLogLines\(nextTask\.log\)/);
  assert.match(downloadsService, /enqueueTitleResolution/);
  assert.match(electronApp, /notifiedDoneTaskIds/);
});

test('renderer содержит поиск по загрузкам, авто-раскрытие и тёмную тему', () => {
  assert.match(renderer, /id="queue-search"/);
  assert.match(renderer, /id="queue-search-clear"/);
  assert.match(renderer, /filterTasksBySearch\(/);
  assert.match(renderer, /forceExpanded = false/);
  assert.match(renderer, /Ничего не найдено\./);
  assert.match(renderer, /isSettingsUtilitySectionMatching/);
  assert.match(renderer, /KeyF/);
  assert.match(styles, /\.queue-search\s*\{/);
  assert.match(styles, /\[data-theme='dark'\] \.queue-search/);
});

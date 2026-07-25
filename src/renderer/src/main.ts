import type { AppSettings, DownloadTask, FolderEntry, FolderListing } from '../../shared/types';
import './styles.css';

type Tab = 'queue' | 'settings';
type SettingsMode = 'ui' | 'text';
type SettingsOption =
  | {
      key: keyof AppSettings;
      kind: 'checkbox';
      label: string;
      description: string;
      original: string;
    }
  | {
      key: keyof AppSettings;
      kind: 'text' | 'number' | 'path';
      label: string;
      description: string;
      original: string;
      placeholder?: string;
      min?: number;
      max?: number;
    }
  | {
      key: keyof AppSettings;
      kind: 'select';
      label: string;
      description: string;
      original: string;
      options: Array<{ label: string; value: string }>;
    }
  | {
      id: string;
      kind: 'exclusive';
      label: string;
      description: string;
      original: string;
      choices: Array<{
        label: string;
        value: string;
        patch: Partial<AppSettings>;
        isActive: (settings: AppSettings) => boolean;
      }>;
    };
type SettingsOptionGroup = {
  title: string;
  options: SettingsOption[];
};
type ConfigVersion = {
  id: string;
  createdAt: number;
  text: string;
};
type FolderPickerState = {
  targetKey: keyof AppSettings;
  listing: FolderListing | null;
  error: string | null;
  selectedIndex: number;
  suggestions: FolderEntry[];
  pathDraft: string;
  suggestionRequestId: number;
};

const COLLAPSED_DAYS_KEY = 'ytdlp-collapsed-days';
const EXPANDED_URL_GROUPS_KEY = 'ytdlp-expanded-url-groups';
const CONFIG_VERSIONS_KEY = 'ytdlp-config-versions';
const THEME_KEY = 'ytdlp-theme';

type Theme = 'light' | 'dark';

let currentTab: Tab = 'queue';
let settingsMode: SettingsMode = 'ui';
let queue: DownloadTask[] = [];
let selectedTaskId: string | null = null;
let startupError: string | null = null;
let runtimeNotice: string | null = null;
let isConfigModalOpen = false;
let pendingQueue: DownloadTask[] | null = null;
let pendingSelectedTaskId: string | null = null;
let urlDraft = '';
let addMessage: string | null = null;
let settingsMessage: string | null = null;
let effectiveOptionsPreview = '';
let textConfigDraft: string | null = null;
let hideCompleted = localStorage.getItem('ytdlp-hide-completed') === 'true';
let collapsedDays = readCollapsedDays();
let expandedUrlGroups = readExpandedUrlGroups();
let folderPicker: FolderPickerState | null = null;
let theme: Theme = readTheme();
let settings: AppSettings = {
  downloadDir: '',
  maxConcurrentDownloads: 1,
  inheritedConfigPaths: [],
  inlineConfigText: '',
  downloadDirectlyToSelectedFolder: false,
  extractAudio: false,
  audioFormat: 'mp3',
  writeThumbnail: false,
  writeSubtitles: false,
  embedMetadata: true,
  sponsorBlock: false,
  outputTemplate: '%(title)s.%(ext)s',
  pathsTemp: '',
  format: '',
  formatSort: '',
  mergeOutputFormat: '',
  remuxVideo: '',
  recodeVideo: '',
  audioQuality: '',
  subtitlesLangs: '',
  convertSubtitles: '',
  proxy: '',
  socketTimeout: '',
  retries: '',
  fragmentRetries: '',
  concurrentFragments: 1,
  playlistStart: '',
  playlistEnd: '',
  maxDownloads: '',
  dateAfter: '',
  dateBefore: '',
  matchFilter: '',
  downloadArchive: '',
  cookiesFile: '',
  netrc: false,
  netrcLocation: '',
  username: '',
  extractorArgs: '',
  externalDownloader: '',
  externalDownloaderArgs: '',
  ffmpegLocation: '',
  postprocessorArgs: '',
  ignoreErrors: false,
  noWarnings: false,
  forceOverwrites: false,
  noOverwrites: false,
  continueDownload: true,
  noPart: false,
  restrictFilenames: false,
  windowsFilenames: false,
  writeDescription: false,
  writeInfoJson: false,
  writeComments: false,
  writeAutoSubtitles: false,
  embedSubtitles: false,
  embedThumbnail: false,
  splitChapters: false,
  removeChapters: '',
  sponsorBlockMark: '',
  rateLimit: '',
  cookiesFromBrowser: '',
  additionalOptions: ''
};

const SETTINGS_OPTION_GROUPS: SettingsOptionGroup[] = [
  {
    title: 'Главное',
    options: [
      {
        key: 'maxConcurrentDownloads',
        kind: 'number',
        label: 'Одновременные скачивания',
        description: 'Сколько задач приложение запускает параллельно.',
        original: 'Application queue concurrency',
        min: 1,
        max: 8
      },
      {
        key: 'downloadDir',
        kind: 'path',
        label: 'Папка скачивания',
        description: 'Куда сохранять файлы.',
        original: '-P, --paths [TYPES:]PATH',
        placeholder: '/Users/.../Downloads'
      },
      {
        key: 'outputTemplate',
        kind: 'text',
        label: 'Шаблон имени файла',
        description: 'Правило имени выходного файла.',
        original: '-o, --output [TYPES:]TEMPLATE',
        placeholder: '%(title)s.%(ext)s'
      },
      {
        key: 'pathsTemp',
        kind: 'path',
        label: 'Временная папка',
        description: 'Отдельная папка для временных файлов.',
        original: '-P temp:PATH',
        placeholder: '/tmp/yt-dlp'
      },
      {
        key: 'downloadDirectlyToSelectedFolder',
        kind: 'checkbox',
        label: 'Скачивать прямо в выбранную папку',
        description: 'Не создавать дополнительные folder/single подпапки.',
        original: '--paths home:. --paths temp:.'
      }
    ]
  },
  {
    title: 'Выбор видео и плейлисты',
    options: [
      {
        key: 'format',
        kind: 'select',
        label: 'Формат',
        description: 'Фильтр выбора качества и формата.',
        original: '-f, --format FORMAT',
        options: [
          { label: 'По умолчанию yt-dlp', value: '' },
          { label: 'Лучшее качество', value: 'best' },
          { label: 'Лучшее видео + аудио', value: 'bestvideo+bestaudio/best' },
          { label: 'Современный bestvideo/bestaudio', value: 'bv*+ba/b' },
          { label: 'Только аудио', value: 'bestaudio/best' },
          { label: 'Минимальный размер/качество', value: 'worst' }
        ]
      },
      {
        key: 'formatSort',
        kind: 'select',
        label: 'Сортировка форматов',
        description: 'Приоритеты выбора формата.',
        original: '-S, --format-sort SORTORDER',
        options: [
          { label: 'По умолчанию yt-dlp', value: '' },
          { label: 'Разрешение, затем размер', value: 'res,filesize' },
          { label: 'AV1 в приоритете', value: 'res,codec:av1' },
          { label: 'H.264/совместимость', value: 'res,vcodec:h264' },
          { label: 'Минимальный размер', value: 'filesize,res' }
        ]
      },
      {
        key: 'playlistStart',
        kind: 'text',
        label: 'Начать плейлист с',
        description: 'Номер первого элемента плейлиста.',
        original: '--playlist-start NUMBER',
        placeholder: '1'
      },
      {
        key: 'playlistEnd',
        kind: 'text',
        label: 'Закончить плейлист на',
        description: 'Номер последнего элемента плейлиста.',
        original: '--playlist-end NUMBER',
        placeholder: '10'
      },
      {
        key: 'maxDownloads',
        kind: 'text',
        label: 'Максимум загрузок',
        description: 'Остановиться после указанного количества файлов.',
        original: '--max-downloads NUMBER',
        placeholder: '50'
      },
      {
        key: 'matchFilter',
        kind: 'text',
        label: 'Фильтр совпадений',
        description: 'Условие, по которому yt-dlp решает скачивать или пропустить элемент.',
        original: '--match-filters FILTER',
        placeholder: '!is_live & duration < 3600'
      },
      {
        key: 'dateAfter',
        kind: 'text',
        label: 'После даты',
        description: 'Скачивать только видео после даты.',
        original: '--dateafter DATE',
        placeholder: '20240101'
      },
      {
        key: 'dateBefore',
        kind: 'text',
        label: 'До даты',
        description: 'Скачивать только видео до даты.',
        original: '--datebefore DATE',
        placeholder: '20241231'
      },
      {
        key: 'downloadArchive',
        kind: 'path',
        label: 'Архив скачанного',
        description: 'Файл со списком уже скачанных видео.',
        original: '--download-archive FILE',
        placeholder: '/Users/.../archive.txt'
      }
    ]
  },
  {
    title: 'Сеть и повторы',
    options: [
      {
        key: 'proxy',
        kind: 'text',
        label: 'Proxy',
        description: 'Прокси-сервер для запросов.',
        original: '--proxy URL',
        placeholder: 'socks5://127.0.0.1:1080'
      },
      {
        key: 'socketTimeout',
        kind: 'text',
        label: 'Таймаут сокета',
        description: 'Сколько секунд ждать сетевой ответ.',
        original: '--socket-timeout SECONDS',
        placeholder: '20'
      },
      {
        key: 'rateLimit',
        kind: 'text',
        label: 'Лимит скорости',
        description: 'Ограничение скорости загрузки.',
        original: '-r, --limit-rate RATE',
        placeholder: '2M'
      },
      {
        key: 'retries',
        kind: 'text',
        label: 'Повторы',
        description: 'Сколько раз повторять неудачную загрузку.',
        original: '-R, --retries RETRIES',
        placeholder: '10'
      },
      {
        key: 'fragmentRetries',
        kind: 'text',
        label: 'Повторы фрагментов',
        description: 'Сколько раз повторять загрузку отдельного фрагмента.',
        original: '--fragment-retries RETRIES',
        placeholder: '10'
      },
      {
        key: 'concurrentFragments',
        kind: 'number',
        label: 'Параллельные фрагменты',
        description: 'Сколько фрагментов одного видео качать одновременно.',
        original: '-N, --concurrent-fragments N',
        min: 1,
        max: 16
      }
    ]
  },
  {
    title: 'Файлы',
    options: [
      {
        id: 'overwrite-mode',
        kind: 'exclusive',
        label: 'Поведение при существующих файлах',
        description:
          'Эти режимы взаимоисключающие: нельзя одновременно перезаписывать и запрещать перезапись.',
        original: '--force-overwrites / --no-overwrites',
        choices: [
          {
            label: 'По умолчанию yt-dlp',
            value: 'default',
            patch: { forceOverwrites: false, noOverwrites: false },
            isActive: (appSettings) => !appSettings.forceOverwrites && !appSettings.noOverwrites
          },
          {
            label: 'Перезаписывать файлы',
            value: 'force',
            patch: { forceOverwrites: true, noOverwrites: false },
            isActive: (appSettings) => appSettings.forceOverwrites
          },
          {
            label: 'Не перезаписывать файлы',
            value: 'no-overwrite',
            patch: { forceOverwrites: false, noOverwrites: true },
            isActive: (appSettings) => appSettings.noOverwrites
          }
        ]
      },
      {
        key: 'continueDownload',
        kind: 'checkbox',
        label: 'Продолжать недокачанное',
        description: 'Продолжать частично скачанные файлы.',
        original: '-c, --continue'
      },
      {
        key: 'noPart',
        kind: 'checkbox',
        label: 'Не использовать .part',
        description: 'Писать сразу в конечный файл.',
        original: '--no-part'
      },
      {
        key: 'restrictFilenames',
        kind: 'checkbox',
        label: 'Ограниченные имена файлов',
        description: 'Использовать только безопасные символы в именах.',
        original: '--restrict-filenames'
      },
      {
        key: 'windowsFilenames',
        kind: 'checkbox',
        label: 'Windows-совместимые имена',
        description: 'Избегать символов, запрещенных в Windows.',
        original: '--windows-filenames'
      }
    ]
  },
  {
    title: 'Медиа и постобработка',
    options: [
      {
        key: 'extractAudio',
        kind: 'checkbox',
        label: 'Извлекать аудио',
        description: 'Конвертировать загруженный файл в аудио.',
        original: '-x, --extract-audio'
      },
      {
        key: 'audioFormat',
        kind: 'select',
        label: 'Формат аудио',
        description: 'Формат для извлеченного аудио.',
        original: '--audio-format FORMAT',
        options: [
          { label: 'best', value: 'best' },
          { label: 'mp3', value: 'mp3' },
          { label: 'm4a', value: 'm4a' },
          { label: 'opus', value: 'opus' },
          { label: 'vorbis', value: 'vorbis' },
          { label: 'wav', value: 'wav' },
          { label: 'flac', value: 'flac' },
          { label: 'alac', value: 'alac' }
        ]
      },
      {
        key: 'audioQuality',
        kind: 'text',
        label: 'Качество аудио',
        description: 'Качество кодирования аудио.',
        original: '--audio-quality QUALITY',
        placeholder: '0'
      },
      {
        key: 'mergeOutputFormat',
        kind: 'select',
        label: 'Формат объединения',
        description: 'Контейнер для объединенного видео.',
        original: '--merge-output-format FORMAT',
        options: [
          { label: 'Не указывать', value: '' },
          { label: 'mp4', value: 'mp4' },
          { label: 'mkv', value: 'mkv' },
          { label: 'webm', value: 'webm' },
          { label: 'flv', value: 'flv' },
          { label: 'avi', value: 'avi' },
          { label: 'mov', value: 'mov' }
        ]
      },
      {
        id: 'video-conversion-mode',
        kind: 'exclusive',
        label: 'Перепаковка/перекодирование видео',
        description:
          'Remux и recode взаимоисключающие: remux меняет контейнер без перекодирования, recode перекодирует.',
        original: '--remux-video / --recode-video',
        choices: [
          {
            label: 'Не использовать',
            value: 'none',
            patch: { remuxVideo: '', recodeVideo: '' },
            isActive: (appSettings) => !appSettings.remuxVideo && !appSettings.recodeVideo
          },
          {
            label: 'Remux в mp4',
            value: 'remux-mp4',
            patch: { remuxVideo: 'mp4', recodeVideo: '' },
            isActive: (appSettings) => appSettings.remuxVideo === 'mp4'
          },
          {
            label: 'Remux в mkv',
            value: 'remux-mkv',
            patch: { remuxVideo: 'mkv', recodeVideo: '' },
            isActive: (appSettings) => appSettings.remuxVideo === 'mkv'
          },
          {
            label: 'Remux в webm',
            value: 'remux-webm',
            patch: { remuxVideo: 'webm', recodeVideo: '' },
            isActive: (appSettings) => appSettings.remuxVideo === 'webm'
          },
          {
            label: 'Recode в mp4',
            value: 'recode-mp4',
            patch: { remuxVideo: '', recodeVideo: 'mp4' },
            isActive: (appSettings) => appSettings.recodeVideo === 'mp4'
          },
          {
            label: 'Recode в mkv',
            value: 'recode-mkv',
            patch: { remuxVideo: '', recodeVideo: 'mkv' },
            isActive: (appSettings) => appSettings.recodeVideo === 'mkv'
          },
          {
            label: 'Recode в webm',
            value: 'recode-webm',
            patch: { remuxVideo: '', recodeVideo: 'webm' },
            isActive: (appSettings) => appSettings.recodeVideo === 'webm'
          }
        ]
      },
      {
        key: 'ffmpegLocation',
        kind: 'path',
        label: 'Путь к ffmpeg',
        description: 'Папка или бинарник ffmpeg.',
        original: '--ffmpeg-location PATH',
        placeholder: '/opt/homebrew/bin'
      },
      {
        key: 'postprocessorArgs',
        kind: 'text',
        label: 'Аргументы постпроцессора',
        description: 'Дополнительные аргументы для ffmpeg/постпроцессоров.',
        original: '--postprocessor-args NAME:ARGS',
        placeholder: 'ffmpeg:-threads 4'
      }
    ]
  },
  {
    title: 'Субтитры и метаданные',
    options: [
      {
        key: 'writeThumbnail',
        kind: 'checkbox',
        label: 'Скачивать обложку',
        description: 'Сохранить thumbnail рядом с файлом.',
        original: '--write-thumbnail'
      },
      {
        key: 'embedThumbnail',
        kind: 'checkbox',
        label: 'Встраивать обложку',
        description: 'Встроить thumbnail в медиафайл.',
        original: '--embed-thumbnail'
      },
      {
        key: 'writeSubtitles',
        kind: 'checkbox',
        label: 'Скачивать субтитры',
        description: 'Сохранить обычные субтитры.',
        original: '--write-subs'
      },
      {
        key: 'writeAutoSubtitles',
        kind: 'checkbox',
        label: 'Автосубтитры',
        description: 'Скачать автоматически созданные субтитры.',
        original: '--write-auto-subs'
      },
      {
        key: 'subtitlesLangs',
        kind: 'text',
        label: 'Языки субтитров',
        description: 'Список языков субтитров.',
        original: '--sub-langs LANGS',
        placeholder: 'ru,en.*'
      },
      {
        key: 'convertSubtitles',
        kind: 'select',
        label: 'Конвертировать субтитры',
        description: 'Формат, в который перевести субтитры.',
        original: '--convert-subs FORMAT',
        options: [
          { label: 'Не конвертировать', value: '' },
          { label: 'srt', value: 'srt' },
          { label: 'vtt', value: 'vtt' },
          { label: 'ass', value: 'ass' },
          { label: 'lrc', value: 'lrc' }
        ]
      },
      {
        key: 'embedSubtitles',
        kind: 'checkbox',
        label: 'Встраивать субтитры',
        description: 'Встроить субтитры в видео.',
        original: '--embed-subs'
      },
      {
        key: 'embedMetadata',
        kind: 'checkbox',
        label: 'Встраивать метаданные',
        description: 'Добавить метаданные в итоговый файл.',
        original: '--embed-metadata'
      },
      {
        key: 'writeDescription',
        kind: 'checkbox',
        label: 'Сохранять описание',
        description: 'Записать описание видео в отдельный файл.',
        original: '--write-description'
      },
      {
        key: 'writeInfoJson',
        kind: 'checkbox',
        label: 'Сохранять info.json',
        description: 'Сохранить метаданные yt-dlp в JSON.',
        original: '--write-info-json'
      },
      {
        key: 'writeComments',
        kind: 'checkbox',
        label: 'Сохранять комментарии',
        description: 'Включить комментарии в info.json, если extractor поддерживает.',
        original: '--write-comments'
      }
    ]
  },
  {
    title: 'SponsorBlock и главы',
    options: [
      {
        key: 'sponsorBlock',
        kind: 'checkbox',
        label: 'Удалять SponsorBlock-сегменты',
        description: 'Удалить sponsor/selfpromo/interaction сегменты.',
        original: '--sponsorblock-remove CATS'
      },
      {
        key: 'sponsorBlockMark',
        kind: 'select',
        label: 'Помечать SponsorBlock',
        description: 'Добавить главы для указанных категорий.',
        original: '--sponsorblock-mark CATS',
        options: [
          { label: 'Не помечать', value: '' },
          { label: 'Все категории', value: 'all' },
          { label: 'Спонсор', value: 'sponsor' },
          { label: 'Самореклама', value: 'selfpromo' },
          { label: 'Взаимодействие', value: 'interaction' },
          { label: 'Интро', value: 'intro' },
          { label: 'Аутро', value: 'outro' },
          { label: 'Музыкальный оффтоп', value: 'music_offtopic' }
        ]
      },
      {
        key: 'splitChapters',
        kind: 'checkbox',
        label: 'Разделять главы',
        description: 'Разделить видео по главам.',
        original: '--split-chapters'
      },
      {
        key: 'removeChapters',
        kind: 'text',
        label: 'Удалить главы по regexp',
        description: 'Удалить фрагменты, чьи главы совпадают с регулярным выражением.',
        original: '--remove-chapters REGEX',
        placeholder: '"Sponsor|Intro"'
      }
    ]
  },
  {
    title: 'Аутентификация и extractors',
    options: [
      {
        id: 'cookies-source',
        kind: 'exclusive',
        label: 'Источник cookies',
        description: 'Выберите один способ передачи cookies.',
        original: '--cookies-from-browser / --cookies',
        choices: [
          {
            label: 'Не использовать cookies',
            value: 'none',
            patch: { cookiesFromBrowser: '', cookiesFile: '' },
            isActive: (appSettings) => !appSettings.cookiesFromBrowser && !appSettings.cookiesFile
          },
          {
            label: 'Из браузера',
            value: 'browser',
            patch: { cookiesFile: '' },
            isActive: (appSettings) => Boolean(appSettings.cookiesFromBrowser)
          },
          {
            label: 'Из файла',
            value: 'file',
            patch: { cookiesFromBrowser: '' },
            isActive: (appSettings) => Boolean(appSettings.cookiesFile)
          }
        ]
      },
      {
        key: 'cookiesFromBrowser',
        kind: 'select',
        label: 'Cookies из браузера',
        description: 'Загрузить cookies из профиля браузера.',
        original: '--cookies-from-browser BROWSER',
        options: [
          { label: 'Не выбрано', value: '' },
          { label: 'Chrome', value: 'chrome' },
          { label: 'Chromium', value: 'chromium' },
          { label: 'Firefox', value: 'firefox' },
          { label: 'Safari', value: 'safari' },
          { label: 'Edge', value: 'edge' },
          { label: 'Brave', value: 'brave' },
          { label: 'Opera', value: 'opera' },
          { label: 'Vivaldi', value: 'vivaldi' }
        ]
      },
      {
        key: 'cookiesFile',
        kind: 'path',
        label: 'Cookies-файл',
        description: 'Файл cookies в Netscape-формате.',
        original: '--cookies FILE',
        placeholder: '/Users/.../cookies.txt'
      },
      {
        key: 'netrc',
        kind: 'checkbox',
        label: 'Использовать .netrc',
        description: 'Брать логин/пароль из netrc.',
        original: '--netrc'
      },
      {
        key: 'netrcLocation',
        kind: 'path',
        label: 'Путь к netrc',
        description: 'Где лежит netrc-файл.',
        original: '--netrc-location PATH',
        placeholder: '/Users/.../.netrc'
      },
      {
        key: 'username',
        kind: 'text',
        label: 'Имя пользователя',
        description: 'Логин для сайта. Пароль лучше передавать вручную, не сохранять в настройках.',
        original: '-u, --username USERNAME'
      },
      {
        key: 'extractorArgs',
        kind: 'text',
        label: 'Аргументы extractor',
        description: 'Специальные параметры extractor.',
        original: '--extractor-args IE_KEY:ARGS',
        placeholder: 'youtube:player_client=web'
      }
    ]
  },
  {
    title: 'Внешние загрузчики и диагностика',
    options: [
      {
        key: 'externalDownloader',
        kind: 'select',
        label: 'Внешний загрузчик',
        description: 'Использовать aria2c, curl, wget или другой загрузчик.',
        original: '--downloader NAME',
        options: [
          { label: 'Встроенный загрузчик yt-dlp', value: '' },
          { label: 'aria2c', value: 'aria2c' },
          { label: 'curl', value: 'curl' },
          { label: 'wget', value: 'wget' },
          { label: 'httpie', value: 'httpie' },
          { label: 'ffmpeg', value: 'ffmpeg' }
        ]
      },
      {
        key: 'externalDownloaderArgs',
        kind: 'text',
        label: 'Аргументы загрузчика',
        description: 'Дополнительные аргументы для внешнего загрузчика.',
        original: '--downloader-args NAME:ARGS',
        placeholder: 'aria2c:-x 8 -s 8'
      },
      {
        key: 'ignoreErrors',
        kind: 'checkbox',
        label: 'Игнорировать ошибки',
        description: 'Продолжать плейлист после ошибки.',
        original: '-i, --ignore-errors'
      },
      {
        key: 'noWarnings',
        kind: 'checkbox',
        label: 'Не показывать предупреждения',
        description: 'Скрыть предупреждения yt-dlp.',
        original: '--no-warnings'
      },
      {
        key: 'additionalOptions',
        kind: 'text',
        label: 'Дополнительные аргументы',
        description: 'Для редких или новых опций yt-dlp, которых еще нет в UI.',
        original: 'Any yt-dlp option',
        placeholder: '--compat-options no-youtube-unavailable-videos'
      }
    ]
  }
];

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('App root is missing.');
}

const appRoot = app;

function buildEffectiveOptionsPreview(nextSettings: AppSettings): string {
  const options = [
    nextSettings.extractAudio ? '--extract-audio' : '',
    nextSettings.extractAudio && nextSettings.audioFormat
      ? `--audio-format ${nextSettings.audioFormat}`
      : '',
    nextSettings.writeThumbnail ? '--write-thumbnail' : '',
    nextSettings.writeSubtitles ? '--write-subs' : '',
    nextSettings.embedMetadata ? '--embed-metadata' : '',
    nextSettings.sponsorBlock ? '--sponsorblock-remove all' : '',
    nextSettings.outputTemplate ? `--output "${nextSettings.outputTemplate}"` : '',
    nextSettings.rateLimit ? `--limit-rate ${nextSettings.rateLimit}` : '',
    nextSettings.cookiesFromBrowser
      ? `--cookies-from-browser ${nextSettings.cookiesFromBrowser}`
      : '',
    nextSettings.inlineConfigText.trim(),
    nextSettings.additionalOptions.trim()
  ].filter(Boolean);

  return options.join('\n');
}

function installBrowserPreviewApi(): void {
  let previewSettings = { ...settings };
  let previewQueue: DownloadTask[] = [];
  let taskCounter = 0;
  const listeners = new Set<(update: { task: DownloadTask; queue: DownloadTask[] }) => void>();

  const emitQueueUpdate = (task: DownloadTask): void => {
    const queueSnapshot = previewQueue.map((item) => ({ ...item, log: [...item.log] }));
    listeners.forEach((listener) => listener({ task, queue: queueSnapshot }));
  };

  const finishPreviewTask = (taskId: string): void => {
    const task = previewQueue.find((item) => item.id === taskId);

    if (!task || task.status !== 'running') {
      return;
    }

    task.status = 'done';
    task.progress = 100;
    task.finishedAt = Date.now();
    task.log = [
      ...task.log,
      'Browser preview: задача завершена без запуска yt-dlp.',
      'Для реального скачивания используй окно Electron.'
    ];
    emitQueueUpdate(task);
  };

  window.ytdlp = {
    async addDownload(payload) {
      const now = Date.now();
      const task: DownloadTask = {
        id: `preview-${now}-${taskCounter++}`,
        url: payload.url,
        title: payload.url,
        optionsText: payload.optionsText,
        downloadDir: payload.downloadDir.trim() || previewSettings.downloadDir || 'Browser preview',
        status: 'running',
        createdAt: now,
        startedAt: now,
        progress: 15,
        userMessage: 'Preview-режим: yt-dlp не запускается в боковой панели.',
        log: [
          'Browser preview mode.',
          'Electron preload API недоступен в T3 Code browser preview.',
          `Ссылка добавлена в демонстрационную очередь: ${payload.url}`
        ]
      };

      previewQueue = [task, ...previewQueue];
      emitQueueUpdate(task);
      window.setTimeout(() => finishPreviewTask(task.id), 900);

      return task;
    },
    async retryDownload(taskId) {
      const task = previewQueue.find((item) => item.id === taskId);

      if (!task) {
        throw new Error('Задача не найдена.');
      }

      task.status = 'running';
      task.progress = 15;
      task.startedAt = Date.now();
      task.finishedAt = undefined;
      task.log = [...task.log, 'Повторный запуск preview-задачи.'];
      emitQueueUpdate(task);
      window.setTimeout(() => finishPreviewTask(task.id), 900);

      return task;
    },
    async removeDownload(taskId) {
      previewQueue = previewQueue.filter((task) => task.id !== taskId);
      return previewQueue;
    },
    async getQueue() {
      return previewQueue;
    },
    async getSettings() {
      return previewSettings;
    },
    async updateSettings(nextSettings) {
      previewSettings = { ...nextSettings };
      return previewSettings;
    },
    async getEffectiveOptionsPreview() {
      return buildEffectiveOptionsPreview(previewSettings);
    },
    async listFolderDirectories(currentPath) {
      const path = currentPath || previewSettings.downloadDir || 'Browser preview';
      return {
        path,
        displayPath: path,
        parentPath: null,
        directories: []
      };
    },
    async suggestFolderDirectories() {
      return [];
    },
    async importConfigFile() {
      throw new Error('Импорт через диалог доступен только в Electron.');
    },
    async importConfigFileByPath(filePath) {
      previewSettings = {
        ...previewSettings,
        inlineConfigText: filePath
          ? `# Preview import from ${filePath}`
          : previewSettings.inlineConfigText
      };
      return previewSettings;
    },
    async clearHistory() {
      previewQueue = [];
      return previewQueue;
    },
    async openUrl(url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    async openFolder() {
      return undefined;
    },
    onQueueUpdate(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    }
  };
}

if (!window.ytdlp) {
  installBrowserPreviewApi();
  runtimeNotice =
    'Открыт browser preview без Electron preload API. Интерфейс работает в preview-режиме; реальные скачивания доступны в окне Electron.';
}

const requiredApiMethods: Array<keyof typeof window.ytdlp> = [
  'getSettings',
  'updateSettings',
  'importConfigFile',
  'importConfigFileByPath'
];

if (!window.ytdlp) {
  appRoot.innerHTML = `
    <main class="shell">
      <section class="panel startup-error">
        <h1>Savvy</h1>
        <p>Не удалось загрузить Electron preload API. Перезапустите приложение и проверьте консоль запуска.</p>
      </section>
    </main>
  `;
  throw new Error('Electron preload API is unavailable.');
}

if (requiredApiMethods.some((methodName) => typeof window.ytdlp[methodName] !== 'function')) {
  appRoot.innerHTML = `
    <main class="shell">
      <section class="panel startup-error">
        <h1>Savvy</h1>
        <p>Electron preload устарел. Полностью перезапустите приложение, чтобы загрузить новые настройки.</p>
      </section>
    </main>
  `;
  throw new Error('Electron preload API is outdated.');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatStatus(status: DownloadTask['status']): string {
  const labels: Record<DownloadTask['status'], string> = {
    queued: 'В очереди',
    running: 'Скачивается',
    done: 'Готово',
    failed: 'Ошибка'
  };

  return labels[status];
}

function formatProgress(task: DownloadTask): string {
  return typeof task.progress === 'number' ? `${task.progress.toFixed(1)}%` : '—';
}

function renderTaskHint(task: DownloadTask): string {
  return task.userMessage ? `<span class="task-hint">${escapeHtml(task.userMessage)}</span>` : '';
}

function renderTaskLog(task: DownloadTask): string {
  const logText = task.log.length ? task.log.slice(-120).join('\n') : 'Лог пока пуст.';

  return `
    <pre class="task-log" aria-label="Лог задачи">${escapeHtml(
      [
        `Ссылка: ${task.url}`,
        `Название: ${task.title || task.url}`,
        `Папка: ${task.downloadDir}`,
        `Аргументы: ${task.optionsText || 'без дополнительных аргументов'}`,
        ...(task.userMessage ? ['', `Причина: ${task.userMessage}`] : []),
        '',
        logText
      ].join('\n')
    )}</pre>
  `;
}

function isUrlInputActive(): boolean {
  return currentTab === 'queue' && document.activeElement?.id === 'url-input';
}

function applyPendingQueue(): void {
  if (!pendingQueue || isUrlInputActive()) {
    return;
  }

  queue = pendingQueue;
  pendingQueue = null;

  if (pendingSelectedTaskId) {
    selectedTaskId = pendingSelectedTaskId;
    pendingSelectedTaskId = null;
  }

  render();
}

function getVisibleQueue(): DownloadTask[] {
  return hideCompleted
    ? queue.filter((task) => task.status !== 'done' && task.status !== 'failed')
    : queue;
}

function formatQueueCount(tasks: DownloadTask[]): string {
  const uniqueUrls = new Set(tasks.map((task) => task.url)).size;
  return `${tasks.length} задач · ${uniqueUrls} уникальных ссылок`;
}

function readExpandedUrlGroups(): Record<string, boolean> {
  const rawValue = localStorage.getItem(EXPANDED_URL_GROUPS_KEY);
  if (!rawValue) {
    return {};
  }

  try {
    return JSON.parse(rawValue) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function saveExpandedUrlGroups(): void {
  localStorage.setItem(EXPANDED_URL_GROUPS_KEY, JSON.stringify(expandedUrlGroups));
}

function readCollapsedDays(): Record<string, boolean> {
  const rawValue = localStorage.getItem(COLLAPSED_DAYS_KEY);
  if (!rawValue) {
    return {};
  }

  try {
    return JSON.parse(rawValue) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function saveCollapsedDays(): void {
  localStorage.setItem(COLLAPSED_DAYS_KEY, JSON.stringify(collapsedDays));
}

function readConfigVersions(): ConfigVersion[] {
  const rawValue = localStorage.getItem(CONFIG_VERSIONS_KEY);
  if (!rawValue) {
    return [];
  }

  try {
    const versions = JSON.parse(rawValue) as ConfigVersion[];
    return Array.isArray(versions) ? versions : [];
  } catch {
    return [];
  }
}

function saveConfigVersion(text: string): ConfigVersion[] {
  const versions = readConfigVersions();
  const nextVersions = [
    {
      id: `${Date.now()}`,
      createdAt: Date.now(),
      text
    },
    ...versions
  ].slice(0, 20);

  localStorage.setItem(CONFIG_VERSIONS_KEY, JSON.stringify(nextVersions));
  return nextVersions;
}

function getCurrentConfigText(): string {
  return (textConfigDraft ?? (settings.inlineConfigText || effectiveOptionsPreview)).trim();
}

function getSavedConfigText(): string {
  return (settings.inlineConfigText || effectiveOptionsPreview).trim();
}

function buildConfigDiff(previousText: string, nextText: string): string {
  const previousLines = previousText ? previousText.split(/\r?\n/) : [];
  const nextLines = nextText ? nextText.split(/\r?\n/) : [];
  const previousSet = new Set(previousLines);
  const nextSet = new Set(nextLines);
  const removed = previousLines.filter((line) => !nextSet.has(line)).map((line) => `- ${line}`);
  const added = nextLines.filter((line) => !previousSet.has(line)).map((line) => `+ ${line}`);

  if (!removed.length && !added.length) {
    return 'Изменений нет.';
  }

  return [...removed, ...added].join('\n');
}

function getConfigVersionsMarkup(): string {
  const versions = readConfigVersions();
  if (!versions.length) {
    return '<p class="hint">Версий пока нет. Первая версия появится после сохранения текста.</p>';
  }

  return `
    <ol class="config-versions">
      ${versions
        .map(
          (version) => `
            <li>
              <button class="text-link" data-load-config-version="${version.id}" type="button">
                ${escapeHtml(new Date(version.createdAt).toLocaleString('ru-RU'))}
              </button>
              <span>${version.text.split(/\r?\n/).filter(Boolean).length} строк</span>
            </li>
          `
        )
        .join('')}
    </ol>
  `;
}

function renderSettingsModeTabs(): string {
  return `
    <div class="settings-mode-tabs" aria-label="Формат настроек">
      <button class="settings-mode-tab ${settingsMode === 'ui' ? 'active' : ''}" data-settings-mode="ui" type="button">UI</button>
      <button class="settings-mode-tab ${settingsMode === 'text' ? 'active' : ''}" data-settings-mode="text" type="button">Текстом</button>
    </div>
  `;
}

function renderOriginalTextButton(option: SettingsOption): string {
  return `<button class="eng-help" type="button" title="${escapeHtml(option.original)}" aria-label="Оригинальный текст опции">Eng</button>`;
}

function getExclusiveChoiceValue(option: Extract<SettingsOption, { kind: 'exclusive' }>): string {
  return (
    option.choices.find((choice) => choice.isActive(settings))?.value ?? option.choices[0].value
  );
}

function renderSelectOptions(
  options: Array<{ label: string; value: string }>,
  currentValue: string
): string {
  return options
    .map(
      (item) =>
        `<option value="${escapeHtml(item.value)}" ${item.value === currentValue ? 'selected' : ''}>${escapeHtml(item.label)}</option>`
    )
    .join('');
}

function renderSettingsOption(option: SettingsOption): string {
  if (option.kind === 'exclusive') {
    return `
      <div class="settings-option">
        <div class="settings-option-copy">
          <label class="settings-option-title" for="setting-exclusive-${option.id}">${escapeHtml(option.label)} ${renderOriginalTextButton(option)}</label>
          <span class="settings-option-description">${escapeHtml(option.description)}</span>
        </div>
        <select id="setting-exclusive-${option.id}" data-setting-exclusive="${option.id}">
          ${renderSelectOptions(option.choices, getExclusiveChoiceValue(option))}
        </select>
      </div>
    `;
  }

  const value = settings[option.key];

  if (option.kind === 'checkbox') {
    return `
      <label class="settings-option">
        <input data-setting-checkbox="${String(option.key)}" type="checkbox" ${value ? 'checked' : ''} />
        <span class="settings-option-copy">
          <span class="settings-option-title">${escapeHtml(option.label)} ${renderOriginalTextButton(option)}</span>
          <span class="settings-option-description">${escapeHtml(option.description)}</span>
        </span>
      </label>
    `;
  }

  if (option.kind === 'select') {
    return `
      <div class="settings-option">
        <div class="settings-option-copy">
          <label class="settings-option-title" for="setting-${String(option.key)}">${escapeHtml(option.label)} ${renderOriginalTextButton(option)}</label>
          <span class="settings-option-description">${escapeHtml(option.description)}</span>
        </div>
        <select id="setting-${String(option.key)}" data-setting-input="${String(option.key)}">
          ${renderSelectOptions(option.options, String(value ?? ''))}
        </select>
      </div>
    `;
  }

  const inputType = option.kind === 'number' ? 'number' : 'text';
  const min = option.kind === 'number' && option.min !== undefined ? ` min="${option.min}"` : '';
  const max = option.kind === 'number' && option.max !== undefined ? ` max="${option.max}"` : '';
  const pathDatalist = option.kind === 'path' ? ` list="path-suggestions"` : '';

  return `
    <div class="settings-option">
      <div class="settings-option-copy">
        <label class="settings-option-title" for="setting-${String(option.key)}">${escapeHtml(option.label)} ${renderOriginalTextButton(option)}</label>
        <span class="settings-option-description">${escapeHtml(option.description)}</span>
      </div>
      <div class="${option.kind === 'path' ? 'settings-path-row' : ''}">
        <input id="setting-${String(option.key)}" data-setting-input="${String(option.key)}" type="${inputType}" value="${escapeHtml(String(value ?? ''))}" placeholder="${escapeHtml(option.placeholder ?? '')}"${min}${max}${pathDatalist} />
        ${
          option.kind === 'path'
            ? `<button class="ghost bordered" data-choose-setting-path="${String(option.key)}" type="button">Выбрать</button>`
            : ''
        }
      </div>
    </div>
  `;
}

function renderSettingsUiPanel(inheritedConfigText: string): string {
  return `
    <section class="settings-list">
      <datalist id="path-suggestions">
        <option value="${escapeHtml(settings.downloadDir)}"></option>
        <option value="~/Downloads"></option>
        <option value="~/Desktop"></option>
        <option value="/tmp"></option>
      </datalist>
      ${SETTINGS_OPTION_GROUPS.map(
        (group) => `
          <section class="panel settings-panel settings-list-panel">
            <div class="section-head">
              <h2>${escapeHtml(group.title)}</h2>
              <span>${group.options.length} опций</span>
            </div>
            <div class="settings-options">
              ${group.options.map((option) => renderSettingsOption(option)).join('')}
            </div>
          </section>
        `
      ).join('')}
      <section class="panel settings-panel settings-list-panel">
        <div class="section-head">
          <h2>Унаследовано из yt-dlp</h2>
          <span>config files</span>
        </div>
        <div class="inherited-box">
          <ul>${inheritedConfigText}</ul>
        </div>
        <button class="danger" id="clear-history" type="button">Очистить историю</button>
      </section>
    </section>
  `;
}

function renderSettingsTextPanel(): string {
  const currentText = getCurrentConfigText();
  const savedText = getSavedConfigText();
  const isDirty = currentText !== savedText;
  const versions = readConfigVersions();
  const previousText = versions.at(0)?.text ?? savedText;

  return `
    <section class="settings-grid text-config-grid">
      <div class="panel settings-panel">
        <div class="section-head">
          <h2>Config yt-dlp текстом</h2>
          <span>${isDirty ? 'есть изменения' : 'сохранено'}</span>
        </div>
        <textarea class="config-textarea" id="text-config-input" spellcheck="false" placeholder="--extract-audio&#10;--audio-format mp3">${escapeHtml(currentText)}</textarea>
        <div class="modal-actions">
          <button class="ghost bordered" id="reset-text-config" type="button">Сбросить</button>
          <button class="primary" id="save-text-config" type="button" ${isDirty ? '' : 'disabled'}>Сохранить</button>
        </div>
      </div>
      <div class="settings-stack">
        <div class="panel settings-panel">
          <div class="section-head">
            <h2>Diff</h2>
            <span>с предыдущей версией</span>
          </div>
          <pre class="options-preview diff-preview" id="config-diff">${escapeHtml(buildConfigDiff(previousText, currentText))}</pre>
        </div>
        <div class="panel settings-panel">
          <div class="section-head">
            <h2>Версии</h2>
            <span>${versions.length}</span>
          </div>
          ${getConfigVersionsMarkup()}
        </div>
      </div>
    </section>
  `;
}

async function updateLocalSettings(partialSettings: Partial<AppSettings>): Promise<void> {
  const nextSettings: AppSettings = {
    ...settings,
    ...partialSettings,
    maxConcurrentDownloads: Math.max(
      1,
      Math.min(
        8,
        Math.floor(
          Number(partialSettings.maxConcurrentDownloads ?? settings.maxConcurrentDownloads)
        )
      )
    ),
    concurrentFragments: Math.max(
      1,
      Math.min(
        16,
        Math.floor(Number(partialSettings.concurrentFragments ?? settings.concurrentFragments))
      )
    )
  };

  settings = await window.ytdlp.updateSettings(nextSettings);
  effectiveOptionsPreview = await window.ytdlp.getEffectiveOptionsPreview();
  refreshSettingsPanelView();
}

function refreshSettingsPanelView(): void {
  if (currentTab !== 'settings') {
    return;
  }

  const optionsPreview = document.querySelector<HTMLElement>('#effective-options-preview');

  if (optionsPreview) {
    optionsPreview.textContent = effectiveOptionsPreview || 'Без дополнительных аргументов';
  }
}

function renderSettingsPanel(): string {
  const inheritedConfigText = settings.inheritedConfigPaths.length
    ? settings.inheritedConfigPaths.map((filePath) => `<li>${escapeHtml(filePath)}</li>`).join('')
    : '<li>Конфиги yt-dlp не найдены</li>';

  return `
    <section class="settings-screen">
      ${renderSettingsModeTabs()}
      ${settingsMode === 'ui' ? renderSettingsUiPanel(inheritedConfigText) : renderSettingsTextPanel()}
      <section class="panel settings-panel command-preview-panel">
        <div class="section-head">
          <h2>Итоговая команда</h2>
          <span>Перед ссылкой</span>
        </div>
        <pre class="options-preview" id="effective-options-preview">${escapeHtml(
          effectiveOptionsPreview || 'Без дополнительных аргументов'
        )}</pre>
        ${settingsMessage ? `<p class="hint">${escapeHtml(settingsMessage)}</p>` : ''}
      </section>
    </section>
  `;
}

function renderConfigModal(): string {
  if (!isConfigModalOpen) {
    return '';
  }

  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="config-modal-title">
        <div class="section-head">
          <h2 id="config-modal-title">Config yt-dlp</h2>
          <button class="ghost bordered" id="close-config-modal" type="button">Закрыть</button>
        </div>
        <textarea id="inline-config-text" spellcheck="false" placeholder="Например:&#10;--extract-audio&#10;--audio-format mp3">${escapeHtml(
          settings.inlineConfigText
        )}</textarea>
        <div class="modal-actions">
          <button class="ghost bordered" id="clear-inline-config" type="button">Очистить</button>
          <button class="primary" id="save-inline-config" type="button">Сохранить</button>
        </div>
      </section>
    </div>
  `;
}

function getDayKey(dateValue: string | number | Date): string {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function formatDayLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const todayKey = getDayKey(today);
  const yesterdayKey = getDayKey(yesterday);

  if (dayKey === todayKey) {
    return 'Сегодня';
  }

  if (dayKey === yesterdayKey) {
    return 'Вчера';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function groupQueueByDay(tasks: DownloadTask[]): Array<{
  dayKey: string;
  label: string;
  tasks: DownloadTask[];
  doneCount: number;
  failedCount: number;
  totalCount: number;
}> {
  const groups = new Map<string, DownloadTask[]>();

  tasks.forEach((task) => {
    const dayKey = getDayKey(task.createdAt);
    const existingGroup = groups.get(dayKey);

    if (existingGroup) {
      existingGroup.push(task);
      return;
    }

    groups.set(dayKey, [task]);
  });

  return [...groups.entries()]
    .sort(([leftDayKey], [rightDayKey]) => rightDayKey.localeCompare(leftDayKey))
    .map(([dayKey, groupedTasks]) => {
      const doneCount = groupedTasks.filter((task) => task.status === 'done').length;
      const failedCount = groupedTasks.filter((task) => task.status === 'failed').length;

      return {
        dayKey,
        label: formatDayLabel(dayKey),
        tasks: groupedTasks,
        doneCount,
        failedCount,
        totalCount: groupedTasks.length
      };
    });
}

function groupTasksByUrl(tasks: DownloadTask[]): Array<{
  url: string;
  tasks: DownloadTask[];
}> {
  const groups = new Map<string, DownloadTask[]>();

  tasks.forEach((task) => {
    const existingGroup = groups.get(task.url);

    if (existingGroup) {
      existingGroup.push(task);
      return;
    }

    groups.set(task.url, [task]);
  });

  return [...groups.entries()].map(([url, groupedTasks]) => ({ url, tasks: groupedTasks }));
}

function getUrlGroupKey(dayKey: string, url: string): string {
  return `${dayKey}:${url}`;
}

function getUrlGroupProgress(tasks: DownloadTask[]): string {
  const progressValues = tasks
    .map((task) => task.progress)
    .filter((progress): progress is number => typeof progress === 'number');

  if (!progressValues.length) {
    return '—';
  }

  const progress =
    progressValues.reduce((total, value) => total + value, 0) / progressValues.length;
  return `${progress.toFixed(1)}%`;
}

function getUrlGroupStatus(tasks: DownloadTask[]): DownloadTask['status'] {
  if (tasks.some((task) => task.status === 'running')) {
    return 'running';
  }

  if (tasks.some((task) => task.status === 'queued')) {
    return 'queued';
  }

  if (tasks.some((task) => task.status === 'failed')) {
    return 'failed';
  }

  return 'done';
}

function renderUrlTaskGroupMarkup(
  dayKey: string,
  url: string,
  tasks: DownloadTask[],
  selectedTask: DownloadTask | null
): string {
  const groupKey = getUrlGroupKey(dayKey, url);
  const isExpanded = expandedUrlGroups[groupKey] === true;
  const status = getUrlGroupStatus(tasks);
  const title = tasks.find((task) => task.title)?.title ?? url;

  return `
    <div class="task-url-group">
      <button class="task-url-toggle" data-url-group-toggle="${escapeHtml(groupKey)}" type="button">
        <span class="task-day-arrow">${isExpanded ? '▾' : '▸'}</span>
        <span class="task-url-group-body">
          <span class="task-title">${escapeHtml(title)}</span>
          <span class="task-url">${escapeHtml(url)}</span>
        </span>
        <span class="task-url-group-state">
          <span class="task-url-group-count">${tasks.length}</span>
          <span class="progress-value">${getUrlGroupProgress(tasks)}</span>
          <span class="status ${status}">${formatStatus(status)}</span>
        </span>
      </button>
      <div class="task-url-group-items ${isExpanded ? '' : 'collapsed'}">
        ${isExpanded ? tasks.map((task) => renderTaskMarkup(task, selectedTask)).join('') : ''}
      </div>
    </div>
  `;
}

function renderTaskMarkup(task: DownloadTask, selectedTask: DownloadTask | null): string {
  const isSelected = task.id === selectedTask?.id;

  return `
    <div class="task ${isSelected ? 'selected' : ''}">
      <button class="task-main" data-task-id="${task.id}" type="button">
        <span class="task-body">
          <span class="task-title">${escapeHtml(task.title || task.url)}</span>
          <span class="task-url">${escapeHtml(task.url)}</span>
          ${renderTaskHint(task)}
          <span class="progress-track" aria-label="Прогресс">
            <span class="progress-fill" style="width: ${typeof task.progress === 'number' ? task.progress : 0}%"></span>
          </span>
        </span>
        <span class="task-state">
          <span class="progress-value">${formatProgress(task)}</span>
          <span class="status ${task.status}">${formatStatus(task.status)}</span>
        </span>
      </button>
      <div class="task-actions">
        <button class="task-action" data-open-url="${task.id}" type="button">Ссылка</button>
        <button class="task-action" data-open-folder="${task.id}" type="button">Папка</button>
        <button class="task-action" data-open-log="${task.id}" type="button">Лог</button>
        <button class="task-action" data-retry-task="${task.id}" type="button">Снова</button>
        <button class="task-action danger-action" data-remove-task="${task.id}" type="button">Удалить</button>
      </div>
      ${isSelected ? renderTaskLog(task) : ''}
    </div>
  `;
}

function renderTaskListMarkup(tasks: DownloadTask[], selectedTask: DownloadTask | null): string {
  if (!tasks.length) {
    return '<p class="empty">Нет задач для отображения.</p>';
  }

  return groupQueueByDay(tasks)
    .map((group) => {
      const isCollapsed = collapsedDays[group.dayKey] === true;
      const visibleGroupTasks = hideCompleted
        ? group.tasks.filter((task) => task.status !== 'done' && task.status !== 'failed')
        : group.tasks;

      return `
        <section class="task-day-group">
          <div class="task-day-header">
            <button class="task-day-toggle" data-day-toggle="${group.dayKey}" type="button">
              <span class="task-day-arrow">${isCollapsed ? '▸' : '▾'}</span>
              <span class="task-day-label">${escapeHtml(group.label)}</span>
              <span class="task-day-stats" title="Успешно / Ошибки / Всего">
                <span class="task-day-stat done">${group.doneCount}</span>
                <span class="task-day-separator">/</span>
                <span class="task-day-stat failed">${group.failedCount}</span>
                <span class="task-day-separator">/</span>
                <span class="task-day-stat total">${group.totalCount}</span>
              </span>
            </button>
            <label class="task-day-hide-completed" title="Скрыть завершенные задачи во всех датах">
              <input data-hide-completed-toggle type="checkbox" ${hideCompleted ? 'checked' : ''} />
              <span>Скрыть завершенные</span>
            </label>
          </div>
          <div class="task-day-items ${isCollapsed ? 'collapsed' : ''}">
            ${
              isCollapsed
                ? ''
                : visibleGroupTasks.length
                  ? groupTasksByUrl(visibleGroupTasks)
                      .map((urlGroup) =>
                        urlGroup.tasks.length > 1
                          ? renderUrlTaskGroupMarkup(
                              group.dayKey,
                              urlGroup.url,
                              urlGroup.tasks,
                              selectedTask
                            )
                          : renderTaskMarkup(urlGroup.tasks[0], selectedTask)
                      )
                      .join('')
                  : '<p class="empty">Завершенные задачи скрыты.</p>'
            }
          </div>
        </section>
      `;
    })
    .join('');
}

function refreshQueueView(): void {
  if (currentTab !== 'queue') {
    return;
  }

  const queueCount = document.querySelector<HTMLElement>('#queue-count');
  const queueMetaDir = document.querySelector<HTMLElement>('#queue-download-dir');
  const queueMetaConcurrent = document.querySelector<HTMLElement>('#queue-concurrent');
  const queueMessage = document.querySelector<HTMLElement>('#queue-message');
  const taskList = document.querySelector<HTMLElement>('#task-list');

  if (!queueCount || !queueMetaDir || !queueMetaConcurrent || !queueMessage || !taskList) {
    render();
    return;
  }

  const visibleQueue = getVisibleQueue();
  const selectedTask =
    queue.find((task) => task.id === selectedTaskId) ?? visibleQueue.at(0) ?? queue.at(0) ?? null;
  const previousScrollTop = taskList.scrollTop;

  queueCount.textContent = formatQueueCount(visibleQueue);
  queueMetaDir.textContent = `Папка: ${settings.downloadDir || 'не выбрана'}`;
  queueMetaConcurrent.textContent = `Параллельно: ${settings.maxConcurrentDownloads}`;
  queueMessage.innerHTML = addMessage ? escapeHtml(addMessage) : '';
  queueMessage.style.display = addMessage ? 'block' : 'none';
  taskList.innerHTML = renderTaskListMarkup(queue, selectedTask);
  taskList.scrollTop = previousScrollTop;

  bindQueueTaskEvents();
  bindQueueGroupEvents();
}

function refreshViewAfterQueueUpdate(): void {
  if (currentTab === 'queue') {
    refreshQueueView();
  }
}

function readTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
}

function applyTheme(): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function toggleTheme(): void {
  theme = theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, theme);
  applyTheme();
  render();
}

function render(): void {
  const visibleQueue = getVisibleQueue();
  const selectedTask =
    queue.find((task) => task.id === selectedTaskId) ?? visibleQueue.at(0) ?? queue.at(0) ?? null;

  appRoot.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div class="app-brand">
          <img class="app-brand-icon" src="/savvy.png" alt="" />
          <div>
            <h1>Savvy</h1>
            <p>Очередь скачивания через локально установленный yt-dlp</p>
          </div>
        </div>
        <div class="topbar-actions">
          <button class="ghost bordered theme-toggle" data-toggle-theme type="button" title="${theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}" aria-label="${theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}">${theme === 'dark' ? '☀' : '☾'}</button>
          <nav class="tabs" aria-label="Разделы">
            <button class="tab ${currentTab === 'queue' ? 'active' : ''}" data-tab="queue">Скачивание</button>
            <button class="tab settings-tab ${currentTab === 'settings' ? 'active' : ''}" data-tab="settings" title="Настройки" aria-label="Настройки">⚙</button>
          </nav>
        </div>
      </header>

      ${
        runtimeNotice
          ? `
            <section class="panel runtime-notice">
              <p>${escapeHtml(runtimeNotice)}</p>
            </section>
          `
          : ''
      }

      ${
        startupError
          ? `
            <section class="panel startup-error">
              <h2>Ошибка запуска</h2>
              <p>${escapeHtml(startupError)}</p>
            </section>
          `
          : currentTab === 'queue'
            ? `
            <section class="panel">
              <form class="add-form" id="add-form">
                <input id="url-input" type="url" value="${escapeHtml(urlDraft)}" placeholder="https://www.youtube.com/watch?v=..." autocomplete="off" required />
                <button class="primary" type="submit">Добавить</button>
              </form>
            </section>

            <section class="workspace">
              <div class="panel queue-panel">
                <div class="section-head">
                  <h2>Скачивание</h2>
                  <span id="queue-count">${formatQueueCount(visibleQueue)}</span>
                </div>
                <div class="queue-meta">
                  <span id="queue-download-dir">Папка: ${escapeHtml(settings.downloadDir || 'не выбрана')}</span>
                  <span id="queue-concurrent">Параллельно: ${settings.maxConcurrentDownloads}</span>
                </div>
                <p class="inline-message" id="queue-message" ${addMessage ? '' : 'style="display: none;"'}>${addMessage ? escapeHtml(addMessage) : ''}</p>
                <div class="task-list" id="task-list">
                  ${renderTaskListMarkup(queue, selectedTask)}
                </div>
              </div>
            </section>
          `
            : renderSettingsPanel()
      }
    </main>
  ${renderFolderPicker()}
  ${renderConfigModal()}
  `;

  bindEvents();
}

function bindSettingsEvents(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-settings-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      settingsMode = button.dataset.settingsMode as SettingsMode;
      textConfigDraft = null;
      render();
    });
  });

  document.querySelectorAll<HTMLInputElement>('[data-setting-checkbox]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const key = checkbox.dataset.settingCheckbox as keyof AppSettings | undefined;
      if (key) {
        void updateLocalSettings({ [key]: checkbox.checked } as Partial<AppSettings>);
      }
    });
  });

  document
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting-input]')
    .forEach((input) => {
      input.addEventListener('change', () => {
        const key = input.dataset.settingInput as keyof AppSettings | undefined;
        if (!key) {
          return;
        }

        const value =
          input instanceof HTMLInputElement && input.type === 'number'
            ? Math.floor(Number(input.value || '0'))
            : input.value;
        void updateLocalSettings({ [key]: value } as Partial<AppSettings>);
      });
    });

  document.querySelectorAll<HTMLSelectElement>('[data-setting-exclusive]').forEach((select) => {
    select.addEventListener('change', () => {
      const option = SETTINGS_OPTION_GROUPS.flatMap((group) => group.options).find(
        (item): item is Extract<SettingsOption, { kind: 'exclusive' }> =>
          item.kind === 'exclusive' && item.id === select.dataset.settingExclusive
      );
      const choice = option?.choices.find((item) => item.value === select.value);

      if (choice) {
        void updateLocalSettings(choice.patch);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-choose-setting-path]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.chooseSettingPath as keyof AppSettings | undefined;
      if (key) {
        void chooseSettingPath(key);
      }
    });
  });

  document
    .querySelector<HTMLTextAreaElement>('#text-config-input')
    ?.addEventListener('input', () => {
      textConfigDraft =
        document.querySelector<HTMLTextAreaElement>('#text-config-input')?.value ?? '';
      refreshTextConfigState();
    });

  document.querySelector<HTMLButtonElement>('#save-text-config')?.addEventListener('click', () => {
    void saveTextConfig();
  });

  document.querySelector<HTMLButtonElement>('#reset-text-config')?.addEventListener('click', () => {
    textConfigDraft = null;
    render();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-load-config-version]').forEach((button) => {
    button.addEventListener('click', () => {
      const version = readConfigVersions().find(
        (item) => item.id === button.dataset.loadConfigVersion
      );
      if (!version) {
        return;
      }

      textConfigDraft = version.text;
      render();
    });
  });

  document.querySelector<HTMLButtonElement>('#clear-history')?.addEventListener('click', () => {
    void clearHistory();
  });

  bindConfigModalEvents();
}

function bindConfigModalEvents(): void {
  document
    .querySelector<HTMLButtonElement>('#close-config-modal')
    ?.addEventListener('click', () => {
      isConfigModalOpen = false;
      render();
    });

  document
    .querySelector<HTMLButtonElement>('#clear-inline-config')
    ?.addEventListener('click', () => {
      void updateLocalSettings({ inlineConfigText: '' });
      isConfigModalOpen = false;
      render();
    });

  document
    .querySelector<HTMLButtonElement>('#save-inline-config')
    ?.addEventListener('click', () => {
      const configInput = document.querySelector<HTMLTextAreaElement>('#inline-config-text');
      void updateLocalSettings({ inlineConfigText: configInput?.value ?? '' });
      isConfigModalOpen = false;
      render();
    });
}

function bindQueueTaskEvents(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-task-id]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedTaskId = button.dataset.taskId ?? null;
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-open-url]').forEach((button) => {
    button.addEventListener('click', () => {
      const task = queue.find((item) => item.id === button.dataset.openUrl);
      if (task) {
        void window.ytdlp.openUrl(task.url);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-open-folder]').forEach((button) => {
    button.addEventListener('click', () => {
      const task = queue.find((item) => item.id === button.dataset.openFolder);
      if (task) {
        void window.ytdlp.openFolder(task.downloadDir);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-open-log]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedTaskId = button.dataset.openLog ?? null;
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-retry-task]').forEach((button) => {
    button.addEventListener('click', () => {
      const taskId = button.dataset.retryTask;
      if (taskId) {
        void retryDownload(taskId);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-remove-task]').forEach((button) => {
    button.addEventListener('click', () => {
      const taskId = button.dataset.removeTask;
      if (taskId) {
        void removeDownload(taskId);
      }
    });
  });
}

function bindQueueGroupEvents(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-day-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const dayKey = button.dataset.dayToggle;
      if (!dayKey) {
        return;
      }

      collapsedDays = {
        ...collapsedDays,
        [dayKey]: !collapsedDays[dayKey]
      };
      saveCollapsedDays();
      refreshQueueView();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-url-group-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const groupKey = button.dataset.urlGroupToggle;
      if (!groupKey) {
        return;
      }

      expandedUrlGroups = {
        ...expandedUrlGroups,
        [groupKey]: !expandedUrlGroups[groupKey]
      };
      saveExpandedUrlGroups();
      refreshQueueView();
    });
  });
}

function bindQueueStaticEvents(): void {
  document
    .querySelectorAll<HTMLInputElement>('[data-hide-completed-toggle]')
    .forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        hideCompleted = checkbox.checked;
        localStorage.setItem('ytdlp-hide-completed', String(hideCompleted));
        render();
      });
    });

  document.querySelector<HTMLFormElement>('#add-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void addDownload();
  });
}

function bindEvents(): void {
  document
    .querySelector<HTMLButtonElement>('[data-toggle-theme]')
    ?.addEventListener('click', () => {
      toggleTheme();
    });

  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      currentTab = button.dataset.tab as Tab;
      addMessage = null;
      render();
    });
  });

  bindQueueTaskEvents();
  bindQueueGroupEvents();
  bindQueueStaticEvents();
  bindFolderPickerEvents();

  document.querySelector<HTMLInputElement>('#url-input')?.addEventListener('blur', () => {
    applyPendingQueue();
  });

  document.querySelector<HTMLInputElement>('#url-input')?.addEventListener('input', (event) => {
    urlDraft = (event.currentTarget as HTMLInputElement).value;
  });

  if (currentTab === 'settings') {
    bindSettingsEvents();
  }
}

async function chooseSettingPath(key: keyof AppSettings): Promise<void> {
  await openFolderPicker(key);
}

async function openFolderPicker(targetKey: keyof AppSettings): Promise<void> {
  const picker: FolderPickerState = {
    targetKey,
    listing: null,
    error: null,
    selectedIndex: 0,
    suggestions: [],
    pathDraft: '',
    suggestionRequestId: 0
  };
  folderPicker = picker;
  render();

  try {
    picker.listing = await window.ytdlp.listFolderDirectories(
      typeof settings[targetKey] === 'string' ? String(settings[targetKey]) : settings.downloadDir
    );
    picker.selectedIndex = 0;
    picker.pathDraft = picker.listing.displayPath;
  } catch (error) {
    picker.error = error instanceof Error ? error.message : 'Не удалось открыть папку.';
  }

  render();
}

async function navigateFolderPicker(path: string): Promise<void> {
  if (!folderPicker) {
    return;
  }

  try {
    folderPicker.listing = await window.ytdlp.listFolderDirectories(path);
    folderPicker.error = null;
    folderPicker.selectedIndex = 0;
    folderPicker.pathDraft = folderPicker.listing.displayPath;
  } catch (error) {
    folderPicker.error = error instanceof Error ? error.message : 'Не удалось открыть папку.';
  }
  render();
}

async function addFolderPickerSelection(): Promise<void> {
  const selectedPath = folderPicker?.listing?.path;
  const targetKey = folderPicker?.targetKey;
  if (!selectedPath || !targetKey) {
    return;
  }

  folderPicker = null;
  await updateLocalSettings({ [targetKey]: selectedPath } as Partial<AppSettings>);
  render();
}

function renderFolderPicker(): string {
  const picker = folderPicker;
  if (!picker) {
    return '';
  }

  const listing = picker.listing;
  const directories = listing?.directories ?? [];
  const entries = listing
    ? [...(listing.parentPath ? [{ name: '..', path: listing.parentPath }] : []), ...directories]
    : [];
  const selectedIndex = Math.min(picker.selectedIndex, Math.max(entries.length - 1, 0));
  return `
    <div class="folder-picker-backdrop" data-folder-picker-close>
      <section class="folder-picker" role="dialog" aria-modal="true" aria-label="Выбор папки">
        <div class="folder-picker-header">
          <button class="folder-picker-back" id="folder-picker-back" type="button" aria-label="Назад" ${listing?.parentPath ? '' : 'disabled'}>↶</button>
          <input class="folder-picker-path-input" id="folder-picker-path-input" value="${escapeHtml(picker.pathDraft || listing?.displayPath || '')}" placeholder="~/Documents/" autocomplete="off" spellcheck="false" />
          <button class="folder-picker-add" id="folder-picker-add" type="button" ${listing ? '' : 'disabled'}>Add <span>⌘ Enter</span></button>
        </div>
        <div class="folder-picker-content">
          <h3>Directories</h3>
          ${picker.error ? `<p class="folder-picker-error">${escapeHtml(picker.error)}</p>` : ''}
          ${picker.suggestions.length ? `<div class="folder-picker-suggestions">${picker.suggestions.map((suggestion) => `<button class="folder-picker-suggestion" data-folder-picker-suggestion="${escapeHtml(suggestion.path)}" type="button"><span class="folder-picker-icon">□</span><span>${escapeHtml(suggestion.name)}</span></button>`).join('')}</div>` : ''}
          <div class="folder-picker-list">
            ${entries.length ? entries.map((entry, index) => `<button class="folder-picker-entry ${index === selectedIndex ? 'selected' : ''} ${entry.name === '..' ? 'folder-picker-parent' : ''}" data-folder-picker-index="${index}" data-folder-picker-path="${escapeHtml(entry.path)}" type="button"><span class="folder-picker-icon">${entry.name === '..' ? '↥' : '□'}</span><span>${escapeHtml(entry.name)}</span></button>`).join('') : '<p class="folder-picker-empty">Вложенных папок нет</p>'}
          </div>
        </div>
        <footer class="folder-picker-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
          <span><kbd>Enter</kbd> Select</span>
          <span><kbd>Backspace</kbd> Back</span>
          <span><kbd>Esc</kbd> Close</span>
          <button class="folder-picker-finder" id="folder-picker-finder" type="button" ${listing ? '' : 'disabled'}>Open in Finder</button>
        </footer>
      </section>
    </div>
  `;
}

function bindFolderPickerEvents(): void {
  if (!folderPicker) {
    document.onkeydown = null;
    return;
  }

  document
    .querySelector<HTMLDivElement>('[data-folder-picker-close]')
    ?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        folderPicker = null;
        render();
      }
    });
  document
    .querySelector<HTMLButtonElement>('#folder-picker-back')
    ?.addEventListener('click', () => {
      const parentPath = folderPicker?.listing?.parentPath;
      if (parentPath) {
        void navigateFolderPicker(parentPath);
      }
    });
  document.querySelectorAll<HTMLButtonElement>('[data-folder-picker-path]').forEach((button) => {
    button.addEventListener('dblclick', () => {
      const path = button.dataset.folderPickerPath;
      if (path) {
        void navigateFolderPicker(path);
      }
    });
    button.addEventListener('click', () => {
      document
        .querySelectorAll('.folder-picker-entry.selected')
        .forEach((entry) => entry.classList.remove('selected'));
      button.classList.add('selected');
      if (folderPicker) {
        folderPicker.selectedIndex = Number(button.dataset.folderPickerIndex ?? '0');
      }
    });
  });
  document.querySelector<HTMLButtonElement>('#folder-picker-add')?.addEventListener('click', () => {
    void addFolderPickerSelection();
  });
  document
    .querySelector<HTMLButtonElement>('#folder-picker-finder')
    ?.addEventListener('click', () => {
      const path = folderPicker?.listing?.path;
      if (path) {
        void window.ytdlp.openFolder(path);
      }
    });
  document
    .querySelector<HTMLInputElement>('#folder-picker-path-input')
    ?.addEventListener('input', (event) => {
      const input = event.currentTarget as HTMLInputElement;
      if (folderPicker) {
        const cursorPosition = input.selectionStart ?? input.value.length;
        folderPicker.pathDraft = input.value;
        void refreshFolderSuggestions(input.value, cursorPosition);
      }
    });
  document
    .querySelectorAll<HTMLButtonElement>('[data-folder-picker-suggestion]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        const path = button.dataset.folderPickerSuggestion;
        if (path) {
          void navigateFolderPicker(path);
        }
      });
    });
  document.onkeydown = (event) => {
    if (!folderPicker) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      folderPicker = null;
      render();
      return;
    }

    const isPathInput = event.target instanceof HTMLInputElement;
    if (
      !isPathInput &&
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      const input = document.querySelector<HTMLInputElement>('#folder-picker-path-input');
      if (input) {
        event.preventDefault();
        input.focus();
        const cursorPosition = input.value.length;
        input.setSelectionRange(cursorPosition, cursorPosition);
        input.setRangeText(event.key, cursorPosition, cursorPosition, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }

    if (event.key === 'Backspace' && !isPathInput && folderPicker.listing?.parentPath) {
      event.preventDefault();
      void navigateFolderPicker(folderPicker.listing.parentPath);
      return;
    }

    if (!isPathInput && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      const entryCount = document.querySelectorAll<HTMLButtonElement>(
        '[data-folder-picker-path]'
      ).length;
      if (entryCount > 0) {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        folderPicker.selectedIndex =
          (folderPicker.selectedIndex + direction + entryCount) % entryCount;
        render();
      }
      return;
    }

    if (event.key === 'Tab' && isPathInput && folderPicker.suggestions[0]) {
      event.preventDefault();
      const suggestion = folderPicker.suggestions[0];
      const input = event.target as HTMLInputElement;
      folderPicker.pathDraft = `${suggestion.displayPath}/`;
      input.value = folderPicker.pathDraft;
      void refreshFolderSuggestions(folderPicker.pathDraft, folderPicker.pathDraft.length);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (isPathInput && folderPicker.suggestions[0]) {
        void navigateFolderPicker(folderPicker.suggestions[0].path);
        return;
      }
      const selectedEntry = document.querySelector<HTMLButtonElement>(
        `[data-folder-picker-index="${folderPicker.selectedIndex}"]`
      );
      if (selectedEntry?.dataset.folderPickerPath) {
        void navigateFolderPicker(selectedEntry.dataset.folderPickerPath);
      } else {
        void addFolderPickerSelection();
      }
    }
  };
}

async function refreshFolderSuggestions(inputPath: string, cursorPosition: number): Promise<void> {
  if (!folderPicker) {
    return;
  }

  const picker = folderPicker;
  const requestId = ++picker.suggestionRequestId;
  try {
    picker.suggestions = await window.ytdlp.suggestFolderDirectories(inputPath);
    picker.error = null;
  } catch {
    picker.suggestions = [];
    picker.error = null;
  }
  if (requestId !== picker.suggestionRequestId || folderPicker !== picker) {
    return;
  }
  render();
  const input = document.querySelector<HTMLInputElement>('#folder-picker-path-input');
  input?.focus();
  input?.setSelectionRange(cursorPosition, cursorPosition);
}

function refreshTextConfigState(): void {
  const textarea = document.querySelector<HTMLTextAreaElement>('#text-config-input');
  const saveButton = document.querySelector<HTMLButtonElement>('#save-text-config');
  const diffPreview = document.querySelector<HTMLElement>('#config-diff');

  if (!textarea || !saveButton || !diffPreview) {
    return;
  }

  const nextText = textarea.value.trim();
  const savedText = getSavedConfigText();
  const previousText = readConfigVersions().at(0)?.text ?? savedText;

  saveButton.disabled = nextText === savedText;
  diffPreview.textContent = buildConfigDiff(previousText, nextText);
}

function buildTextModeSettings(text: string): Partial<AppSettings> {
  return {
    inlineConfigText: text,
    downloadDirectlyToSelectedFolder: false,
    extractAudio: false,
    audioFormat: 'mp3',
    writeThumbnail: false,
    writeSubtitles: false,
    embedMetadata: false,
    sponsorBlock: false,
    outputTemplate: '',
    pathsTemp: '',
    format: '',
    formatSort: '',
    mergeOutputFormat: '',
    remuxVideo: '',
    recodeVideo: '',
    audioQuality: '',
    subtitlesLangs: '',
    convertSubtitles: '',
    proxy: '',
    socketTimeout: '',
    retries: '',
    fragmentRetries: '',
    concurrentFragments: 1,
    playlistStart: '',
    playlistEnd: '',
    maxDownloads: '',
    dateAfter: '',
    dateBefore: '',
    matchFilter: '',
    downloadArchive: '',
    cookiesFile: '',
    netrc: false,
    netrcLocation: '',
    username: '',
    extractorArgs: '',
    externalDownloader: '',
    externalDownloaderArgs: '',
    ffmpegLocation: '',
    postprocessorArgs: '',
    ignoreErrors: false,
    noWarnings: false,
    forceOverwrites: false,
    noOverwrites: false,
    continueDownload: false,
    noPart: false,
    restrictFilenames: false,
    windowsFilenames: false,
    writeDescription: false,
    writeInfoJson: false,
    writeComments: false,
    writeAutoSubtitles: false,
    embedSubtitles: false,
    embedThumbnail: false,
    splitChapters: false,
    removeChapters: '',
    sponsorBlockMark: '',
    rateLimit: '',
    cookiesFromBrowser: '',
    additionalOptions: ''
  };
}

async function saveTextConfig(): Promise<void> {
  const text = (
    textConfigDraft ??
    document.querySelector<HTMLTextAreaElement>('#text-config-input')?.value ??
    ''
  ).trim();

  saveConfigVersion(text);
  await updateLocalSettings(buildTextModeSettings(text));
  textConfigDraft = null;
  settingsMessage = 'Текстовый config сохранен новой версией.';
  render();
}

async function clearHistory(): Promise<void> {
  queue = await window.ytdlp.clearHistory();
  selectedTaskId = queue.at(0)?.id ?? null;
  render();
}

async function addDownload(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('#url-input');
  if (!input) {
    return;
  }

  const url = input.value.trim();
  if (!url) {
    return;
  }

  try {
    await window.ytdlp.updateSettings(settings);
    const task = await window.ytdlp.addDownload({
      url,
      optionsText: '',
      downloadDir: settings.downloadDir
    });

    selectedTaskId = task.id;
    addMessage = null;
    urlDraft = '';
    input.value = '';
    input.focus();
  } catch (error) {
    addMessage = error instanceof Error ? error.message : 'Не удалось добавить ссылку.';
    render();
    document.querySelector<HTMLInputElement>('#url-input')?.focus();
  }
}

async function retryDownload(taskId: string): Promise<void> {
  const task = await window.ytdlp.retryDownload(taskId);
  selectedTaskId = task.id;
  currentTab = 'queue';
  render();
}

async function removeDownload(taskId: string): Promise<void> {
  try {
    queue = await window.ytdlp.removeDownload(taskId);
    if (selectedTaskId === taskId) {
      selectedTaskId = getVisibleQueue().at(0)?.id ?? queue.at(0)?.id ?? null;
    }
    render();
  } catch (error) {
    addMessage = error instanceof Error ? error.message : 'Не удалось удалить задачу.';
    currentTab = 'queue';
    render();
  }
}

window.ytdlp.onQueueUpdate((update) => {
  queue = update.queue;
  selectedTaskId = update.task.id;
  refreshViewAfterQueueUpdate();
});

applyTheme();
render();

async function initializeApp(): Promise<void> {
  try {
    const mainSettings = await window.ytdlp.getSettings();
    settings = {
      ...settings,
      ...mainSettings,
      inheritedConfigPaths: mainSettings.inheritedConfigPaths
    };
    effectiveOptionsPreview = await window.ytdlp.getEffectiveOptionsPreview();
    queue = await window.ytdlp.getQueue();
  } catch (error) {
    startupError =
      error instanceof Error ? error.message : 'Не удалось получить очередь скачивания.';
  }

  render();
}

void initializeApp();

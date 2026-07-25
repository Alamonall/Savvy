# Savvy

Desktop-приложение на Electron для постановки ссылок в очередь и скачивания через локально установленный [yt-dlp](https://github.com/yt-dlp/yt-dlp).

## Требования

- Node.js 24 или новее;
- npm;
- `yt-dlp` для скачивания;
- `ffmpeg` для объединения видео и аудио;
- `deno` — опционально, для JavaScript runtime yt-dlp.

Пути к бинарникам ищутся в `PATH`, системных каталогах и `~/.local/bin`. В packaged-приложении также проверяется каталог `resources/bin`.

## Установка и запуск

```bash
npm ci
npm run dev
```

Для production-сборки:

```bash
npm run build
npm run dist:linux
npm run dist:mac
npm run dist:windows
```

## Проверки качества

```bash
npm test
npm run format:check
npm run lint
npm run typecheck
npm run quality:check
```

Автоматическое исправление форматирования и lint-ошибок:

```bash
npm run format
npm run lint:fix
```

Форматирование выполняется Prettier, статический анализ — ESLint с TypeScript-проверками.

## Релизы и nightly

Стабильный релиз создаётся semantic-release после push в `master`.
Для тестовых сборок используются ветки `release/nightly` и `release/beta`:

```bash
git switch master
git pull --ff-only
git switch -c release/nightly
git push -u origin release/nightly
```

Для beta используется аналогичная команда с заменой имени ветки:

```bash
git switch -c release/beta
git push -u origin release/beta
```

Каждый push создаёт GitHub prerelease: для nightly — `0.3.3-nightly.1`,
`0.3.3-nightly.2`, а для beta — `0.3.3-beta.1`, `0.3.3-beta.2` и так далее.
Стабильная версия публикуется обычным push в `master`.

Отдельный CI запускает проверки качества и тесты для этих веток, а также для
pull request в них.

semantic-release определяет предыдущую версию по Git-тегам. После очистки старых
релизов нужно также удалить старые теги `v1.*` и оставить или создать тег
`v0.3.2`; удаление только записей GitHub Releases нумерацию не сбрасывает.

## Архитектура

- `src/main` — Electron main-процесс и NestJS application context;
- `src/main/modules` — модули по зонам ответственности: загрузки, настройки, shell, поиск бинарников;
- `src/main/services` — доменная логика очереди, настроек и системных диалогов;
- `src/preload` — типизированный безопасный IPC API через `contextBridge`;
- `src/renderer` — интерфейс очереди и настроек;
- `src/shared` — общие типы main/preload/renderer.

Renderer не получает прямого доступа к Node.js: окно работает с `contextIsolation: true` и `nodeIntegration: false`.

## Возможности

- очередь скачиваний с прогрессом, логом, повтором и историей;
- ограничение числа параллельных загрузок;
- UI- и текстовый режимы настройки yt-dlp;
- импорт config-файлов и предпросмотр итоговых аргументов;
- светлая и тёмная тема с сохранением выбора между запусками;
- автоматические повторы временных HTTP 403-ошибок.

Настройки и история хранятся в каталоге `app.getPath('userData')` текущей операционной системы.

## Разработка

Изменения в проекте должны соответствовать строгому TypeScript, ESLint и Prettier. Новую функциональность следует сначала покрыть тестом, затем реализовать и проверить командами из раздела «Проверки качества».

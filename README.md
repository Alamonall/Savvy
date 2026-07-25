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

## Релизы

Каждое вливание изменений в `master` workflow публикует alpha-релиз:
`1.2.3-alpha.1`, `1.2.3-alpha.2` и так далее. До стабильного релиза меняется
только номер alpha. Стабильный релиз запускается вручную через
`Actions → Release → Run workflow` и публикуется без суффикса, например
`1.2.3`. После него следующий alpha-цикл начинается с версии `1.2.4-alpha.1`.

```bash
git switch master
git pull --ff-only
git push origin master
```

Текущая версия проекта — `0.0.1-alpha.3`. CHANGELOG обновляется через
`conventional-changelog`, а Release Notes формируются по Conventional Commits.

Отдельный CI запускает проверки качества и тесты для `master`, а также для
pull request в эту ветку.

Нумерация определяется по Git-тегам: стабильный тег `v1.2.3` задаёт следующую
alpha-основу `1.2.4`, а alpha-теги `v1.2.4-alpha.N` увеличивают только `N`.

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

# Контекст проекта

Дата сканирования: 2026-07-25

## Назначение

`Savvy` — desktop-приложение на Electron для постановки ссылок в очередь и скачивания через локально установленный `yt-dlp`. Интерфейс русскоязычный и поддерживает два режима:

- очередь скачивания с прогрессом, логом, повтором, удалением и очисткой истории;
- настройки yt-dlp в UI-режиме и текстовом config-режиме.

Приложение не содержит собственного HTTP API и не скачивает файлы напрямую из renderer-процесса: renderer обращается к main-процессу через ограниченный preload API.

## Структура

```text
src/
  main/
    index.ts                         запуск Electron, окно и IPC handlers
    app.module.ts                    NestJS application context
    services/
      binary-locator.service.ts      поиск yt-dlp, ffmpeg и deno
      downloads.service.ts           очередь, spawn yt-dlp, прогресс и история
      electron-shell.service.ts      диалоги, импорт config, shell.openExternal/openPath
      settings.service.ts            настройки, config yt-dlp и построение аргументов
  preload/index.ts                   contextBridge API между renderer и main
  renderer/
    index.html                       HTML entry point
    src/main.ts                      UI, состояние, preview API и обработчики событий
    src/styles.css                   стили интерфейса
    src/global.d.ts                  тип Window.ytdlp
  shared/types.ts                    общие типы задач, настроек и preload API
```

Корневые конфигурации: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `.gitignore`. Документация проекта находится в `README.md`, проверки конфигурации и стандартов — в `tests/`.

## Архитектура и поток выполнения

1. `src/main/index.ts` после `app.whenReady()` создаёт `ElectronApplication`, который поднимает NestJS application context из `AppModule`, получает сервисы, загружает настройки и историю, регистрирует IPC handlers и создаёт `BrowserWindow`.
2. Окно работает с `contextIsolation: true` и `nodeIntegration: false`; preload подключает `contextBridge` и экспортирует `window.ytdlp`.
3. Renderer (`src/renderer/src/main.ts`) хранит UI-состояние, рендерит DOM-шаблоны и вызывает `window.ytdlp`. Обновления очереди идут обратно через событие `downloads:update`.
4. `DownloadsService` запускает найденный бинарник через `spawn(..., { shell: false })`, читает stdout/stderr, извлекает прогресс и имя результата, ограничивает журнал последними 300 строками и сохраняет очередь.
5. При завершении процесса задача становится `done` при коде `0`; HTTP 403 автоматически повторяется до двух раз с задержкой 2 секунды. Для n challenge/отсутствующих форматов YouTube и таймаутов x.com формируется пользовательское сообщение.

## IPC-контракт

Каналы регистрируются в `src/main/index.ts` и типизированы через `YtdlpApi` в `src/shared/types.ts`.

| Канал                                    | Назначение                                     |
| ---------------------------------------- | ---------------------------------------------- |
| `downloads:add`                          | добавить URL в очередь                         |
| `downloads:retry`                        | создать новую задачу с актуальными настройками |
| `downloads:remove`                       | удалить неактивную задачу                      |
| `downloads:list`                         | получить очередь                               |
| `downloads:clear-history`                | удалить завершённые и неактивные задачи        |
| `downloads:update`                       | main → renderer: задача и снимок очереди       |
| `settings:get`                           | получить настройки                             |
| `settings:update`                        | нормализовать и сохранить настройки            |
| `settings:get-effective-options-preview` | получить итоговые аргументы перед URL          |
| `settings:choose-download-directory`     | выбрать папку через Electron dialog            |
| `settings:import-config-file`            | выбрать и импортировать config-файл            |
| `settings:import-config-file-by-path`    | импортировать config по указанному пути        |
| `shell:open-url`                         | открыть только `http`/`https` URL              |
| `shell:open-folder`                      | открыть папку через системный shell            |

Renderer дополнительно содержит browser-preview реализацию `window.ytdlp`. Она нужна для визуального preview без Electron preload и не запускает реальный `yt-dlp`.

## Настройки и конфигурация yt-dlp

`SettingsService`:

- задаёт значения по умолчанию, включая системную папку Downloads;
- при инициализации наследует найденные конфиги из `/etc/yt-dlp.conf`, `/etc/yt-dlp/config`, XDG config, `~/.yt-dlp/config` и `~/.yt-dlp.conf`;
- сохраняет настройки в `settings.json`;
- поддерживает inline config в `inline-yt-dlp.conf`;
- преобразует управляемые поля UI и дополнительные аргументы в строку опций;
- нормализует конкуренцию в диапазон 1–8 и разрешает конфликтующие пары настроек (`forceOverwrites`/`noOverwrites`, browser cookies/file cookies, remux/recode).

Важные настройки включают формат, output template, временную папку, аудио/субтитры, metadata/thumbnail, proxy и таймауты, cookies, playlist-фильтры, archive, ffmpeg, postprocessor и дополнительные аргументы.

## Хранение данных

Путь определяется Electron `app.getPath('userData')` текущей ОС:

- `settings.json` — сохранённые настройки;
- `download-history.json` — очередь и история задач;
- `inline-yt-dlp.conf` — inline config, если он задан.

В renderer через `localStorage` сохраняются только UI-предпочтения: скрытие завершённых задач, свёрнутые дни, раскрытые группы URL и локальные версии config.

## Поиск бинарников

`BinaryLocatorService` проверяет исполняемые файлы в следующем порядке:

1. в packaged-режиме `process.resourcesPath/bin`;
2. каталоги из `PATH`;
3. `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin`;
4. `~/.local/bin`.

Ищутся `yt-dlp`, `ffmpeg` и `deno`. В packaged-приложении `yt-dlp` поставляется вместе с приложением в `resources/bin`, поэтому отдельная установка yt-dlp не требуется. Для ffmpeg в аргументы добавляется каталог бинарника, если пользователь не указал `ffmpegLocation`. Если yt-dlp не найден, задача завершается с понятным сообщением без запуска процесса.

## Команды разработки и сборки

Команды определены в `package.json`:

```bash
bun install
bun run dev
bun run typecheck
bun run lint
bun run format:check
bun run build
bun run dist
bun run dist:mac
```

Также есть `npm`-совместимые script names, но проектные команды сборки и публикации используют `bun`. Команды `dist` перед сборкой запускают `prepare:ytdlp`, который скачивает официальный standalone-бинарник для текущей платформы. `dist` собирает Electron-приложение без публикации; macOS-цель создаёт DMG и ZIP. Конфигурация electron-builder включает `out/**/*`, `package.json` и встроенный бинарник, использует `asar` и app id `com.alamonall.savvy`.

## Правила разработки

- Не изменять `.npmrc`.
- Не использовать глобальные переменные; новые состояния держать в объектах/классах с локальной областью ответственности.
- Не добавлять `any`, non-null assertion и `eslint-disable`, если можно выразить тип корректно.
- Соблюдать strict TypeScript, ESLint и kebab-case для новых файлов.
- Для изменений сначала добавлять тесты, затем реализацию; в текущем репозитории тестовый harness ещё не заведён.
- Публичные методы должны иметь JSDoc; доменные ошибки должны содержать контекст.
- Коммиты — Conventional Commits с русским описанием; ветки — `feat/`, `fix/`, `refactor/`, `perf/`, `test/`, `build/`, `ci/`, `docs/`, `chore/` или `revert/` и с английским kebab-case suffix.
- Не коммитить изменения без явного запроса.

Текущая рабочая ветка: `t3code/035b1ed8`; это имя не соответствует правилу префикса веток, но в рамках создания контекста ветка не менялась.

## Состояние и ограничения сканирования

- Рабочее дерево на момент сканирования не показывало незакоммиченных изменений.
- Knowledge graph для этой рабочей копии не был проиндексирован, поэтому обзор подтверждён чтением исходников и конфигурации.
- `npm run typecheck` не завершился: в окружении отсутствует команда `tsc` (`sh: tsc: command not found`). Из-за этого последовательная команда `typecheck && lint && build` до lint/build не дошла.
- Наличие локальных бинарников `yt-dlp`, `ffmpeg` и `deno`, реальный запуск Electron, загрузка видео и packaged build отдельно не проверялись.
- В репозитории нет автоматических тестов, поэтому поведение очереди, IPC и парсинга config требует ручной проверки или добавления test harness при последующих изменениях.

import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  extractHtmlTitle,
  extractTitleFromLogLines,
  getTwitterOembedUrl,
  getYoutubeOembedUrl,
  isUnresolvedTaskTitle,
  parseOembedTitle,
  parseTitleFromLogLine,
  SAVVY_TITLE_PREFIX
} from '../../shared/task-title';
import type { AddDownloadPayload, DownloadTask, DownloadUpdate } from '../../shared/types';
import { BinaryLocatorService } from './binary-locator.service';
import { SettingsService } from './settings.service';

const require = createRequire(import.meta.url);
const { app } = require('electron') as typeof import('electron');
const execFileAsync = promisify(execFile);

type QueueUpdateSender = (update: DownloadUpdate) => void;
type FailureDetails = {
  userMessage: string | null;
};

const YOUTUBE_JS_RUNTIME_MESSAGE =
  'YouTube не отдал видеоформаты: yt-dlp не смог решить n challenge. Добавь в дополнительные аргументы "--js-runtimes deno" или обнови yt-dlp/JS runtime.';
const X_TIMEOUT_MESSAGE =
  'Не удалось подключиться к x.com: соединение истекло по таймауту. Для Twitter/X проверь доступ к сайту из этой сети, укажи Proxy/VPN в настройках сети, при необходимости увеличь "Таймаут сокета" и используй cookies из браузера.';
const MAX_CONCURRENT_TITLE_LOOKUPS = 3;
const METADATA_FETCH_TIMEOUT_MS = 5_000;
const YTDLP_METADATA_TIMEOUT_MS = 15_000;

@Injectable()
export class DownloadsService implements OnModuleDestroy {
  private queue: DownloadTask[] = [];
  private readonly activeTaskIds = new Set<string>();
  private readonly activeChildren = new Map<string, ChildProcess>();
  private readonly partialLogBuffers = new Map<string, string>();
  private readonly pendingUpdateTaskIds = new Set<string>();
  private readonly titleCache = new Map<string, string>();
  private readonly attemptedTitleUrls = new Set<string>();
  private readonly titleLookupQueue: string[] = [];
  private activeTitleLookups = 0;
  private isDestroyed = false;
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  private sender: QueueUpdateSender | null = null;

  constructor(
    @Inject(BinaryLocatorService) private readonly binaryLocatorService: BinaryLocatorService,
    @Inject(SettingsService) private readonly settingsService: SettingsService
  ) {}

  onModuleDestroy(): void {
    this.isDestroyed = true;
    this.titleLookupQueue.length = 0;
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
  }

  setUpdateSender(sender: QueueUpdateSender): void {
    this.sender = sender;
  }

  loadHistory(): void {
    const historyPath = this.getHistoryPath();
    if (!existsSync(historyPath)) {
      return;
    }

    try {
      const parsedHistory = JSON.parse(readFileSync(historyPath, 'utf8')) as DownloadTask[];
      let hasTitleRecovery = false;

      this.queue = parsedHistory.map((task) => {
        const nextTask: DownloadTask =
          task.status === 'running'
            ? {
                ...task,
                status: 'failed',
                finishedAt: task.finishedAt ?? Date.now(),
                log: [...task.log, 'Скачивание было прервано при закрытии приложения.']
              }
            : { ...task };

        if (isUnresolvedTaskTitle(nextTask)) {
          const logTitle = extractTitleFromLogLines(nextTask.log);
          if (logTitle) {
            nextTask.title = logTitle;
            hasTitleRecovery = true;
          }
        }

        if (!isUnresolvedTaskTitle(nextTask) && nextTask.title) {
          this.titleCache.set(nextTask.url, nextTask.title);
        }

        return nextTask;
      });

      for (const task of this.queue) {
        if (isUnresolvedTaskTitle(task)) {
          const cachedTitle = this.titleCache.get(task.url);
          if (cachedTitle) {
            task.title = cachedTitle;
            hasTitleRecovery = true;
          }
        }
      }

      if (
        hasTitleRecovery ||
        this.queue.some((task, index) => task.status !== parsedHistory[index]?.status)
      ) {
        this.persistHistory();
      }

      const unresolvedTasks = [...this.queue]
        .filter((task) => isUnresolvedTaskTitle(task))
        .sort((left, right) => right.createdAt - left.createdAt);
      for (const task of unresolvedTasks) {
        this.enqueueTitleResolution(task.url);
      }
    } catch (error) {
      console.error(
        `[history:error] Не удалось прочитать историю: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      );
    }
  }

  list(): DownloadTask[] {
    return this.cloneQueue();
  }

  /** Возвращает число задач, которые будут прерваны при закрытии приложения. */
  getPendingTaskCounts(): { active: number; queued: number } {
    return {
      active: this.queue.filter((task) => task.status === 'running').length,
      queued: this.queue.filter((task) => task.status === 'queued').length
    };
  }

  add(payload: AddDownloadPayload): DownloadTask {
    const url = payload.url.trim();
    if (!url) {
      throw new Error('Ссылка не может быть пустой.');
    }

    if (this.queue.some((task) => task.url === url)) {
      throw new Error('Эта ссылка уже добавлена.');
    }

    const taskId = crypto.randomUUID();
    const taskConfiguration = this.settingsService.buildTaskConfiguration(
      taskId,
      payload.optionsText
    );
    const task: DownloadTask = {
      id: taskId,
      url,
      title: this.titleCache.get(url) ?? url,
      ...taskConfiguration,
      downloadDir: payload.downloadDir.trim() || this.settingsService.get().downloadDir,
      status: 'queued',
      createdAt: Date.now(),
      userMessage: null,
      log: ['Добавлено в очередь.']
    };

    this.queue.unshift(task);
    this.emitQueueUpdate(task);
    if (isUnresolvedTaskTitle(task)) {
      this.enqueueTitleResolution(url, true);
    }
    this.startNext();

    return this.cloneTask(task);
  }

  retry(taskId: string): DownloadTask {
    const originalTask = this.queue.find((task) => task.id === taskId);
    if (!originalTask) {
      throw new Error('Задача не найдена.');
    }

    const currentSettings = this.settingsService.get();

    const newTaskId = crypto.randomUUID();
    const taskConfiguration = this.settingsService.buildTaskConfiguration(newTaskId, '');
    const task: DownloadTask = {
      id: newTaskId,
      url: originalTask.url,
      title: originalTask.url,
      ...taskConfiguration,
      downloadDir: currentSettings.downloadDir,
      status: 'queued',
      createdAt: Date.now(),
      progress: null,
      userMessage: null,
      log: ['Добавлено в очередь повторно с актуальными настройками.']
    };

    const knownTitle =
      (!isUnresolvedTaskTitle(originalTask) ? originalTask.title : undefined) ??
      this.titleCache.get(originalTask.url);
    if (knownTitle) {
      task.title = knownTitle;
      this.titleCache.set(originalTask.url, knownTitle);
    } else {
      this.attemptedTitleUrls.delete(originalTask.url);
    }

    this.queue.push(task);
    this.emitQueueUpdate(task);
    if (isUnresolvedTaskTitle(task)) {
      this.enqueueTitleResolution(task.url, true);
    }
    this.startNext();

    return this.cloneTask(task);
  }

  clearHistory(): DownloadTask[] {
    this.queue = this.queue.filter((task) => task.status === 'running');
    this.persistHistory();

    return this.cloneQueue();
  }

  remove(taskId: string): DownloadTask[] {
    const task = this.queue.find((item) => item.id === taskId);
    if (!task) {
      throw new Error('Задача не найдена.');
    }

    if (task.status === 'running') {
      throw new Error('Нельзя удалить активную задачу.');
    }

    this.queue = this.queue.filter((item) => item.id !== taskId);
    this.persistHistory();

    return this.cloneQueue();
  }

  /** Отменяет ожидающую задачу или завершает запущенный процесс yt-dlp. */
  cancel(taskId: string): DownloadTask {
    const task = this.queue.find((item) => item.id === taskId);
    if (!task) {
      throw new Error('Задача не найдена.');
    }

    if (task.status !== 'queued' && task.status !== 'running') {
      throw new Error('Можно отменить только ожидающую или активную задачу.');
    }

    task.status = 'cancelled';
    task.finishedAt = Date.now();
    task.userMessage = null;
    task.log.push('Скачивание отменено пользователем.');
    this.emitQueueUpdate(task);

    if (task.startedAt === undefined) {
      this.startNext();
      return this.cloneTask(task);
    }

    const child = this.activeChildren.get(task.id);
    if (!child || !child.kill('SIGTERM')) {
      this.finishCancelledTask(task);
    }

    return this.cloneTask(task);
  }

  startNext(): void {
    const settings = this.settingsService.get();

    while (this.activeTaskIds.size < settings.maxConcurrentDownloads) {
      const task = this.queue.find((item) => item.status === 'queued');
      if (!task) {
        return;
      }

      task.status = 'running';
      task.startedAt = Date.now();
      this.activeTaskIds.add(task.id);
      const ytdlpPath = this.binaryLocatorService.getYtdlpPath(
        this.settingsService.get().ytdlpPath
      );

      if (!ytdlpPath) {
        task.status = 'failed';
        task.finishedAt = Date.now();
        task.log.push(
          'Не найден исполняемый файл yt-dlp. Установи yt-dlp в /opt/homebrew/bin, /usr/local/bin или ~/.local/bin.'
        );
        this.activeTaskIds.delete(task.id);
        this.emitQueueUpdate(task);
        continue;
      }

      task.userMessage = null;
      task.log.push(`Запуск yt-dlp в папке: ${task.downloadDir}`);
      task.log.push(`Используется бинарник: ${ytdlpPath}`);
      task.log.push(`Конфигурация yt-dlp:\n${task.effectiveConfigText}`);
      this.emitQueueUpdate(task);

      const baseArgs = this.settingsService.parseOptions(task.optionsText);
      const args = [...baseArgs, ...this.buildTitlePrintArgs(baseArgs), task.url];
      const child = spawn(ytdlpPath, args, {
        cwd: task.downloadDir,
        shell: false
      });
      this.activeChildren.set(task.id, child);

      child.stdout.on('data', (chunk: Buffer) => this.pushLog(task, chunk));
      child.stderr.on('data', (chunk: Buffer) => this.pushLog(task, chunk));

      child.on('error', (error) => {
        this.flushPartialLogBuffer(task);
        if (task.status === 'cancelled') {
          this.finishCancelledTask(task);
          return;
        }

        task.status = 'failed';
        task.finishedAt = Date.now();
        task.userMessage =
          'Не удалось запустить yt-dlp. Проверь установку приложения и доступность бинарника.';
        task.log.push(`Ошибка запуска yt-dlp: ${error.message}`);
        this.activeTaskIds.delete(task.id);
        this.activeChildren.delete(task.id);
        this.emitQueueUpdate(task);
        this.startNext();
      });

      child.on('close', (code) => {
        this.flushPartialLogBuffer(task);
        if (task.status === 'cancelled') {
          this.finishCancelledTask(task);
          return;
        }

        if (task.status !== 'failed' && code === 0) {
          task.status = 'done';
          task.progress = 100;
          task.exitCode = code;
          task.finishedAt = Date.now();
          task.userMessage = null;
          task.log.push('Скачивание завершено.');
        } else if (task.status !== 'failed') {
          const failure = this.analyzeFailure(task);
          task.status = 'failed';
          task.exitCode = code;
          task.finishedAt = Date.now();
          task.userMessage = failure.userMessage;
          task.log.push(`yt-dlp завершился с кодом ${code}.`);
        }

        this.activeTaskIds.delete(task.id);
        this.activeChildren.delete(task.id);
        this.emitQueueUpdate(task);
        if (isUnresolvedTaskTitle(task)) {
          this.enqueueTitleResolution(task.url);
        }
        this.startNext();
      });
    }
  }

  /** Освобождает слот очереди после завершения отменённого процесса. */
  private finishCancelledTask(task: DownloadTask): void {
    this.partialLogBuffers.delete(task.id);
    if (!this.activeTaskIds.delete(task.id)) {
      return;
    }

    this.activeChildren.delete(task.id);
    this.emitQueueUpdate(task);
    this.startNext();
  }

  private getHistoryPath(): string {
    return join(app.getPath('userData'), 'download-history.json');
  }

  private persistHistory(): void {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(this.getHistoryPath(), JSON.stringify(this.queue, null, 2), 'utf8');
  }

  private emitQueueUpdate(task: DownloadTask, persist = true): void {
    if (persist) {
      this.persistHistory();
    }

    this.sender?.({
      task: this.cloneTask(task),
      queue: this.cloneQueue()
    });
  }

  private scheduleQueueUpdate(task: DownloadTask): void {
    this.persistHistory();
    this.pendingUpdateTaskIds.add(task.id);

    if (this.updateTimer) {
      return;
    }

    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      const taskId = [...this.pendingUpdateTaskIds].at(-1);
      this.pendingUpdateTaskIds.clear();
      const updatedTask = this.queue.find((item) => item.id === taskId);
      if (updatedTask) {
        this.emitQueueUpdate(updatedTask, false);
      }
    }, 250);
  }

  private parseDownloadProgress(line: string): number | null {
    const match = line.match(/\[download]\s+(\d+(?:\.\d+)?)%/);
    if (!match) {
      return null;
    }

    const progress = Number(match[1]);
    return Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null;
  }

  private buildTitlePrintArgs(args: string[]): string[] {
    const hasSimulationOption = args.some((arg) =>
      ['-s', '--simulate', '-j', '--dump-json', '-J', '--dump-single-json'].includes(arg)
    );
    if (hasSimulationOption) {
      return [];
    }

    return [
      '--no-simulate',
      '--print',
      `pre_process:${SAVVY_TITLE_PREFIX}%(playlist_title,title)s`
    ];
  }

  private analyzeFailure(task: DownloadTask): FailureDetails {
    const logText = task.log.join('\n');

    if (
      /n challenge solving failed/i.test(logText) ||
      /Only images are available for download/i.test(logText) ||
      /Requested format is not available/i.test(logText)
    ) {
      return {
        userMessage: YOUTUBE_JS_RUNTIME_MESSAGE
      };
    }

    if (/HTTP Error 403:\s*Forbidden/i.test(logText)) {
      return {
        userMessage:
          'Сервер отклонил загрузку видео (HTTP 403). Открой рекомендации в деталях задачи: они помогут безопасно настроить cookies, частоту запросов или сеть.'
      };
    }

    if (this.isXConnectionTimeout(logText)) {
      return {
        userMessage: X_TIMEOUT_MESSAGE
      };
    }

    return {
      userMessage: null
    };
  }

  private pushLog(task: DownloadTask, chunk: Buffer): void {
    const buffered = (this.partialLogBuffers.get(task.id) ?? '') + chunk.toString('utf8');
    const parts = buffered.split(/\r?\n|\r/);
    const remainder = parts.pop() ?? '';
    this.partialLogBuffers.set(task.id, remainder);

    const lines = parts.map((line) => line.trimEnd()).filter(Boolean);
    if (!lines.length) {
      return;
    }

    this.processLogLines(task, lines);
  }

  private flushPartialLogBuffer(task: DownloadTask): void {
    const remainder = this.partialLogBuffers.get(task.id)?.trimEnd();
    this.partialLogBuffers.delete(task.id);
    if (remainder) {
      this.processLogLines(task, [remainder]);
    }
  }

  private processLogLines(task: DownloadTask, lines: string[]): void {
    const visibleLines: string[] = [];
    let titleUpdated = false;

    for (const line of lines) {
      const progress = this.parseDownloadProgress(line);
      if (progress !== null) {
        task.progress = progress;
      }

      const title = parseTitleFromLogLine(line);
      if (title && task.title === task.url) {
        task.title = title;
        this.applyResolvedTitle(task.url, title, false);
        titleUpdated = true;
      }

      if (line.trim().startsWith(SAVVY_TITLE_PREFIX)) {
        continue;
      }

      if (/HTTP Error 403:\s*Forbidden/i.test(line)) {
        task.userMessage =
          'Сервер отклонил загрузку видео (HTTP 403). Открой рекомендации в деталях задачи: они помогут безопасно настроить cookies, частоту запросов или сеть.';
      }

      if (
        /n challenge solving failed/i.test(line) ||
        /Only images are available for download/i.test(line)
      ) {
        task.userMessage = YOUTUBE_JS_RUNTIME_MESSAGE;
      }

      if (this.isXConnectionTimeout(line)) {
        task.userMessage = X_TIMEOUT_MESSAGE;
      }

      visibleLines.push(line);
    }

    if (visibleLines.length) {
      task.log.push(...visibleLines);
      task.log = task.log.slice(-300);
    }

    if (visibleLines.length || titleUpdated) {
      this.scheduleQueueUpdate(task);
    }
  }

  /** Добавляет URL в фоновую очередь определения названия видео. */
  private enqueueTitleResolution(url: string, prioritize = false): void {
    if (this.isDestroyed || this.titleCache.has(url) || this.attemptedTitleUrls.has(url)) {
      return;
    }

    this.attemptedTitleUrls.add(url);
    if (prioritize) {
      this.titleLookupQueue.unshift(url);
    } else {
      this.titleLookupQueue.push(url);
    }
    this.drainTitleLookupQueue();
  }

  private drainTitleLookupQueue(): void {
    while (
      !this.isDestroyed &&
      this.activeTitleLookups < MAX_CONCURRENT_TITLE_LOOKUPS &&
      this.titleLookupQueue.length > 0
    ) {
      const url = this.titleLookupQueue.shift();
      if (!url) {
        continue;
      }

      this.activeTitleLookups += 1;
      void this.resolveTitleInBackground(url).finally(() => {
        this.activeTitleLookups -= 1;
        this.drainTitleLookupQueue();
      });
    }
  }

  private async resolveTitleInBackground(url: string): Promise<void> {
    if (this.isDestroyed || this.titleCache.has(url)) {
      return;
    }

    const matchingTask = this.queue.find((item) => item.url === url);
    if (!matchingTask) {
      return;
    }

    const resolvedTitle =
      (await this.fetchOembedTitle(getYoutubeOembedUrl(url))) ??
      (this.isUrlCurrentlyRunning(url)
        ? null
        : await this.fetchYtdlpMetadataTitle(url, matchingTask.optionsText)) ??
      (await this.fetchOembedTitle(getTwitterOembedUrl(url))) ??
      (await this.fetchHtmlMetadataTitle(url));

    if (!this.isDestroyed && resolvedTitle) {
      this.applyResolvedTitle(url, resolvedTitle, true);
    }
  }

  private isUrlCurrentlyRunning(url: string): boolean {
    return this.queue.some((item) => item.url === url && this.activeTaskIds.has(item.id));
  }

  private applyResolvedTitle(url: string, title: string, emitUpdate: boolean): void {
    this.titleCache.set(url, title);

    let firstUpdatedTask: DownloadTask | null = null;
    for (const item of this.queue) {
      if (item.url === url && isUnresolvedTaskTitle(item)) {
        item.title = title;
        firstUpdatedTask ??= item;
      }
    }

    if (emitUpdate && firstUpdatedTask) {
      this.emitQueueUpdate(firstUpdatedTask);
    }
  }

  private async fetchOembedTitle(oembedUrl: string | null): Promise<string | null> {
    if (!oembedUrl) {
      return null;
    }

    try {
      const response = await fetch(oembedUrl, {
        signal: AbortSignal.timeout(METADATA_FETCH_TIMEOUT_MS)
      });
      if (!response.ok) {
        return null;
      }

      const data: unknown = await response.json();
      return parseOembedTitle(data);
    } catch {
      return null;
    }
  }

  private async fetchYtdlpMetadataTitle(
    url: string,
    taskOptionsText: string
  ): Promise<string | null> {
    const ytdlpPath = this.binaryLocatorService.getYtdlpPath(this.settingsService.get().ytdlpPath);
    if (!ytdlpPath) {
      return null;
    }

    const baseArgs = this.buildSafeMetadataBaseArgs(taskOptionsText);
    const args = [
      ...baseArgs,
      '--skip-download',
      '--no-warnings',
      '--ignore-no-formats-error',
      '--no-download-archive',
      '--no-write-info-json',
      '--no-write-thumbnail',
      '--no-write-subs',
      '--no-write-auto-subs',
      '--no-write-description',
      '--no-write-comments',
      '--flat-playlist',
      '--playlist-items',
      '1',
      '--print',
      '%(playlist_title,title)s',
      url
    ];

    try {
      const { stdout } = await execFileAsync(ytdlpPath, args, {
        timeout: YTDLP_METADATA_TIMEOUT_MS
      });
      const firstLine = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0 && line !== 'NA');
      return firstLine ?? null;
    } catch {
      return null;
    }
  }

  private buildSafeMetadataBaseArgs(taskOptionsText: string): string[] {
    const parsedArgs = this.settingsService.parseOptions(taskOptionsText);
    const safeArgs: string[] = [];

    for (let index = 0; index < parsedArgs.length; index += 1) {
      const arg = parsedArgs[index];
      if (arg === '--config-locations') {
        const configPath = parsedArgs[index + 1];
        if (configPath && existsSync(configPath)) {
          safeArgs.push(arg, configPath);
        }
        index += 1;
        continue;
      }

      if (arg.startsWith('--config-locations=')) {
        const configPath = arg.slice('--config-locations='.length);
        if (configPath && existsSync(configPath)) {
          safeArgs.push(arg);
        }
        continue;
      }

      safeArgs.push(arg);
    }

    return safeArgs;
  }

  private async fetchHtmlMetadataTitle(url: string): Promise<string | null> {
    try {
      const parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return null;
      }

      const response = await fetch(url, {
        signal: AbortSignal.timeout(METADATA_FETCH_TIMEOUT_MS),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept-Language': 'ru,en;q=0.9'
        }
      });
      if (!response.ok) {
        return null;
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().includes('text/html')) {
        return null;
      }

      const html = (await response.text()).slice(0, 128 * 1024);
      return extractHtmlTitle(html);
    } catch {
      return null;
    }
  }

  private isXConnectionTimeout(text: string): boolean {
    return /\[twitter]\s+\d+:/i.test(text) && /Connection to x\.com timed out/i.test(text);
  }

  private cloneTask(task: DownloadTask): DownloadTask {
    return { ...task, log: [...task.log] };
  }

  private cloneQueue(): DownloadTask[] {
    const statusOrder: Record<DownloadTask['status'], number> = {
      running: 0,
      queued: 1,
      cancelled: 2,
      failed: 3,
      done: 4
    };

    return this.queue
      .map((task) => this.cloneTask(task))
      .sort((left, right) => {
        const statusDelta = statusOrder[left.status] - statusOrder[right.status];
        if (statusDelta !== 0) {
          return statusDelta;
        }

        return right.createdAt - left.createdAt;
      });
  }
}

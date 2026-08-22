import { Inject, Injectable } from '@nestjs/common';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, extname, join } from 'node:path';
import type { AddDownloadPayload, DownloadTask, DownloadUpdate } from '../../shared/types';
import { BinaryLocatorService } from './binary-locator.service';
import { SettingsService } from './settings.service';

const require = createRequire(import.meta.url);
const { app } = require('electron') as typeof import('electron');

type QueueUpdateSender = (update: DownloadUpdate) => void;
type FailureDetails = {
  userMessage: string | null;
};

const YOUTUBE_JS_RUNTIME_MESSAGE =
  'YouTube не отдал видеоформаты: yt-dlp не смог решить n challenge. Добавь в дополнительные аргументы "--js-runtimes deno" или обнови yt-dlp/JS runtime.';
const X_TIMEOUT_MESSAGE =
  'Не удалось подключиться к x.com: соединение истекло по таймауту. Для Twitter/X проверь доступ к сайту из этой сети, укажи Proxy/VPN в настройках сети, при необходимости увеличь "Таймаут сокета" и используй cookies из браузера.';

@Injectable()
export class DownloadsService {
  private queue: DownloadTask[] = [];
  private readonly activeTaskIds = new Set<string>();
  private readonly activeChildren = new Map<string, ChildProcess>();
  private readonly pendingUpdateTaskIds = new Set<string>();
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  private sender: QueueUpdateSender | null = null;

  constructor(
    @Inject(BinaryLocatorService) private readonly binaryLocatorService: BinaryLocatorService,
    @Inject(SettingsService) private readonly settingsService: SettingsService
  ) {}

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
      this.queue = parsedHistory.map((task) => {
        if (task.status !== 'running') {
          return task;
        }

        return {
          ...task,
          status: 'failed',
          finishedAt: task.finishedAt ?? Date.now(),
          log: [...task.log, 'Скачивание было прервано при закрытии приложения.']
        };
      });
      this.persistHistory();
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
      title: url,
      ...taskConfiguration,
      downloadDir: payload.downloadDir.trim() || this.settingsService.get().downloadDir,
      status: 'queued',
      createdAt: Date.now(),
      userMessage: null,
      log: ['Добавлено в очередь.']
    };

    this.queue.unshift(task);
    this.emitQueueUpdate(task);
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

    this.queue.push(task);
    this.emitQueueUpdate(task);
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

      const args = [...this.settingsService.parseOptions(task.optionsText), task.url];
      const child = spawn(ytdlpPath, args, {
        cwd: task.downloadDir,
        shell: false
      });
      this.activeChildren.set(task.id, child);

      child.stdout.on('data', (chunk: Buffer) => this.pushLog(task, chunk));
      child.stderr.on('data', (chunk: Buffer) => this.pushLog(task, chunk));

      child.on('error', (error) => {
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
        this.startNext();
      });
    }
  }

  /** Освобождает слот очереди после завершения отменённого процесса. */
  private finishCancelledTask(task: DownloadTask): void {
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

  private parseTitleFromLogLine(line: string): string | null {
    const match = line.match(
      /\[(?:download|ExtractAudio|Merger|MoveFiles)]\s+Destination:\s+(.+)$/
    );
    if (!match) {
      return null;
    }

    const filename = basename(match[1].trim());
    const extension = extname(filename);
    const title = extension ? filename.slice(0, -extension.length) : filename;

    return title || null;
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
    const text = chunk.toString('utf8');
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);

    for (const line of lines) {
      const progress = this.parseDownloadProgress(line);
      if (progress !== null) {
        task.progress = progress;
      }

      const title = this.parseTitleFromLogLine(line);
      if (title && task.title === task.url) {
        task.title = title;
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
    }

    task.log.push(...lines);
    task.log = task.log.slice(-300);
    this.scheduleQueueUpdate(task);
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

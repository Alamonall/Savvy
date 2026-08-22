import { Inject, Injectable } from '@nestjs/common';
import { createRequire } from 'node:module';
import electronUpdater, {
  type AppUpdater,
  type ProgressInfo,
  type UpdateInfo
} from 'electron-updater';
import type { ApplicationUpdateState } from '../../shared/types';
import { ApplicationUpdateError } from '../errors/application-update.error';
import { DownloadsService } from './downloads.service';

const require = createRequire(import.meta.url);
const { app } = require('electron') as typeof import('electron');

type ApplicationUpdateSender = (update: ApplicationUpdateState) => void;

/** Управляет ручным скачиванием и установкой подписанных обновлений приложения. */
@Injectable()
export class ApplicationUpdaterService {
  private updater: AppUpdater | null = null;
  private sender: ApplicationUpdateSender | null = null;
  private isExplicitDownloadRequested = false;
  private state: Omit<ApplicationUpdateState, 'activeDownloadCount' | 'queuedDownloadCount'> = {
    status: 'idle',
    currentVersion: app.getVersion(),
    version: null,
    releaseNotes: null,
    releaseUrl: null,
    downloadPercent: null,
    errorMessage: null,
    requiresManualDownload: false
  };

  constructor(@Inject(DownloadsService) private readonly downloadsService: DownloadsService) {}

  /** Подключает renderer-процесс к последующим изменениям состояния обновления. */
  setUpdateSender(sender: ApplicationUpdateSender): void {
    this.sender = sender;
  }

  /** Запускает тихую проверку только в установленной сборке. */
  initialize(): void {
    if (!app.isPackaged || this.updater) {
      return;
    }

    const { autoUpdater } = electronUpdater;
    this.updater = autoUpdater;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowPrerelease = true;
    this.updater.channel = 'alpha';
    this.registerUpdaterEvents(this.updater);
    void this.checkForUpdates();
  }

  /** Возвращает актуальное состояние вместе с числом незавершённых загрузок. */
  getState(): ApplicationUpdateState {
    const counts = this.downloadsService.getPendingTaskCounts();
    return {
      ...this.state,
      activeDownloadCount: counts.active,
      queuedDownloadCount: counts.queued
    };
  }

  /** Скачивает уже найденное обновление по явному действию пользователя. */
  async download(): Promise<void> {
    if (!this.updater || this.state.status !== 'available') {
      throw new ApplicationUpdateError('Обновление ещё не готово к скачиванию.');
    }

    this.isExplicitDownloadRequested = true;
    this.updateState({ status: 'downloading', downloadPercent: 0, errorMessage: null });
    await this.updater.downloadUpdate();
  }

  /** Устанавливает скачанное обновление после подтверждения прерывания задач. */
  install(confirmedActiveDownloadCount: number, confirmedQueuedDownloadCount: number): void {
    if (!this.updater || this.state.status !== 'downloaded') {
      throw new ApplicationUpdateError('Обновление ещё не скачано.');
    }

    const counts = this.downloadsService.getPendingTaskCounts();
    if (
      counts.active !== confirmedActiveDownloadCount ||
      counts.queued !== confirmedQueuedDownloadCount
    ) {
      throw new ApplicationUpdateError(
        'Состояние загрузок изменилось. Проверь предупреждение и подтверди установку ещё раз.'
      );
    }

    this.updater.quitAndInstall(false, true);
  }

  /** Подписывается на события electron-updater и переводит их в стабильный UI-контракт. */
  private registerUpdaterEvents(updater: AppUpdater): void {
    updater.on('update-available', (info) => this.handleUpdateAvailable(info));
    updater.on('download-progress', (progress) => this.handleDownloadProgress(progress));
    updater.on('update-downloaded', (info) => this.handleUpdateDownloaded(info));
    updater.on('error', (error) => this.handleUpdaterError(error));
  }

  /** Выполняет проверку без пользовательской ошибки, когда GitHub временно недоступен. */
  private async checkForUpdates(): Promise<void> {
    try {
      await this.updater?.checkForUpdates();
    } catch {
      // Автоматическая проверка не должна отвлекать пользователя сетевой ошибкой.
    }
  }

  /** Сохраняет метаданные найденного релиза до явного скачивания. */
  private handleUpdateAvailable(info: UpdateInfo): void {
    this.updateState({
      status: 'available',
      version: info.version,
      releaseNotes: this.formatReleaseNotes(info.releaseNotes),
      releaseUrl: `https://github.com/Alamonall/Savvy/releases/tag/v${info.version}`,
      downloadPercent: null,
      errorMessage: null,
      requiresManualDownload: process.platform === 'linux' && !process.env.APPIMAGE
    });
  }

  /** Передаёт округлённый прогресс скачивания без частых лишних перерисовок. */
  private handleDownloadProgress(progress: ProgressInfo): void {
    this.updateState({ downloadPercent: Math.round(progress.percent) });
  }

  /** Разрешает установку только после полной проверки и загрузки updater-пакета. */
  private handleUpdateDownloaded(info: UpdateInfo): void {
    this.updateState({
      status: 'downloaded',
      version: info.version,
      releaseNotes: this.formatReleaseNotes(info.releaseNotes),
      downloadPercent: 100,
      errorMessage: null
    });
  }

  /** Показывает ошибку только если пользователь сам начал скачивание обновления. */
  private handleUpdaterError(error: Error): void {
    if (!this.isExplicitDownloadRequested) {
      return;
    }

    this.isExplicitDownloadRequested = false;
    this.updateState({
      status: 'available',
      downloadPercent: null,
      errorMessage: `Не удалось скачать обновление: ${error.message}`
    });
  }

  /** Приводит Notes GitHub к короткому тексту для tooltip без HTML из внешнего источника. */
  private formatReleaseNotes(notes: UpdateInfo['releaseNotes']): string | null {
    if (typeof notes === 'string') {
      return notes.trim() || null;
    }

    const text = notes
      ?.map((note) => note.note)
      .filter(Boolean)
      .join('\n')
      .trim();
    return text || null;
  }

  /** Обновляет локальное состояние и уведомляет подключённый renderer. */
  private updateState(nextState: Partial<typeof this.state>): void {
    this.state = { ...this.state, ...nextState };
    this.sender?.(this.getState());
  }
}

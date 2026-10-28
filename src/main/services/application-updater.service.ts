import { Inject, Injectable } from '@nestjs/common';
import { createRequire } from 'node:module';
import electronUpdater, {
  type AppUpdater,
  type ProgressInfo,
  type UpdateInfo
} from 'electron-updater';
import type { ApplicationUpdateState } from '../../shared/types';
import { isManualDownloadRequired } from '../application-update-capabilities';
import { ApplicationUpdateError } from '../errors/application-update.error';
import { parseReleaseChanges } from '../release-changes';
import { DownloadsService } from './downloads.service';

const require = createRequire(import.meta.url);
const { app } = require('electron') as typeof import('electron');

/** Интервал фоновой проверки обновлений в установленной сборке. */
const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

type ApplicationUpdateSender = (update: ApplicationUpdateState) => void;

/** Управляет ручным скачиванием и установкой подписанных обновлений приложения. */
@Injectable()
export class ApplicationUpdaterService {
  private updater: AppUpdater | null = null;
  private sender: ApplicationUpdateSender | null = null;
  private checkTimer: NodeJS.Timeout | null = null;
  private state: Omit<ApplicationUpdateState, 'activeDownloadCount' | 'queuedDownloadCount'> = {
    status: 'idle',
    currentVersion: app.getVersion(),
    version: null,
    changes: [],
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

  /** Запускает тихую проверку только в установленной сборке и повторяет её по расписанию. */
  initialize(): void {
    if (!app.isPackaged || this.updater) {
      return;
    }

    const { autoUpdater } = electronUpdater;
    this.updater = autoUpdater;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = true;
    this.updater.allowPrerelease = true;
    this.updater.channel = 'alpha';
    this.registerUpdaterEvents(this.updater);
    void this.checkForUpdatesSilently().finally(() => this.startPeriodicChecks());
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

  /** Проверяет наличие обновления по явному действию пользователя и пробрасывает ошибку в UI. */
  async check(): Promise<void> {
    if (!this.updater) {
      throw new ApplicationUpdateError(
        'Проверка обновлений доступна только в установленной сборке.'
      );
    }

    if (this.hasDownloadInProgressOrReady()) {
      return;
    }

    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      throw new ApplicationUpdateError(
        `Не удалось проверить обновления: ${getErrorMessage(error)}`
      );
    }
  }

  /** Скачивает уже найденное обновление по явному действию пользователя или повторяет неудачное скачивание. */
  async download(): Promise<void> {
    if (!this.updater || (this.state.status !== 'available' && this.state.status !== 'error')) {
      throw new ApplicationUpdateError('Обновление ещё не готово к скачиванию.');
    }

    this.updateState({ status: 'downloading', downloadPercent: 0, errorMessage: null });

    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      // Отклонённый downloadUpdate() — единственный источник ошибки скачивания.
      if (this.getState().status === 'downloading') {
        this.markDownloadFailed(error);
      }
    }
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
    // Событие error нужно только чтобы EventEmitter не бросил исключение: ошибку скачивания
    // download() получает из отклонённого downloadUpdate(), а проверки сообщают её сами.
    updater.on('error', () => undefined);
  }

  /** Выполняет проверку без пользовательской ошибки, когда GitHub временно недоступен. */
  private async checkForUpdatesSilently(): Promise<void> {
    try {
      await this.updater?.checkForUpdates();
    } catch {
      // Автоматическая проверка не должна отвлекать пользователя сетевой ошибкой.
    }
  }

  /** Запускает периодическую фоновую проверку; во время скачивания или готовой установки она пропускается. */
  private startPeriodicChecks(): void {
    this.checkTimer = setInterval(() => {
      if (this.hasDownloadInProgressOrReady()) {
        return;
      }

      void this.checkForUpdatesSilently();
    }, UPDATE_CHECK_INTERVAL_MS);
    this.checkTimer.unref();
  }

  /** Сохраняет метаданные найденного релиза до явного скачивания. */
  private handleUpdateAvailable(info: UpdateInfo): void {
    if (this.hasDownloadInProgressOrReady()) {
      return;
    }

    this.updateState({
      status: 'available',
      version: info.version,
      changes: parseReleaseChanges(info.releaseNotes),
      releaseUrl: `https://github.com/Alamonall/Savvy/releases/tag/v${info.version}`,
      downloadPercent: null,
      errorMessage: null,
      requiresManualDownload: isManualDownloadRequired(process.platform, process.env.APPIMAGE)
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
      changes: parseReleaseChanges(info.releaseNotes),
      downloadPercent: 100,
      errorMessage: null
    });
  }

  /** Переводит состояние в ошибку скачивания, сохраняя данные релиза для повторной попытки. */
  private markDownloadFailed(error: unknown): void {
    this.updateState({
      status: 'error',
      downloadPercent: null,
      errorMessage: `Не удалось скачать обновление: ${getErrorMessage(error)}`
    });
  }

  /** Проверяет, идёт ли скачивание или уже готов пакет, которое нельзя сбрасывать проверкой. */
  private hasDownloadInProgressOrReady(): boolean {
    return this.state.status === 'downloading' || this.state.status === 'downloaded';
  }

  /** Обновляет локальное состояние и уведомляет подключённый renderer. */
  private updateState(nextState: Partial<typeof this.state>): void {
    this.state = { ...this.state, ...nextState };
    this.sender?.(this.getState());
  }
}

/** Достаёт читаемый текст из ошибки любого типа, которую мог выбросить electron-updater. */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

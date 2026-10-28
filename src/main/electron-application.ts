import { NestFactory } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import type { INestApplicationContext } from '@nestjs/common';
import type { AddDownloadPayload, AppSettings } from '../shared/types';
import { AppModule } from './app.module';
import { ApplicationUpdaterService } from './services/application-updater.service';
import { BinaryLocatorService } from './services/binary-locator.service';
import { DownloadsService } from './services/downloads.service';
import { ElectronShellService } from './services/electron-shell.service';
import { SettingsService } from './services/settings.service';

const require = createRequire(import.meta.url);
const { app, BrowserWindow, Notification, ipcMain } =
  require('electron') as typeof import('electron');

type RuntimeServices = {
  applicationUpdater: ApplicationUpdaterService;
  binaryLocator: BinaryLocatorService;
  downloads: DownloadsService;
  settings: SettingsService;
  shell: ElectronShellService;
};

/** Управляет жизненным циклом Electron main-процесса и IPC-контрактом. */
export class ElectronApplication {
  private mainWindow: BrowserWindowType | null = null;
  private nestApp: INestApplicationContext | null = null;
  private services: RuntimeServices | null = null;

  /** Запускает Nest-контекст, IPC-обработчики и главное окно приложения. */
  async start(): Promise<void> {
    app.setAppUserModelId('com.alamonall.savvy');
    this.nestApp = await NestFactory.createApplicationContext(AppModule, { logger: false });
    this.services = {
      applicationUpdater: this.nestApp.get(ApplicationUpdaterService),
      binaryLocator: this.nestApp.get(BinaryLocatorService),
      downloads: this.nestApp.get(DownloadsService),
      settings: this.nestApp.get(SettingsService),
      shell: this.nestApp.get(ElectronShellService)
    };

    this.services.settings.init();
    this.services.downloads.loadHistory();
    this.services.downloads.setUpdateSender((update) => {
      this.mainWindow?.webContents.send('downloads:update', update);

      if (update.task.status === 'done') {
        this.showDownloadDoneNotification(update.task.title || update.task.url);
      }
    });
    this.services.applicationUpdater.setUpdateSender((update) => {
      this.mainWindow?.webContents.send('application-update:update', update);
    });

    this.registerIpcHandlers();
    this.setDockIcon();
    this.createWindow();
    this.services.applicationUpdater.initialize();
    app.on('activate', this.handleActivate);
  }

  private readonly handleActivate = (): void => {
    if (BrowserWindow.getAllWindows().length === 0) {
      this.createWindow();
    }
  };

  private readonly handleWindowAllClosed = (): void => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  };

  private getRuntimeServices(): RuntimeServices {
    if (!this.services) {
      throw new Error('Сервисы приложения ещё не инициализированы.');
    }

    return this.services;
  }

  private createWindow(): void {
    this.mainWindow = new BrowserWindow({
      width: 980,
      height: 720,
      minWidth: 760,
      minHeight: 560,
      title: 'Savvy',
      icon: this.getAppIconPath(),
      backgroundColor: '#f6f7f9',
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    const { shell } = this.getRuntimeServices();
    shell.setMainWindow(this.mainWindow);
    this.mainWindow.webContents.on('console-message', ({ level, message }) => {
      console[level === 'error' ? 'error' : 'log'](`[renderer:${level}] ${message}`);
    });
    this.mainWindow.webContents.on('did-fail-load', (_event, _code, description) => {
      console.error(`[renderer:error] Failed to load renderer: ${description}`);
    });
    this.mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[renderer:error] Renderer process gone: ${details.reason}`);
    });
    this.mainWindow.on('closed', () => {
      shell.setMainWindow(null);
      this.mainWindow = null;
    });

    if (process.env.ELECTRON_RENDERER_URL) {
      void this.mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      void this.mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
    }
  }

  private getAppIconPath(): string | undefined {
    const candidates = [
      join(app.getAppPath(), 'src/renderer/public/savvy.png'),
      join(__dirname, '../renderer/savvy.png')
    ];

    return candidates.find((iconPath) => existsSync(iconPath));
  }

  private setDockIcon(): void {
    if (process.platform !== 'darwin' || !app.dock) {
      return;
    }

    const iconPath = this.getAppIconPath();
    if (iconPath) {
      app.dock.setIcon(iconPath);
    }
  }

  private showDownloadDoneNotification(title: string): void {
    if (!Notification.isSupported()) {
      return;
    }

    new Notification({
      title: 'Видео скачалось',
      body: title,
      icon: this.getAppIconPath()
    }).show();
  }

  private registerIpcHandlers(): void {
    const { applicationUpdater, binaryLocator, downloads, settings, shell } =
      this.getRuntimeServices();
    ipcMain.handle('downloads:add', (_, payload: AddDownloadPayload) => downloads.add(payload));
    ipcMain.handle('downloads:retry', (_, taskId: string) => downloads.retry(taskId));
    ipcMain.handle('downloads:cancel', (_, taskId: string) => downloads.cancel(taskId));
    ipcMain.handle('downloads:remove', (_, taskId: string) => downloads.remove(taskId));
    ipcMain.handle('downloads:list', () => downloads.list());
    ipcMain.handle('downloads:clear-history', () => downloads.clearHistory());
    ipcMain.handle('application-update:get', () => applicationUpdater.getState());
    ipcMain.handle('application-update:download', () => applicationUpdater.download());
    ipcMain.handle(
      'application-update:install',
      (_, confirmedActiveDownloadCount: number, confirmedQueuedDownloadCount: number) =>
        applicationUpdater.install(confirmedActiveDownloadCount, confirmedQueuedDownloadCount)
    );
    ipcMain.handle('settings:get', () => settings.get());
    ipcMain.handle('settings:get-ytdlp-binary-info', () =>
      binaryLocator.getYtdlpBinaryInfo(settings.get().ytdlpPath)
    );
    ipcMain.handle('settings:update-ytdlp-binary', () =>
      binaryLocator.updateYtdlpBinary(settings.get().ytdlpPath, settings.get().ytdlpReleaseChannel)
    );
    ipcMain.handle('settings:find-ytdlp-binaries', () => binaryLocator.findYtdlpBinaries());
    ipcMain.handle('settings:install-ytdlp-binary', (_, channel) =>
      binaryLocator.installYtdlpBinary(channel)
    );
    ipcMain.handle('settings:get-ytdlp-latest-release', (_, channel) =>
      binaryLocator.getYtdlpLatestRelease(channel)
    );
    ipcMain.handle('settings:choose-ytdlp-binary', () => shell.chooseYtdlpBinary());
    ipcMain.handle('settings:get-effective-options-preview', () =>
      settings.getEffectiveOptionsPreview()
    );
    ipcMain.handle('settings:get-effective-config-text', () => settings.getEffectiveConfigText());
    ipcMain.handle('settings:update', (_, nextSettings: AppSettings) => {
      const updatedSettings = settings.update(nextSettings);
      downloads.startNext();
      return updatedSettings;
    });
    ipcMain.handle('settings:list-folder-directories', (_, currentPath: string) =>
      shell.listFolderDirectories(currentPath)
    );
    ipcMain.handle('settings:suggest-folder-directories', (_, inputPath: string) =>
      shell.suggestFolderDirectories(inputPath)
    );
    ipcMain.handle('settings:import-config-file', () => shell.importConfigFile());
    ipcMain.handle('settings:import-config-file-by-path', (_, filePath: string) =>
      shell.importConfigFileByPath(filePath)
    );
    ipcMain.handle('shell:open-url', (_, url: string) => shell.openUrl(url));
    ipcMain.handle('shell:open-folder', (_, folderPath: string) => shell.openFolder(folderPath));
    app.on('window-all-closed', this.handleWindowAllClosed);
  }
}

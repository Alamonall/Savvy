import { NestFactory } from '@nestjs/core';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import type { INestApplicationContext } from '@nestjs/common';
import type { AddDownloadPayload, AppSettings } from '../shared/types';
import { AppModule } from './app.module';
import { DownloadsService } from './services/downloads.service';
import { ElectronShellService } from './services/electron-shell.service';
import { SettingsService } from './services/settings.service';

const require = createRequire(import.meta.url);
const { app, BrowserWindow, ipcMain } = require('electron') as typeof import('electron');

type RuntimeServices = {
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
    app.setAppUserModelId('com.ytdlp-my.app');
    this.nestApp = await NestFactory.createApplicationContext(AppModule, { logger: false });
    this.services = {
      downloads: this.nestApp.get(DownloadsService),
      settings: this.nestApp.get(SettingsService),
      shell: this.nestApp.get(ElectronShellService)
    };

    this.services.settings.init();
    this.services.downloads.loadHistory();
    this.services.downloads.setUpdateSender((update) => {
      this.mainWindow?.webContents.send('downloads:update', update);
    });

    this.registerIpcHandlers();
    this.createWindow();
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
      title: 'yt-dlp My',
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

  private registerIpcHandlers(): void {
    const { downloads, settings, shell } = this.getRuntimeServices();
    ipcMain.handle('downloads:add', (_, payload: AddDownloadPayload) => downloads.add(payload));
    ipcMain.handle('downloads:retry', (_, taskId: string) => downloads.retry(taskId));
    ipcMain.handle('downloads:remove', (_, taskId: string) => downloads.remove(taskId));
    ipcMain.handle('downloads:list', () => downloads.list());
    ipcMain.handle('downloads:clear-history', () => downloads.clearHistory());
    ipcMain.handle('settings:get', () => settings.get());
    ipcMain.handle('settings:get-effective-options-preview', () =>
      settings.getEffectiveOptionsPreview()
    );
    ipcMain.handle('settings:update', (_, nextSettings: AppSettings) => {
      const updatedSettings = settings.update(nextSettings);
      downloads.startNext();
      return updatedSettings;
    });
    ipcMain.handle('settings:choose-download-directory', (_, currentPath: string) =>
      shell.chooseDownloadDirectory(currentPath)
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

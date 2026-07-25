import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import type { AddDownloadPayload, AppSettings } from '../shared/types';
import { AppModule } from './app.module';
import { DownloadsService } from './services/downloads.service';
import { ElectronShellService } from './services/electron-shell.service';
import { SettingsService } from './services/settings.service';

const require = createRequire(import.meta.url);
const { app, BrowserWindow, ipcMain } = require('electron') as typeof import('electron');

let mainWindow: BrowserWindowType | null = null;
let downloadsService: DownloadsService;
let settingsService: SettingsService;
let shellService: ElectronShellService;

function createWindow(): void {
  mainWindow = new BrowserWindow({
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

  shellService.setMainWindow(mainWindow);

  mainWindow.webContents.on('console-message', ({ level, message }) => {
    console[level === 'error' ? 'error' : 'log'](`[renderer:${level}] ${message}`);
  });

  mainWindow.webContents.on('did-fail-load', (_event, _code, description) => {
    console.error(`[renderer:error] Failed to load renderer: ${description}`);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer:error] Renderer process gone: ${details.reason}`);
  });

  mainWindow.on('closed', () => {
    shellService.setMainWindow(null);
    mainWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('downloads:add', (_, payload: AddDownloadPayload) =>
    downloadsService.add(payload)
  );
  ipcMain.handle('downloads:retry', (_, taskId: string) => downloadsService.retry(taskId));
  ipcMain.handle('downloads:remove', (_, taskId: string) => downloadsService.remove(taskId));
  ipcMain.handle('downloads:list', () => downloadsService.list());
  ipcMain.handle('downloads:clear-history', () => downloadsService.clearHistory());
  ipcMain.handle('settings:get', () => settingsService.get());
  ipcMain.handle('settings:get-effective-options-preview', () =>
    settingsService.getEffectiveOptionsPreview()
  );
  ipcMain.handle('settings:update', (_, nextSettings: AppSettings) => {
    const settings = settingsService.update(nextSettings);
    downloadsService.startNext();
    return settings;
  });
  ipcMain.handle('settings:list-folder-directories', (_, currentPath: string) =>
    shellService.listFolderDirectories(currentPath)
  );
  ipcMain.handle('settings:suggest-folder-directories', (_, inputPath: string) =>
    shellService.suggestFolderDirectories(inputPath)
  );
  ipcMain.handle('settings:import-config-file', () => shellService.importConfigFile());
  ipcMain.handle('settings:import-config-file-by-path', (_, filePath: string) =>
    shellService.importConfigFileByPath(filePath)
  );
  ipcMain.handle('shell:open-url', (_, url: string) => shellService.openUrl(url));
  ipcMain.handle('shell:open-folder', (_, folderPath: string) =>
    shellService.openFolder(folderPath)
  );
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.ytdlp-my.app');

  const nestApp = await NestFactory.createApplicationContext(AppModule, {
    logger: false
  });

  settingsService = nestApp.get(SettingsService);
  downloadsService = nestApp.get(DownloadsService);
  shellService = nestApp.get(ElectronShellService);

  settingsService.init();
  downloadsService.loadHistory();
  downloadsService.setUpdateSender((update) => {
    mainWindow?.webContents.send('downloads:update', update);
  });

  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

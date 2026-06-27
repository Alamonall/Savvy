import { Inject, Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import type { AppSettings } from '../../shared/types';
import { SettingsService } from './settings.service';

const require = createRequire(import.meta.url);
const { dialog, shell } = require('electron') as typeof import('electron');

@Injectable()
export class ElectronShellService {
  private mainWindow: BrowserWindowType | null = null;

  constructor(@Inject(SettingsService) private readonly settingsService: SettingsService) {}

  setMainWindow(window: BrowserWindowType | null): void {
    this.mainWindow = window;
  }

  async chooseDownloadDirectory(currentPath: string): Promise<string | null> {
    const options: Electron.OpenDialogOptions = {
      defaultPath: currentPath || this.settingsService.get().downloadDir,
      properties: ['openDirectory', 'createDirectory']
    };

    const result = this.mainWindow
      ? await dialog.showOpenDialog(this.mainWindow, options)
      : await dialog.showOpenDialog(options);

    return result.canceled ? null : (result.filePaths.at(0) ?? null);
  }

  async importConfigFile(): Promise<AppSettings | null> {
    const options: Electron.OpenDialogOptions = {
      defaultPath: homedir(),
      filters: [{ name: 'yt-dlp config', extensions: ['conf', 'config', 'txt', '*'] }],
      properties: ['openFile']
    };

    const result = this.mainWindow
      ? await dialog.showOpenDialog(this.mainWindow, options)
      : await dialog.showOpenDialog(options);

    const filePath = result.canceled ? null : (result.filePaths.at(0) ?? null);
    if (!filePath) {
      return null;
    }

    const configText = readFileSync(filePath, 'utf8');
    return this.settingsService.importConfigText(configText);
  }

  async importConfigFileByPath(filePath: string): Promise<AppSettings> {
    const normalizedPath = filePath.trim();
    if (!normalizedPath) {
      throw new Error('Укажи путь к config-файлу.');
    }

    try {
      const configText = readFileSync(normalizedPath, 'utf8');
      return this.settingsService.importConfigText(configText);
    } catch (error) {
      throw new Error(
        `Не удалось импортировать config-файл: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  async openUrl(url: string): Promise<void> {
    const parsedUrl = new URL(url);

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Можно открыть только http/https ссылку.');
    }

    await shell.openExternal(parsedUrl.toString());
  }

  async openFolder(folderPath: string): Promise<void> {
    const errorMessage = await shell.openPath(folderPath);

    if (errorMessage) {
      throw new Error(errorMessage);
    }
  }
}

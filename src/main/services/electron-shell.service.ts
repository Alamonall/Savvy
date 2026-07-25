import { Inject, Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import type { AppSettings, FolderEntry, FolderListing } from '../../shared/types';
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

  /**
   * Возвращает директории текущего уровня для встроенного выбора папки.
   *
   * @param currentPath Путь к директории, которую нужно открыть.
   */
  async listFolderDirectories(currentPath: string): Promise<FolderListing> {
    const normalizedPath = this.normalizeFolderPath(currentPath);
    const directories = await this.readDirectories(normalizedPath);

    return {
      path: normalizedPath,
      displayPath: normalizedPath.replace(homedir(), '~'),
      parentPath: dirname(normalizedPath) === normalizedPath ? null : dirname(normalizedPath),
      directories
    };
  }

  /**
   * Возвращает директории, совпадающие с частично введенным путем.
   *
   * @param inputPath Частично введенный путь к директории.
   */
  async suggestFolderDirectories(inputPath: string): Promise<FolderEntry[]> {
    const expandedPath = this.expandHome(inputPath.trim() || homedir());
    const hasTrailingSeparator = expandedPath.endsWith('/');
    const parentPath = hasTrailingSeparator ? expandedPath : dirname(expandedPath);
    const prefix = hasTrailingSeparator ? '' : expandedPath.slice(parentPath.length + 1);
    let directories: FolderEntry[];
    try {
      directories = await this.readDirectories(resolve(parentPath));
    } catch (error) {
      if (this.isMissingDirectoryError(error)) {
        return [];
      }

      throw error;
    }

    return directories.filter((directory) =>
      directory.name.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
    );
  }

  private normalizeFolderPath(currentPath: string): string {
    return resolve(
      this.expandHome(currentPath.trim() || this.settingsService.get().downloadDir || homedir())
    );
  }

  private expandHome(path: string): string {
    return path.replace(/^~(?=$|\/)/, homedir());
  }

  private async readDirectories(directoryPath: string): Promise<FolderEntry[]> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const path = join(directoryPath, entry.name);
        return { name: entry.name, path, displayPath: this.toDisplayPath(path) };
      })
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
  }

  private toDisplayPath(path: string): string {
    return path.replace(homedir(), '~');
  }

  private isMissingDirectoryError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
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

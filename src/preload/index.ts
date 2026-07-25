import { createRequire } from 'node:module';
import type { IpcRendererEvent } from 'electron';
import type { AddDownloadPayload, AppSettings, DownloadUpdate, YtdlpApi } from '../shared/types';

const require = createRequire(import.meta.url);
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const api: YtdlpApi = {
  addDownload(payload: AddDownloadPayload) {
    return ipcRenderer.invoke('downloads:add', payload);
  },
  retryDownload(taskId: string) {
    return ipcRenderer.invoke('downloads:retry', taskId);
  },
  removeDownload(taskId: string) {
    return ipcRenderer.invoke('downloads:remove', taskId);
  },
  getQueue() {
    return ipcRenderer.invoke('downloads:list');
  },
  getSettings() {
    return ipcRenderer.invoke('settings:get');
  },
  updateSettings(settings: AppSettings) {
    return ipcRenderer.invoke('settings:update', settings);
  },
  getEffectiveOptionsPreview() {
    return ipcRenderer.invoke('settings:get-effective-options-preview');
  },
  listFolderDirectories(currentPath: string) {
    return ipcRenderer.invoke('settings:list-folder-directories', currentPath);
  },
  suggestFolderDirectories(inputPath: string) {
    return ipcRenderer.invoke('settings:suggest-folder-directories', inputPath);
  },
  importConfigFile() {
    return ipcRenderer.invoke('settings:import-config-file');
  },
  importConfigFileByPath(filePath: string) {
    return ipcRenderer.invoke('settings:import-config-file-by-path', filePath);
  },
  clearHistory() {
    return ipcRenderer.invoke('downloads:clear-history');
  },
  openUrl(url: string) {
    return ipcRenderer.invoke('shell:open-url', url);
  },
  openFolder(path: string) {
    return ipcRenderer.invoke('shell:open-folder', path);
  },
  onQueueUpdate(callback: (update: DownloadUpdate) => void) {
    const listener = (_event: IpcRendererEvent, update: DownloadUpdate): void => {
      callback(update);
    };

    ipcRenderer.on('downloads:update', listener);

    return () => {
      ipcRenderer.off('downloads:update', listener);
    };
  }
};

contextBridge.exposeInMainWorld('ytdlp', api);

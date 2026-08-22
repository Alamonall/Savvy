import { createRequire } from 'node:module';
import type { IpcRendererEvent } from 'electron';
import type {
  AddDownloadPayload,
  ApplicationUpdateState,
  AppSettings,
  DownloadUpdate,
  YtdlpApi,
  YtdlpReleaseChannel
} from '../shared/types';

const require = createRequire(import.meta.url);
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const api: YtdlpApi = {
  addDownload(payload: AddDownloadPayload) {
    return ipcRenderer.invoke('downloads:add', payload);
  },
  retryDownload(taskId: string) {
    return ipcRenderer.invoke('downloads:retry', taskId);
  },
  cancelDownload(taskId: string) {
    return ipcRenderer.invoke('downloads:cancel', taskId);
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
  getYtdlpBinaryInfo() {
    return ipcRenderer.invoke('settings:get-ytdlp-binary-info');
  },
  updateYtdlpBinary() {
    return ipcRenderer.invoke('settings:update-ytdlp-binary');
  },
  findYtdlpBinaries() {
    return ipcRenderer.invoke('settings:find-ytdlp-binaries');
  },
  installYtdlpBinary(channel: YtdlpReleaseChannel) {
    return ipcRenderer.invoke('settings:install-ytdlp-binary', channel);
  },
  getYtdlpLatestRelease(channel: YtdlpReleaseChannel) {
    return ipcRenderer.invoke('settings:get-ytdlp-latest-release', channel);
  },
  chooseYtdlpBinary() {
    return ipcRenderer.invoke('settings:choose-ytdlp-binary');
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
  getApplicationUpdate() {
    return ipcRenderer.invoke('application-update:get');
  },
  downloadApplicationUpdate() {
    return ipcRenderer.invoke('application-update:download');
  },
  installApplicationUpdate(
    confirmedActiveDownloadCount: number,
    confirmedQueuedDownloadCount: number
  ) {
    return ipcRenderer.invoke(
      'application-update:install',
      confirmedActiveDownloadCount,
      confirmedQueuedDownloadCount
    );
  },
  onQueueUpdate(callback: (update: DownloadUpdate) => void) {
    const listener = (_event: IpcRendererEvent, update: DownloadUpdate): void => {
      callback(update);
    };

    ipcRenderer.on('downloads:update', listener);

    return () => {
      ipcRenderer.off('downloads:update', listener);
    };
  },
  onApplicationUpdate(callback: (update: ApplicationUpdateState) => void) {
    const listener = (_event: IpcRendererEvent, update: ApplicationUpdateState): void => {
      callback(update);
    };

    ipcRenderer.on('application-update:update', listener);

    return () => {
      ipcRenderer.off('application-update:update', listener);
    };
  }
};

contextBridge.exposeInMainWorld('ytdlp', api);

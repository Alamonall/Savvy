export type DownloadStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface DownloadTask {
  id: string;
  url: string;
  title?: string;
  optionsText: string;
  effectiveConfigText: string;
  downloadDir: string;
  status: DownloadStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  exitCode?: number | null;
  progress?: number | null;
  userMessage?: string | null;
  log: string[];
}

export interface AddDownloadPayload {
  url: string;
  optionsText: string;
  downloadDir: string;
}

export interface AppSettings {
  ytdlpPath: string;
  ytdlpReleaseChannel: YtdlpReleaseChannel;
  downloadDir: string;
  maxConcurrentDownloads: number;
  inlineConfigText: string;
  customizedOptionKeys: string[];
  downloadDirectlyToSelectedFolder: boolean;
  extractAudio: boolean;
  audioFormat: string;
  writeThumbnail: boolean;
  writeSubtitles: boolean;
  embedMetadata: boolean;
  sponsorBlock: boolean;
  outputTemplate: string;
  pathsTemp: string;
  format: string;
  formatSort: string;
  mergeOutputFormat: string;
  remuxVideo: string;
  recodeVideo: string;
  audioQuality: string;
  subtitlesLangs: string;
  convertSubtitles: string;
  proxy: string;
  socketTimeout: string;
  retries: string;
  fragmentRetries: string;
  concurrentFragments: number;
  playlistStart: string;
  playlistEnd: string;
  maxDownloads: string;
  dateAfter: string;
  dateBefore: string;
  matchFilter: string;
  downloadArchive: string;
  cookiesFile: string;
  netrc: boolean;
  netrcLocation: string;
  username: string;
  extractorArgs: string;
  externalDownloader: string;
  externalDownloaderArgs: string;
  ffmpegLocation: string;
  postprocessorArgs: string;
  ignoreErrors: boolean;
  noWarnings: boolean;
  forceOverwrites: boolean;
  noOverwrites: boolean;
  continueDownload: boolean;
  noPart: boolean;
  restrictFilenames: boolean;
  windowsFilenames: boolean;
  writeDescription: boolean;
  writeInfoJson: boolean;
  writeComments: boolean;
  writeAutoSubtitles: boolean;
  embedSubtitles: boolean;
  embedThumbnail: boolean;
  splitChapters: boolean;
  removeChapters: string;
  sponsorBlockMark: string;
  rateLimit: string;
  cookiesFromBrowser: string;
  additionalOptions: string;
}

export interface YtdlpBinaryInfo {
  path: string | null;
  version: string | null;
}

export type YtdlpReleaseChannel = 'stable' | 'nightly';

export interface YtdlpBinaryCandidate extends YtdlpBinaryInfo {
  source: 'app-managed' | 'system';
}

export interface DownloadUpdate {
  task: DownloadTask;
  queue: DownloadTask[];
}

export interface FolderEntry {
  name: string;
  path: string;
  displayPath: string;
}

export interface FolderListing {
  path: string;
  displayPath: string;
  parentPath: string | null;
  directories: FolderEntry[];
}

export interface YtdlpApi {
  addDownload(payload: AddDownloadPayload): Promise<DownloadTask>;
  retryDownload(taskId: string): Promise<DownloadTask>;
  cancelDownload(taskId: string): Promise<DownloadTask>;
  removeDownload(taskId: string): Promise<DownloadTask[]>;
  getQueue(): Promise<DownloadTask[]>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: AppSettings): Promise<AppSettings>;
  getYtdlpBinaryInfo(): Promise<YtdlpBinaryInfo>;
  updateYtdlpBinary(): Promise<YtdlpBinaryInfo>;
  findYtdlpBinaries(): Promise<YtdlpBinaryCandidate[]>;
  installYtdlpBinary(channel: YtdlpReleaseChannel): Promise<YtdlpBinaryInfo>;
  getYtdlpLatestRelease(channel: YtdlpReleaseChannel): Promise<string>;
  chooseYtdlpBinary(): Promise<string | null>;
  getEffectiveOptionsPreview(): Promise<string>;
  listFolderDirectories(currentPath: string): Promise<FolderListing>;
  suggestFolderDirectories(inputPath: string): Promise<FolderEntry[]>;
  importConfigFile(): Promise<AppSettings | null>;
  importConfigFileByPath(filePath: string): Promise<AppSettings>;
  clearHistory(): Promise<DownloadTask[]>;
  openUrl(url: string): Promise<void>;
  openFolder(path: string): Promise<void>;
  onQueueUpdate(callback: (update: DownloadUpdate) => void): () => void;
}

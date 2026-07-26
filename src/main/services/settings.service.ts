import { Inject, Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { AppSettings } from '../../shared/types';
import { DEFAULT_YTDLP_CONFIG } from '../default-ytdlp-config';
import { BinaryLocatorService } from './binary-locator.service';

const require = createRequire(import.meta.url);
const { app } = require('electron') as typeof import('electron');

@Injectable()
export class SettingsService {
  private settings: AppSettings | null = null;

  constructor(
    @Inject(BinaryLocatorService)
    private readonly binaryLocatorService: BinaryLocatorService
  ) {}

  init(): void {
    const configText = this.loadAppConfigText();
    const defaultSettings = this.applyYtdlpConfigArgs(
      { ...this.createDefaultSettings(), inlineConfigText: configText },
      this.parseYtdlpConfigText(configText)
    );
    const persistedSettings = this.loadPersistedSettings();

    this.settings = persistedSettings
      ? {
          ...defaultSettings,
          ...persistedSettings,
          inlineConfigText: configText
        }
      : defaultSettings;

    this.writeAppConfigText(this.settings.inlineConfigText);
  }

  get(): AppSettings {
    this.settings ??= this.createDefaultSettings();
    return this.settings;
  }

  update(nextSettings: AppSettings): AppSettings {
    const currentSettings = this.get();
    const maxConcurrentDownloads = Number(nextSettings.maxConcurrentDownloads);

    const normalizedSettings: AppSettings = {
      ...currentSettings,
      ...nextSettings,
      downloadDir: nextSettings.downloadDir.trim() || currentSettings.downloadDir,
      maxConcurrentDownloads: Number.isFinite(maxConcurrentDownloads)
        ? Math.max(1, Math.min(8, Math.floor(maxConcurrentDownloads)))
        : currentSettings.maxConcurrentDownloads
    };

    if (normalizedSettings.forceOverwrites && normalizedSettings.noOverwrites) {
      normalizedSettings.noOverwrites = false;
    }

    if (normalizedSettings.cookiesFromBrowser.trim() && normalizedSettings.cookiesFile.trim()) {
      normalizedSettings.cookiesFile = '';
    }

    if (normalizedSettings.remuxVideo.trim() && normalizedSettings.recodeVideo.trim()) {
      normalizedSettings.recodeVideo = '';
    }

    this.settings = normalizedSettings;

    this.persistSettings();

    return this.settings;
  }

  buildTaskOptionsText(optionsText: string): string {
    const appSettings = this.get();
    const configArgs: string[] = [];
    const managedArgs = this.buildManagedOptionsArgs(appSettings);
    const inlineConfigPath = this.writeInlineConfigIfNeeded();

    if (inlineConfigPath) {
      configArgs.push('--config-locations', inlineConfigPath);
    }

    return [this.serializeArgs(configArgs), this.serializeArgs(managedArgs), optionsText.trim()]
      .filter(Boolean)
      .join(' ');
  }

  getEffectiveOptionsPreview(): string {
    return this.buildTaskOptionsText('');
  }

  parseOptions(optionsText: string): string[] {
    const args: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    let escaped = false;

    for (const char of optionsText.trim()) {
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (quote) {
        if (char === quote) {
          quote = null;
        } else {
          current += char;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }

      if (/\s/.test(char)) {
        if (current) {
          args.push(current);
          current = '';
        }
        continue;
      }

      current += char;
    }

    if (escaped) {
      current += '\\';
    }

    if (current) {
      args.push(current);
    }

    return args;
  }

  importConfigText(configText: string): AppSettings {
    const currentSettings = this.get();
    const parsedArgs = this.parseYtdlpConfigText(configText).filter(
      (arg) => arg !== '--config-locations' && !arg.startsWith('--config-locations=')
    );

    return this.update({
      ...this.applyYtdlpConfigArgs(currentSettings, parsedArgs),
      inlineConfigText: configText.trim()
    });
  }

  private createDefaultSettings(): AppSettings {
    return {
      downloadDir: app.getPath('downloads'),
      maxConcurrentDownloads: 1,
      inlineConfigText: this.getDefaultConfigText(),
      downloadDirectlyToSelectedFolder: false,
      extractAudio: false,
      audioFormat: 'mp3',
      writeThumbnail: false,
      writeSubtitles: false,
      embedMetadata: true,
      sponsorBlock: false,
      outputTemplate: '%(title)s.%(ext)s',
      pathsTemp: '',
      format: '',
      formatSort: '',
      mergeOutputFormat: '',
      remuxVideo: '',
      recodeVideo: '',
      audioQuality: '',
      subtitlesLangs: '',
      convertSubtitles: '',
      proxy: '',
      socketTimeout: '',
      retries: '',
      fragmentRetries: '',
      concurrentFragments: 1,
      playlistStart: '',
      playlistEnd: '',
      maxDownloads: '',
      dateAfter: '',
      dateBefore: '',
      matchFilter: '',
      downloadArchive: join(app.getPath('downloads'), '.yt-dlp-archive.txt'),
      cookiesFile: '',
      netrc: false,
      netrcLocation: '',
      username: '',
      extractorArgs: '',
      externalDownloader: '',
      externalDownloaderArgs: '',
      ffmpegLocation: '',
      postprocessorArgs: '',
      ignoreErrors: false,
      noWarnings: false,
      forceOverwrites: false,
      noOverwrites: false,
      continueDownload: true,
      noPart: false,
      restrictFilenames: false,
      windowsFilenames: false,
      writeDescription: false,
      writeInfoJson: false,
      writeComments: false,
      writeAutoSubtitles: false,
      embedSubtitles: false,
      embedThumbnail: false,
      splitChapters: false,
      removeChapters: '',
      sponsorBlockMark: '',
      rateLimit: '',
      cookiesFromBrowser: '',
      additionalOptions: ''
    };
  }

  private buildManagedOptionsArgs(appSettings: AppSettings): string[] {
    const args: string[] = [];

    if (appSettings.outputTemplate.trim()) {
      args.push('--output', appSettings.outputTemplate.trim());
    }

    if (appSettings.pathsTemp.trim()) {
      args.push('--paths', `temp:${appSettings.pathsTemp.trim()}`);
    }

    if (appSettings.downloadDirectlyToSelectedFolder) {
      args.push('--paths', 'home:.', '--paths', 'temp:.');
    }

    if (appSettings.format.trim()) {
      args.push('--format', appSettings.format.trim());
    }

    if (appSettings.formatSort.trim()) {
      args.push('--format-sort', appSettings.formatSort.trim());
    }

    if (appSettings.mergeOutputFormat.trim()) {
      args.push('--merge-output-format', appSettings.mergeOutputFormat.trim());
    }

    if (appSettings.remuxVideo.trim()) {
      args.push('--remux-video', appSettings.remuxVideo.trim());
    }

    if (appSettings.recodeVideo.trim()) {
      args.push('--recode-video', appSettings.recodeVideo.trim());
    }

    if (appSettings.extractAudio) {
      args.push('--extract-audio', '--audio-format', appSettings.audioFormat);

      if (appSettings.audioQuality.trim()) {
        args.push('--audio-quality', appSettings.audioQuality.trim());
      }
    }

    if (appSettings.writeThumbnail) {
      args.push('--write-thumbnail');
    }

    if (appSettings.embedThumbnail) {
      args.push('--embed-thumbnail');
    }

    if (appSettings.writeSubtitles) {
      args.push('--write-subs', '--sub-langs', appSettings.subtitlesLangs.trim() || 'all');
    }

    if (appSettings.writeAutoSubtitles) {
      args.push('--write-auto-subs', '--sub-langs', appSettings.subtitlesLangs.trim() || 'all');
    }

    if (appSettings.convertSubtitles.trim()) {
      args.push('--convert-subs', appSettings.convertSubtitles.trim());
    }

    if (appSettings.embedSubtitles) {
      args.push('--embed-subs');
    }

    if (appSettings.embedMetadata) {
      args.push('--embed-metadata');
    }

    if (appSettings.writeDescription) {
      args.push('--write-description');
    }

    if (appSettings.writeInfoJson) {
      args.push('--write-info-json');
    }

    if (appSettings.writeComments) {
      args.push('--write-comments');
    }

    if (appSettings.splitChapters) {
      args.push('--split-chapters');
    }

    if (appSettings.removeChapters.trim()) {
      args.push('--remove-chapters', appSettings.removeChapters.trim());
    }

    if (appSettings.sponsorBlock) {
      args.push('--sponsorblock-remove', 'sponsor,selfpromo,interaction');
    }

    if (appSettings.sponsorBlockMark.trim()) {
      args.push('--sponsorblock-mark', appSettings.sponsorBlockMark.trim());
    }

    if (appSettings.rateLimit.trim()) {
      args.push('--limit-rate', appSettings.rateLimit.trim());
    }

    if (appSettings.proxy.trim()) {
      args.push('--proxy', appSettings.proxy.trim());
    }

    if (appSettings.socketTimeout.trim()) {
      args.push('--socket-timeout', appSettings.socketTimeout.trim());
    }

    if (appSettings.retries.trim()) {
      args.push('--retries', appSettings.retries.trim());
    }

    if (appSettings.fragmentRetries.trim()) {
      args.push('--fragment-retries', appSettings.fragmentRetries.trim());
    }

    if (appSettings.concurrentFragments > 1) {
      args.push('--concurrent-fragments', String(appSettings.concurrentFragments));
    }

    if (appSettings.playlistStart.trim()) {
      args.push('--playlist-start', appSettings.playlistStart.trim());
    }

    if (appSettings.playlistEnd.trim()) {
      args.push('--playlist-end', appSettings.playlistEnd.trim());
    }

    if (appSettings.maxDownloads.trim()) {
      args.push('--max-downloads', appSettings.maxDownloads.trim());
    }

    if (appSettings.dateAfter.trim()) {
      args.push('--dateafter', appSettings.dateAfter.trim());
    }

    if (appSettings.dateBefore.trim()) {
      args.push('--datebefore', appSettings.dateBefore.trim());
    }

    if (appSettings.matchFilter.trim()) {
      args.push('--match-filters', appSettings.matchFilter.trim());
    }

    if (appSettings.downloadArchive.trim()) {
      args.push('--download-archive', appSettings.downloadArchive.trim());
    }

    if (appSettings.cookiesFile.trim()) {
      args.push('--cookies', appSettings.cookiesFile.trim());
    }

    if (appSettings.cookiesFromBrowser.trim()) {
      args.push('--cookies-from-browser', appSettings.cookiesFromBrowser.trim());
    }

    if (appSettings.netrc) {
      args.push('--netrc');
    }

    if (appSettings.netrcLocation.trim()) {
      args.push('--netrc-location', appSettings.netrcLocation.trim());
    }

    if (appSettings.username.trim()) {
      args.push('--username', appSettings.username.trim());
    }

    if (appSettings.extractorArgs.trim()) {
      args.push('--extractor-args', appSettings.extractorArgs.trim());
    }

    if (appSettings.externalDownloader.trim()) {
      args.push('--downloader', appSettings.externalDownloader.trim());
    }

    if (appSettings.externalDownloaderArgs.trim()) {
      args.push('--downloader-args', appSettings.externalDownloaderArgs.trim());
    }

    if (appSettings.ffmpegLocation.trim()) {
      args.push('--ffmpeg-location', appSettings.ffmpegLocation.trim());
    }

    if (appSettings.postprocessorArgs.trim()) {
      args.push('--postprocessor-args', appSettings.postprocessorArgs.trim());
    }

    if (appSettings.ignoreErrors) {
      args.push('--ignore-errors');
    }

    if (appSettings.noWarnings) {
      args.push('--no-warnings');
    }

    if (appSettings.forceOverwrites) {
      args.push('--force-overwrites');
    }

    if (appSettings.noOverwrites) {
      args.push('--no-overwrites');
    }

    if (appSettings.continueDownload) {
      args.push('--continue');
    }

    if (appSettings.noPart) {
      args.push('--no-part');
    }

    if (appSettings.restrictFilenames) {
      args.push('--restrict-filenames');
    }

    if (appSettings.windowsFilenames) {
      args.push('--windows-filenames');
    }

    if (this.binaryLocatorService.getDenoPath() && !this.hasCustomJsRuntime(appSettings)) {
      args.push('--js-runtimes', 'deno');
    }

    const ffmpegDirectory = this.binaryLocatorService.getFfmpegDirectory();
    if (ffmpegDirectory && !appSettings.ffmpegLocation.trim()) {
      args.push('--ffmpeg-location', ffmpegDirectory);
    }

    if (appSettings.additionalOptions.trim()) {
      args.push(...this.parseOptions(appSettings.additionalOptions));
    }

    return args;
  }

  private hasCustomJsRuntime(appSettings: AppSettings): boolean {
    return [appSettings.inlineConfigText, appSettings.additionalOptions].some((text) =>
      /(^|\s)--js-runtimes(?:=|\s|$)/.test(text)
    );
  }

  private serializeArgs(args: string[]): string {
    return args.map((arg) => this.quoteArg(arg)).join(' ');
  }

  private quoteArg(value: string): string {
    if (!/[\s"'\\]/.test(value)) {
      return value;
    }

    return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  }

  private getSettingsPath(): string {
    return join(app.getPath('userData'), 'settings.json');
  }

  private loadPersistedSettings(): AppSettings | null {
    const settingsPath = this.getSettingsPath();
    if (!existsSync(settingsPath)) {
      return null;
    }

    try {
      return JSON.parse(readFileSync(settingsPath, 'utf8')) as AppSettings;
    } catch (error) {
      console.error(
        `[settings:error] Не удалось прочитать настройки: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      );
      return null;
    }
  }

  private persistSettings(): void {
    if (!this.settings) {
      return;
    }

    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(
      this.getSettingsPath(),
      JSON.stringify({ ...this.settings, inlineConfigText: undefined }, null, 2),
      'utf8'
    );
    this.writeAppConfigText(this.settings.inlineConfigText);
  }

  private parseYtdlpConfigText(configText: string): string[] {
    return configText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .flatMap((line) => this.parseOptions(line));
  }

  private valueAfter(args: string[], index: number): string | null {
    const current = args[index];
    const inlineValue = current.split('=').slice(1).join('=');

    if (inlineValue) {
      return inlineValue;
    }

    return args[index + 1] && !args[index + 1].startsWith('-') ? args[index + 1] : null;
  }

  private applyYtdlpConfigArgs(settingsFromConfig: AppSettings, args: string[]): AppSettings {
    const nextSettings = { ...settingsFromConfig };

    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];

      if (arg === '-x' || arg === '--extract-audio') {
        nextSettings.extractAudio = true;
      } else if (arg === '--write-thumbnail') {
        nextSettings.writeThumbnail = true;
      } else if (arg === '--write-subs' || arg === '--write-sub' || arg === '--write-auto-subs') {
        nextSettings.writeSubtitles = true;
      } else if (arg === '--embed-metadata' || arg === '--add-metadata') {
        nextSettings.embedMetadata = true;
      } else if (arg === '--sponsorblock-remove' || arg.startsWith('--sponsorblock-remove=')) {
        nextSettings.sponsorBlock = true;
      } else if (arg === '-o' || arg === '--output' || arg.startsWith('--output=')) {
        nextSettings.outputTemplate = this.valueAfter(args, index) ?? nextSettings.outputTemplate;
      } else if (arg === '--audio-format' || arg.startsWith('--audio-format=')) {
        nextSettings.audioFormat = this.valueAfter(args, index) ?? nextSettings.audioFormat;
      } else if (arg === '-r' || arg === '--limit-rate' || arg.startsWith('--limit-rate=')) {
        nextSettings.rateLimit = this.valueAfter(args, index) ?? nextSettings.rateLimit;
      } else if (arg === '--cookies-from-browser' || arg.startsWith('--cookies-from-browser=')) {
        nextSettings.cookiesFromBrowser =
          this.valueAfter(args, index) ?? nextSettings.cookiesFromBrowser;
      } else if (arg === '-P' || arg === '--paths' || arg.startsWith('--paths=')) {
        const pathsValue = this.valueAfter(args, index);
        if (pathsValue && !pathsValue.includes(':')) {
          nextSettings.downloadDir = pathsValue;
        } else if (pathsValue === '.' || pathsValue === 'home:.') {
          nextSettings.downloadDirectlyToSelectedFolder = true;
        }
      }
    }

    return nextSettings;
  }

  private getInlineConfigPath(): string {
    return join(app.getPath('userData'), 'yt-dlp.conf');
  }

  private getDefaultConfigText(): string {
    const downloadDirectory = this.formatConfigPath(app.getPath('downloads'));
    const downloadArchive = this.formatConfigPath(
      join(app.getPath('downloads'), '.yt-dlp-archive.txt')
    );

    return DEFAULT_YTDLP_CONFIG.replaceAll('__SAVVY_DOWNLOAD_DIR__', downloadDirectory).replaceAll(
      '__SAVVY_DOWNLOAD_ARCHIVE__',
      downloadArchive
    );
  }

  private formatConfigPath(path: string): string {
    const normalizedPath = path.replaceAll('\\', '/');
    return /\s/.test(normalizedPath) ? `"${normalizedPath}"` : normalizedPath;
  }

  private loadAppConfigText(): string {
    const configPath = this.getInlineConfigPath();

    if (existsSync(configPath)) {
      return readFileSync(configPath, 'utf8').trim();
    }

    const defaultConfigText = this.getDefaultConfigText();
    this.writeAppConfigText(defaultConfigText);
    return defaultConfigText.trim();
  }

  private writeAppConfigText(configText: string): void {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(this.getInlineConfigPath(), `${configText.trim()}\n`, 'utf8');
  }

  private writeInlineConfigIfNeeded(): string | null {
    const inlineConfigText = this.get().inlineConfigText.trim();

    if (!inlineConfigText) {
      return null;
    }

    mkdirSync(app.getPath('userData'), { recursive: true });
    const configPath = this.getInlineConfigPath();
    writeFileSync(configPath, `${inlineConfigText}\n`, 'utf8');

    return configPath;
  }
}

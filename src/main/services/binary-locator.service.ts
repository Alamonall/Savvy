import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import type {
  YtdlpBinaryCandidate,
  YtdlpBinaryInfo,
  YtdlpReleaseChannel
} from '../../shared/types';

const require = createRequire(import.meta.url);
const { app } = require('electron') as typeof import('electron');
const RELEASE_REPOSITORIES: Record<YtdlpReleaseChannel, string> = {
  stable: 'yt-dlp/yt-dlp',
  nightly: 'yt-dlp/yt-dlp-nightly-builds'
};
const MAX_MANAGED_BINARY_SIZE_BYTES = 100 * 1024 * 1024;

type GithubRelease = {
  tag_name: string;
};

@Injectable()
export class BinaryLocatorService {
  private readonly resolvedFfmpegPath = this.resolveBinaryPath('ffmpeg');

  /**
   * Возвращает выбранный пользователем исполняемый файл yt-dlp либо найденный автоматически.
   *
   * @param customPath Сохранённый путь к системному yt-dlp.
   */
  getYtdlpPath(customPath = ''): string | null {
    const normalizedCustomPath = customPath.trim();
    if (normalizedCustomPath) {
      return this.isExecutable(normalizedCustomPath) ? normalizedCustomPath : null;
    }

    return this.resolveBinaryPath('yt-dlp');
  }

  /**
   * Читает версию фактически используемого yt-dlp без запуска загрузки.
   *
   * @param customPath Сохранённый путь к системному yt-dlp.
   * @throws Когда бинарник отсутствует или не возвращает версию.
   */
  async getYtdlpBinaryInfo(customPath: string): Promise<YtdlpBinaryInfo> {
    const ytdlpPath = this.getYtdlpPath(customPath);
    if (!ytdlpPath) {
      return { path: null, version: null };
    }

    return { path: ytdlpPath, version: await this.runYtdlp(ytdlpPath, ['--version']) };
  }

  /**
   * Обновляет вручную выбранный release-бинарник yt-dlp и возвращает его новую версию.
   *
   * Автоматически найденный бинарник не обновляется, чтобы не изменить пакет,
   * которым управляет Homebrew, pip или pyenv.
   *
   * @param customPath Сохранённый путь к выбранному yt-dlp.
   * @throws Когда файл не выбран либо не поддерживает встроенное обновление.
   */
  async updateYtdlpBinary(
    customPath: string,
    channel: YtdlpReleaseChannel = 'stable'
  ): Promise<YtdlpBinaryInfo> {
    const selectedPath = customPath.trim();
    if (!selectedPath) {
      throw new Error('Сначала выбери файл yt-dlp для обновления.');
    }

    const ytdlpPath = this.getYtdlpPath(selectedPath);
    if (!ytdlpPath) {
      throw new Error('Выбранный файл yt-dlp недоступен или не является исполняемым.');
    }

    if (ytdlpPath === this.getManagedYtdlpPath()) {
      return this.installYtdlpBinary(channel);
    }

    try {
      await this.runYtdlp(ytdlpPath, ['-U']);
    } catch (error) {
      const details = error instanceof Error ? error.message : 'неизвестная ошибка';
      throw new Error(this.getManualUpdateInstructions(details));
    }

    return this.getYtdlpBinaryInfo(selectedPath);
  }

  /** Находит доступные исполняемые yt-dlp и показывает версию каждого кандидата. */
  async findYtdlpBinaries(): Promise<YtdlpBinaryCandidate[]> {
    const candidatePaths = [...new Set(this.getBinaryCandidates('yt-dlp'))].filter((candidate) =>
      this.isExecutable(candidate)
    );

    const candidates = await Promise.all(
      candidatePaths.map(async (candidatePath): Promise<YtdlpBinaryCandidate | null> => {
        try {
          return {
            path: candidatePath,
            version: await this.runYtdlp(candidatePath, ['--version']),
            source: candidatePath === this.getManagedYtdlpPath() ? 'app-managed' : 'system'
          };
        } catch {
          return null;
        }
      })
    );

    return candidates.filter((candidate): candidate is YtdlpBinaryCandidate => candidate !== null);
  }

  /** Запрашивает номер последнего опубликованного релиза выбранного официального канала. */
  async getYtdlpLatestRelease(channel: YtdlpReleaseChannel): Promise<string> {
    const repository = RELEASE_REPOSITORIES[channel];
    const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=1`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      throw new Error(`Не удалось проверить последнюю версию yt-dlp: HTTP ${response.status}.`);
    }

    const releases: unknown = await response.json();
    if (!this.isGithubReleaseList(releases) || !releases[0]) {
      throw new Error('GitHub не вернул опубликованную версию yt-dlp.');
    }

    return releases[0].tag_name;
  }

  /**
   * Скачивает standalone-бинарник из официального репозитория yt-dlp и сверяет SHA-256.
   * Файл заменяется только после успешной проверки контрольной суммы.
   */
  async installYtdlpBinary(channel: YtdlpReleaseChannel): Promise<YtdlpBinaryInfo> {
    const { asset, fileName } = this.getReleaseAsset();
    const repository = RELEASE_REPOSITORIES[channel];
    const releaseBaseUrl = `https://github.com/${repository}/releases/latest/download`;
    const [binaryResponse, checksumResponse] = await Promise.all([
      fetch(`${releaseBaseUrl}/${asset}`),
      fetch(`${releaseBaseUrl}/SHA2-256SUMS`)
    ]);

    if (!binaryResponse.ok || !checksumResponse.ok) {
      throw new Error(
        `Не удалось скачать официальный yt-dlp: бинарник HTTP ${binaryResponse.status}, checksum HTTP ${checksumResponse.status}.`
      );
    }

    const binary = Buffer.from(await binaryResponse.arrayBuffer());
    if (binary.length > MAX_MANAGED_BINARY_SIZE_BYTES) {
      throw new Error(
        'Размер скачанного yt-dlp превышает допустимый предел. Текущий бинарник не изменён.'
      );
    }
    this.verifyChecksum(asset, binary, await checksumResponse.text());

    const targetDirectory = join(app.getPath('userData'), 'bin');
    const targetPath = join(targetDirectory, fileName);
    const temporaryPath = `${targetPath}.${crypto.randomUUID()}.download`;
    await mkdir(targetDirectory, { recursive: true });
    await writeFile(temporaryPath, binary, { mode: 0o755 });

    try {
      if (process.platform !== 'win32') {
        await chmod(temporaryPath, 0o755);
      }
      if (existsSync(targetPath)) {
        await copyFile(temporaryPath, targetPath);
        await rm(temporaryPath, { force: true });
      } else {
        await rename(temporaryPath, targetPath);
      }
    } catch (error) {
      throw new Error(
        `Не удалось сохранить проверенный yt-dlp: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`
      );
    }

    return this.getYtdlpBinaryInfo(targetPath);
  }

  getFfmpegDirectory(): string | null {
    if (!this.resolvedFfmpegPath) {
      return null;
    }

    return this.resolvedFfmpegPath.replace(/\/[^/]+$/, '');
  }

  private resolveBinaryPath(binaryName: string): string | null {
    const candidates = this.getBinaryCandidates(binaryName);

    for (const candidate of candidates) {
      if (this.isExecutable(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private getBinaryCandidates(binaryName: string): string[] {
    const resourceCandidates = app.isPackaged
      ? [
          join(process.resourcesPath, 'bin', binaryName),
          join(process.resourcesPath, 'bin', `${binaryName}.bin`)
        ]
      : [];

    const pathCandidates = (process.env.PATH || '')
      .split(delimiter)
      .filter(Boolean)
      .map((directory) => join(directory, binaryName));

    return [
      binaryName === 'yt-dlp' ? this.getManagedYtdlpPath() : '',
      ...resourceCandidates,
      ...pathCandidates,
      `/opt/homebrew/bin/${binaryName}`,
      `/usr/local/bin/${binaryName}`,
      `/opt/local/bin/${binaryName}`,
      join(app.getPath('home'), '.local', 'bin', binaryName)
    ].filter(Boolean);
  }

  /** Возвращает каталог, которым Savvy управляет без прав администратора. */
  private getManagedYtdlpPath(): string {
    return join(
      app.getPath('userData'),
      'bin',
      process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
    );
  }

  /** Выбирает официальный standalone-asset для текущей платформы и архитектуры. */
  private getReleaseAsset(): { asset: string; fileName: string } {
    if (process.platform === 'darwin') {
      return { asset: 'yt-dlp_macos', fileName: 'yt-dlp' };
    }

    if (process.platform === 'win32') {
      return process.arch === 'arm64'
        ? { asset: 'yt-dlp_arm64.exe', fileName: 'yt-dlp.exe' }
        : { asset: 'yt-dlp.exe', fileName: 'yt-dlp.exe' };
    }

    if (process.platform === 'linux') {
      return process.arch === 'arm64'
        ? { asset: 'yt-dlp_linux_aarch64', fileName: 'yt-dlp' }
        : { asset: 'yt-dlp_linux', fileName: 'yt-dlp' };
    }

    throw new Error(
      `Платформа ${process.platform} не поддерживается для автоматической установки yt-dlp.`
    );
  }

  /** Сверяет SHA-256 скачанного asset с официальным файлом контрольных сумм релиза. */
  private verifyChecksum(asset: string, binary: Buffer, checksums: string): void {
    const expectedChecksum = checksums
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .find((parts) => parts.length >= 2 && parts.at(-1)?.replace(/^\*/, '') === asset)?.[0];
    const actualChecksum = createHash('sha256').update(binary).digest('hex');

    if (!expectedChecksum || expectedChecksum.toLowerCase() !== actualChecksum) {
      throw new Error(
        'Контрольная сумма официального yt-dlp не совпала. Текущий бинарник не изменён.'
      );
    }
  }

  /** Проверяет минимальную схему публичного ответа GitHub Releases API. */
  private isGithubReleaseList(value: unknown): value is GithubRelease[] {
    return (
      Array.isArray(value) &&
      value.every(
        (release) =>
          typeof release === 'object' &&
          release !== null &&
          'tag_name' in release &&
          typeof release.tag_name === 'string' &&
          release.tag_name.trim().length > 0
      )
    );
  }

  private isExecutable(filePath: string): boolean {
    if (!existsSync(filePath)) {
      return false;
    }

    try {
      accessSync(filePath, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  /** Объясняет, как обновить бинарник, которым управляет внешний менеджер пакетов. */
  private getManualUpdateInstructions(details: string): string {
    return [
      'Выбранный yt-dlp не поддерживает встроенное обновление.',
      'Обнови его тем же менеджером пакетов, которым он был установлен:',
      'brew upgrade yt-dlp или python -m pip install -U yt-dlp.',
      `Причина: ${details}`
    ].join(' ');
  }

  /** Выполняет служебную команду yt-dlp и возвращает её текстовый результат. */
  private async runYtdlp(ytdlpPath: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await promisify(execFile)(ytdlpPath, args, { timeout: 60_000 });
      return stdout.trim();
    } catch (error) {
      const details = error instanceof Error ? error.message : 'неизвестная ошибка';
      throw new Error(`Не удалось выполнить yt-dlp: ${details}`);
    }
  }
}

import { Injectable } from '@nestjs/common';
import { accessSync, constants, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, join } from 'node:path';

const require = createRequire(import.meta.url);
const { app } = require('electron') as typeof import('electron');

@Injectable()
export class BinaryLocatorService {
  private readonly resolvedYtdlpPath = this.resolveBinaryPath('yt-dlp');
  private readonly resolvedFfmpegPath = this.resolveBinaryPath('ffmpeg');
  private readonly resolvedDenoPath = this.resolveBinaryPath('deno');

  getYtdlpPath(): string | null {
    return this.resolvedYtdlpPath;
  }

  getFfmpegDirectory(): string | null {
    if (!this.resolvedFfmpegPath) {
      return null;
    }

    return this.resolvedFfmpegPath.replace(/\/[^/]+$/, '');
  }

  getDenoPath(): string | null {
    return this.resolvedDenoPath;
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
      ...resourceCandidates,
      ...pathCandidates,
      `/opt/homebrew/bin/${binaryName}`,
      `/usr/local/bin/${binaryName}`,
      `/opt/local/bin/${binaryName}`,
      join(app.getPath('home'), '.local', 'bin', binaryName)
    ];
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
}

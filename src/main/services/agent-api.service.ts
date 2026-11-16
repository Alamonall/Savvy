import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { AgentApiStatus } from '../../shared/types';
import { AgentHttpServer } from '../agent-http-server';
import { DownloadsService } from './downloads.service';
import { SettingsService } from './settings.service';

const require = createRequire(import.meta.url);
const { app } = require('electron') as typeof import('electron');

const DEFAULT_AGENT_API_PORT = 47832;

/** Управляет локальным HTTP/MCP-сервером для ИИ-агентов и файлом обнаружения. */
@Injectable()
export class AgentApiService implements OnModuleDestroy {
  private httpServer: AgentHttpServer | null = null;
  private token = '';
  private errorMessage: string | null = null;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(
    @Inject(DownloadsService) private readonly downloadsService: DownloadsService,
    @Inject(SettingsService) private readonly settingsService: SettingsService
  ) {}

  /** Останавливает HTTP-сервер и обновляет файл обнаружения при завершении работы модуля. */
  async onModuleDestroy(): Promise<void> {
    await this.enqueueOperation(async () => {
      await this.stopServer();
    });
  }

  /** Инициализирует токен и запускает сервер, если API для ИИ-агентов включён в настройках. */
  async initialize(): Promise<void> {
    try {
      this.token = this.loadOrCreateToken();
      this.errorMessage = null;
    } catch (error) {
      this.errorMessage =
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить токен сервера для ИИ-агентов.';
      console.error(`[agent-api:error] ${this.errorMessage}`);
      return;
    }

    await this.syncWithSettings();
  }

  /** Синхронизирует состояние сервера с настройкой `agentApiEnabled`. */
  async syncWithSettings(): Promise<AgentApiStatus> {
    await this.enqueueOperation(async () => {
      const enabled = this.settingsService.get().agentApiEnabled;

      if (enabled && !this.httpServer) {
        if (!this.token) {
          this.token = this.loadOrCreateToken();
        }
        await this.startServer();
      } else if (!enabled && this.httpServer) {
        await this.stopServer();
      } else if (!enabled) {
        this.writeDiscoveryFile(null);
      }
    });

    return this.getStatus();
  }

  /** Перегенерирует Bearer-токен и обновляет файл обнаружения, если сервер запущен. */
  regenerateToken(): AgentApiStatus {
    this.token = randomBytes(32).toString('hex');
    this.persistToken(this.token);
    if (this.httpServer?.getPort()) {
      this.writeDiscoveryFile(this.httpServer.getPort() as number);
    }
    return this.getStatus();
  }

  /** Возвращает текущее состояние локального API и пути для подключения ИИ-агентов. */
  getStatus(): AgentApiStatus {
    if (!this.token && !this.errorMessage) {
      try {
        this.token = this.loadOrCreateToken();
      } catch (error) {
        this.errorMessage =
          error instanceof Error
            ? error.message
            : 'Не удалось загрузить токен сервера для ИИ-агентов.';
      }
    }

    const enabled = this.settingsService.get().agentApiEnabled;
    const port = this.httpServer?.getPort() ?? null;
    const running = port !== null;
    const baseUrl = running ? `http://127.0.0.1:${port}` : null;

    return {
      enabled,
      running,
      port,
      baseUrl,
      mcpHttpUrl: baseUrl ? `${baseUrl}/mcp` : null,
      mcpScriptPath: this.getMcpScriptPath(),
      discoveryFilePath: this.getDiscoveryFilePath(),
      token: this.token,
      errorMessage: this.errorMessage
    };
  }

  private enqueueOperation(operation: () => Promise<void>): Promise<void> {
    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.catch((error) => {
      this.errorMessage =
        error instanceof Error ? error.message : 'Ошибка управления сервером для ИИ-агентов.';
      console.error(`[agent-api:error] ${this.errorMessage}`);
    });
    return this.operationQueue;
  }

  private async startServer(): Promise<void> {
    if (this.httpServer) {
      return;
    }

    this.errorMessage = null;

    try {
      const server = new AgentHttpServer({
        downloads: this.downloadsService,
        settings: this.settingsService,
        version: app.getVersion(),
        getToken: () => this.token
      });

      const port = await server.start(DEFAULT_AGENT_API_PORT);
      this.httpServer = server;
      this.writeDiscoveryFile(port);
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : 'Не удалось запустить сервер для ИИ-агентов.';
      console.error(`[agent-api:error] ${this.errorMessage}`);
    }
  }

  private async stopServer(): Promise<void> {
    if (!this.httpServer) {
      this.writeDiscoveryFile(null);
      return;
    }

    const server = this.httpServer;
    this.httpServer = null;
    await server.stop();
    this.writeDiscoveryFile(null);
  }

  private getUserDataDir(): string {
    const userDataDir = app.getPath('userData');
    mkdirSync(userDataDir, { recursive: true });
    return userDataDir;
  }

  private getTokenFilePath(): string {
    return join(this.getUserDataDir(), 'agent-api-token.txt');
  }

  private getDiscoveryFilePath(): string {
    return join(this.getUserDataDir(), 'agent-api.json');
  }

  private getMcpScriptPath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'mcp', 'savvy-mcp.mjs')
      : join(app.getAppPath(), 'resources', 'mcp', 'savvy-mcp.mjs');
  }

  private loadOrCreateToken(): string {
    const tokenPath = this.getTokenFilePath();
    if (existsSync(tokenPath)) {
      const existing = readFileSync(tokenPath, 'utf8').trim();
      if (existing) {
        return existing;
      }
    }

    const generated = randomBytes(32).toString('hex');
    this.persistToken(generated);
    return generated;
  }

  private persistToken(nextToken: string): void {
    writeFileSync(this.getTokenFilePath(), `${nextToken}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  private writeDiscoveryFile(port: number | null): void {
    const enabled = this.settingsService.get().agentApiEnabled;
    const running = port !== null;
    const baseUrl = running ? `http://127.0.0.1:${port}` : null;
    const payload = {
      enabled,
      running,
      pid: running ? process.pid : null,
      port,
      baseUrl,
      mcpHttpUrl: baseUrl ? `${baseUrl}/mcp` : null,
      token: running ? this.token : '',
      executablePath: process.execPath,
      appPath: app.getAppPath(),
      updatedAt: Date.now()
    };

    writeFileSync(this.getDiscoveryFilePath(), JSON.stringify(payload, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
  }
}

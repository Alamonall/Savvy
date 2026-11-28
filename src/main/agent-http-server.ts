import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type {
  AddDownloadPayload,
  AppSettings,
  DownloadStatus,
  DownloadTask
} from '../shared/types';

export interface AgentDownloadsPort {
  list(): DownloadTask[];
  add(payload: AddDownloadPayload): DownloadTask;
  cancel(taskId: string): DownloadTask;
  retry(taskId: string): DownloadTask;
}

export interface AgentSettingsPort {
  get(): Pick<
    AppSettings,
    | 'downloadDir'
    | 'maxConcurrentDownloads'
    | 'ytdlpPath'
    | 'extractAudio'
    | 'audioFormat'
    | 'format'
    | 'agentApiEnabled'
  >;
}

export interface AgentHttpServerOptions {
  downloads: AgentDownloadsPort;
  settings: AgentSettingsPort;
  version: string;
  getToken: () => string;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const MCP_PROTOCOL_VERSION = '2024-11-05';
const MAX_REQUEST_BODY_BYTES = 256 * 1024;
const VALID_DOWNLOAD_STATUSES = new Set<DownloadStatus>([
  'queued',
  'running',
  'done',
  'failed',
  'cancelled'
]);

const MCP_TOOLS = [
  {
    name: 'download_video',
    description:
      'Start downloading a video or audio from a URL using Savvy (yt-dlp). Returns the created download task with its ID and status. Optionally waits for completion.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Video or playlist URL to download.'
        },
        downloadDir: {
          type: 'string',
          description:
            'Optional custom destination directory. Uses Savvy default download directory if omitted.'
        },
        optionsText: {
          type: 'string',
          description: 'Optional extra yt-dlp CLI arguments, e.g. "-x --audio-format mp3".'
        },
        waitForCompletion: {
          type: 'boolean',
          description: 'If true, wait until the download finishes or timeoutSeconds expires.'
        },
        timeoutSeconds: {
          type: 'number',
          description:
            'Maximum seconds to wait when waitForCompletion is true (default 120, max 600).'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'list_downloads',
    description: 'List download tasks in Savvy queue and history.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['queued', 'running', 'done', 'failed', 'cancelled'],
          description: 'Optional status filter.'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of tasks to return (default 20).'
        }
      }
    }
  },
  {
    name: 'get_download_status',
    description:
      'Get current status, progress, title, download directory, error message, and recent log lines for a Savvy download task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Download task ID.'
        },
        logLines: {
          type: 'number',
          description: 'Number of recent log lines to include (default 20).'
        }
      },
      required: ['taskId']
    }
  },
  {
    name: 'cancel_download',
    description: 'Cancel a queued or currently running download task in Savvy.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Download task ID.'
        }
      },
      required: ['taskId']
    }
  },
  {
    name: 'retry_download',
    description: 'Retry a failed or cancelled download task in Savvy with current settings.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Download task ID.'
        }
      },
      required: ['taskId']
    }
  },
  {
    name: 'get_savvy_settings',
    description:
      'Get Savvy current download settings (download directory, concurrency, yt-dlp path, format).',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

function summarizeTask(task: DownloadTask, logLines = 20): Record<string, unknown> {
  return {
    id: task.id,
    url: task.url,
    title: task.title ?? null,
    status: task.status,
    progress: task.progress ?? null,
    downloadDir: task.downloadDir,
    createdAt: task.createdAt,
    startedAt: task.startedAt ?? null,
    finishedAt: task.finishedAt ?? null,
    exitCode: task.exitCode ?? null,
    userMessage: task.userMessage ?? null,
    recentLog: logLines > 0 ? task.log.slice(-logLines) : []
  };
}

function filterTasksByStatus(tasks: DownloadTask[], status: unknown): DownloadTask[] {
  if (typeof status === 'string' && VALID_DOWNLOAD_STATUSES.has(status as DownloadStatus)) {
    return tasks.filter((task) => task.status === status);
  }
  return tasks;
}

function formatMcpJsonResult(data: Record<string, unknown>): Record<string, unknown> {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function isAuthorized(authHeader: string | undefined, expectedToken: string): boolean {
  if (!authHeader || !expectedToken) {
    return false;
  }

  const prefix = 'Bearer ';
  if (!authHeader.startsWith(prefix)) {
    return false;
  }

  const actualBuffer = Buffer.from(authHeader.slice(prefix.length));
  const expectedBuffer = Buffer.from(expectedToken);
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bufferChunk.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw new Error(`Request body exceeds maximum size of ${MAX_REQUEST_BODY_BYTES} bytes.`);
    }
    chunks.push(bufferChunk);
  }

  const rawText = Buffer.concat(chunks).toString('utf8').trim();
  if (!rawText) {
    return {};
  }

  const parsed: unknown = JSON.parse(rawText);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('JSON body must be an object.');
  }

  return parsed as Record<string, unknown>;
}

function readOptionalString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function buildAddDownloadInput(source: Record<string, unknown>): {
  url: string;
  downloadDir: string;
  optionsText: string;
} {
  return {
    url: readOptionalString(source.url).trim(),
    downloadDir: readOptionalString(source.downloadDir),
    optionsText: readOptionalString(source.optionsText)
  };
}

function readBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

/** Локальный HTTP-сервер на 127.0.0.1 для REST API и MCP Streamable HTTP. */
export class AgentHttpServer {
  private readonly options: AgentHttpServerOptions;
  private server: Server | null = null;
  private boundPort: number | null = null;

  constructor(options: AgentHttpServerOptions) {
    this.options = options;
  }

  /** Запускает HTTP-сервер только на loopback-интерфейсе 127.0.0.1. */
  async start(preferredPort: number): Promise<number> {
    if (this.server) {
      return this.boundPort ?? preferredPort;
    }

    const listenOnPort = (port: number): Promise<number> =>
      new Promise((resolve, reject) => {
        const httpServer = createServer((req, res) => {
          void this.handleRequest(req, res).catch((error) => {
            if (!res.headersSent) {
              sendJson(res, 500, {
                error: error instanceof Error ? error.message : 'Internal server error'
              });
            }
          });
        });

        httpServer.once('error', (error) => {
          reject(error);
        });

        httpServer.listen(port, '127.0.0.1', () => {
          const address = httpServer.address();
          const resolvedPort = typeof address === 'object' && address ? address.port : port;
          this.server = httpServer;
          this.boundPort = resolvedPort;
          resolve(resolvedPort);
        });
      });

    try {
      return await listenOnPort(preferredPort);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (preferredPort !== 0 && code === 'EADDRINUSE') {
        return listenOnPort(0);
      }
      throw error;
    }
  }

  /** Останавливает HTTP-сервер, принудительно завершая оставшиеся соединения при истечении таймаута. */
  async stop(graceTimeoutMs = 1500): Promise<void> {
    const activeServer = this.server;
    this.server = null;
    this.boundPort = null;

    if (!activeServer) {
      return;
    }

    await new Promise<void>((resolve) => {
      let isSettled = false;
      const finish = () => {
        if (!isSettled) {
          isSettled = true;
          resolve();
        }
      };

      const forceTimer = setTimeout(() => {
        if (typeof activeServer.closeAllConnections === 'function') {
          activeServer.closeAllConnections();
        }
        finish();
      }, graceTimeoutMs);
      forceTimer.unref?.();

      if (typeof activeServer.closeIdleConnections === 'function') {
        activeServer.closeIdleConnections();
      }

      activeServer.close(() => {
        clearTimeout(forceTimer);
        finish();
      });
    });
  }

  /** Возвращает фактический порт, на котором слушает сервер. */
  getPort(): number | null {
    return this.boundPort;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = requestUrl.pathname;
    const method = req.method ?? 'GET';

    if (method === 'GET' && pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        app: 'savvy',
        version: this.options.version
      });
      return;
    }

    if (!isAuthorized(req.headers.authorization, this.options.getToken())) {
      sendJson(res, 401, { error: 'Unauthorized: missing or invalid Bearer token.' });
      return;
    }

    if (pathname === '/mcp') {
      await this.handleMcpRequest(method, req, res);
      return;
    }

    if (pathname === '/api/settings' && method === 'GET') {
      sendJson(res, 200, { settings: this.getSanitizedSettings() });
      return;
    }

    if (pathname === '/api/downloads' && method === 'GET') {
      this.handleListDownloads(requestUrl, res);
      return;
    }

    if (pathname === '/api/downloads' && method === 'POST') {
      await this.handleCreateDownload(req, res);
      return;
    }

    const downloadIdMatch = /^\/api\/downloads\/([^/]+)$/.exec(pathname);
    if (downloadIdMatch && method === 'GET') {
      const taskId = decodeURIComponent(downloadIdMatch[1]);
      const task = this.options.downloads.list().find((item) => item.id === taskId);
      if (!task) {
        sendJson(res, 404, { error: 'Задача не найдена.' });
        return;
      }
      sendJson(res, 200, { task });
      return;
    }

    const actionMatch = /^\/api\/downloads\/([^/]+)\/(cancel|retry)$/.exec(pathname);
    if (actionMatch && method === 'POST') {
      this.handleTaskAction(
        decodeURIComponent(actionMatch[1]),
        actionMatch[2] as 'cancel' | 'retry',
        res
      );
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  }

  private getSanitizedSettings(): Record<string, unknown> {
    const current = this.options.settings.get();
    return {
      downloadDir: current.downloadDir,
      maxConcurrentDownloads: current.maxConcurrentDownloads,
      ytdlpPath: current.ytdlpPath,
      extractAudio: current.extractAudio,
      audioFormat: current.audioFormat,
      format: current.format,
      agentApiEnabled: current.agentApiEnabled
    };
  }

  private handleListDownloads(requestUrl: URL, res: ServerResponse): void {
    const statusParam = requestUrl.searchParams.get('status');
    const limit = readBoundedInt(requestUrl.searchParams.get('limit'), 50, 1, 200);
    const tasks = filterTasksByStatus(this.options.downloads.list(), statusParam);

    sendJson(res, 200, { tasks: tasks.slice(0, limit) });
  }

  private async handleCreateDownload(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : 'Некорректный JSON.'
      });
      return;
    }

    try {
      const task = this.options.downloads.add(buildAddDownloadInput(body));
      sendJson(res, 201, { task });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось добавить задачу.';
      const statusCode = message.includes('уже добавлена') ? 409 : 400;
      sendJson(res, statusCode, { error: message });
    }
  }

  private handleTaskAction(taskId: string, action: 'cancel' | 'retry', res: ServerResponse): void {
    try {
      if (action === 'cancel') {
        const task = this.options.downloads.cancel(taskId);
        sendJson(res, 200, { task });
        return;
      }

      const task = this.options.downloads.retry(taskId);
      sendJson(res, 201, { task });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось выполнить действие.';
      const statusCode = message.includes('не найдена') ? 404 : 400;
      sendJson(res, statusCode, { error: message });
    }
  }

  private async handleMcpRequest(
    method: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    if (method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed. Use POST for MCP JSON-RPC.' });
      return;
    }

    let rpc: JsonRpcRequest;
    try {
      rpc = (await readJsonBody(req)) as JsonRpcRequest;
    } catch (error) {
      sendJson(res, 400, {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: error instanceof Error ? error.message : 'Parse error'
        }
      });
      return;
    }

    if (rpc.id === undefined && rpc.method?.startsWith('notifications/')) {
      res.writeHead(202);
      res.end();
      return;
    }

    const id = rpc.id ?? null;

    switch (rpc.method) {
      case 'initialize':
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: {
              name: 'savvy',
              version: this.options.version
            }
          }
        });
        return;
      case 'ping':
        sendJson(res, 200, { jsonrpc: '2.0', id, result: {} });
        return;
      case 'tools/list':
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id,
          result: { tools: MCP_TOOLS }
        });
        return;
      case 'tools/call': {
        const result = await this.executeMcpTool(rpc.params ?? {});
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id,
          result
        });
        return;
      }
      default:
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${String(rpc.method ?? '')}`
          }
        });
    }
  }

  private async executeMcpTool(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const toolName = typeof params.name === 'string' ? params.name : '';
    const args =
      typeof params.arguments === 'object' &&
      params.arguments !== null &&
      !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : {};

    try {
      switch (toolName) {
        case 'download_video':
          return await this.runDownloadVideoTool(args);
        case 'list_downloads': {
          const limit = readBoundedInt(args.limit, 20, 1, 100);
          const tasks = filterTasksByStatus(this.options.downloads.list(), args.status);
          return formatMcpJsonResult({
            count: tasks.length,
            tasks: tasks.slice(0, limit).map((task) => summarizeTask(task, 5))
          });
        }
        case 'get_download_status': {
          const taskId = readOptionalString(args.taskId).trim();
          const logLines = readBoundedInt(args.logLines, 20, 0, 100);
          const task = this.options.downloads.list().find((item) => item.id === taskId);
          if (!task) {
            throw new Error(`Задача с id "${taskId}" не найдена.`);
          }
          return formatMcpJsonResult({ task: summarizeTask(task, logLines) });
        }
        case 'cancel_download': {
          const task = this.options.downloads.cancel(readOptionalString(args.taskId).trim());
          return formatMcpJsonResult({ task: summarizeTask(task, 10) });
        }
        case 'retry_download': {
          const task = this.options.downloads.retry(readOptionalString(args.taskId).trim());
          return formatMcpJsonResult({ task: summarizeTask(task, 10) });
        }
        case 'get_savvy_settings':
          return formatMcpJsonResult({ settings: this.getSanitizedSettings() });
        default:
          throw new Error(`Неизвестный инструмент MCP: ${toolName}`);
      }
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: error instanceof Error ? error.message : 'Ошибка выполнения инструмента.'
          }
        ]
      };
    }
  }

  private async runDownloadVideoTool(
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const input = buildAddDownloadInput(args);
    const url = input.url;
    let task: DownloadTask;
    let alreadyExists = false;
    let retried = false;

    try {
      task = this.options.downloads.add(input);
    } catch (error) {
      const existing = this.options.downloads.list().find((item) => item.url === url);
      if (!existing) {
        throw error;
      }

      if (existing.status === 'failed' || existing.status === 'cancelled') {
        task = this.options.downloads.retry(existing.id);
        retried = true;
      } else {
        task = existing;
        alreadyExists = true;
      }
    }

    const waitForCompletion = Boolean(args.waitForCompletion);
    if (waitForCompletion && task.status !== 'done') {
      const timeoutSeconds = readBoundedInt(args.timeoutSeconds, 120, 1, 600);
      const deadline = Date.now() + timeoutSeconds * 1000;

      while (Date.now() < deadline && this.server !== null) {
        const current = this.options.downloads.list().find((item) => item.id === task.id);
        if (!current) {
          break;
        }
        task = current;
        if (
          current.status === 'done' ||
          current.status === 'failed' ||
          current.status === 'cancelled'
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    return formatMcpJsonResult({
      ...(alreadyExists ? { alreadyExists: true } : {}),
      ...(retried ? { retried: true } : {}),
      task: summarizeTask(task, 20)
    });
  }
}

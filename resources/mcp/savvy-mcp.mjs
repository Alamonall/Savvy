#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const HEALTH_TIMEOUT_MS = 1500;
const AUTO_LAUNCH_TIMEOUT_MS = 12000;

const FALLBACK_TOOLS = [
  {
    name: 'download_video',
    description:
      'Start downloading a video or audio from a URL using Savvy (yt-dlp). Returns the created download task with its ID and status. Optionally waits for completion.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Video or playlist URL to download.' },
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
        limit: { type: 'number', description: 'Maximum number of tasks to return (default 20).' }
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
        taskId: { type: 'string', description: 'Download task ID.' },
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
        taskId: { type: 'string', description: 'Download task ID.' }
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
        taskId: { type: 'string', description: 'Download task ID.' }
      },
      required: ['taskId']
    }
  },
  {
    name: 'get_savvy_settings',
    description:
      'Get Savvy current download settings (download directory, concurrency, yt-dlp path, format).',
    inputSchema: { type: 'object', properties: {} }
  }
];

function getUserDataDir() {
  if (process.env.SAVVY_USER_DATA_DIR?.trim()) {
    return process.env.SAVVY_USER_DATA_DIR.trim();
  }

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'savvy');
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'savvy');
  }

  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(configHome, 'savvy');
}

function readDiscoveryFile() {
  const discoveryPath = join(getUserDataDir(), 'agent-api.json');
  if (!existsSync(discoveryPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(discoveryPath, 'utf8'));
  } catch {
    return null;
  }
}

async function isServerHealthy(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
    });
    return response.ok;
  } catch {
    return false;
  }
}

function tryLaunchSavvy(discovery) {
  if (process.env.SAVVY_NO_AUTO_LAUNCH === '1') {
    return false;
  }

  if (process.platform === 'darwin') {
    const child = spawn('open', ['-g', '-a', 'Savvy'], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return true;
  }

  const executablePath = discovery?.executablePath;
  if (typeof executablePath === 'string' && existsSync(executablePath)) {
    const child = spawn(executablePath, [], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return true;
  }

  return false;
}

async function resolveActiveConnection() {
  const existing = readDiscoveryFile();
  if (existing?.enabled === false) {
    throw new Error(
      'Локальный API для ИИ-агентов отключён в настройках Savvy. Включи «Локальный сервер для ИИ-агентов» в настройках приложения.'
    );
  }

  if (existing?.baseUrl && existing?.token && (await isServerHealthy(existing.baseUrl))) {
    return existing;
  }

  const launched = tryLaunchSavvy(existing);
  if (!launched) {
    throw new Error(
      `Savvy не запущен или API для ИИ-агентов отключён. Открой Savvy и включи «API для ИИ-агентов» в настройках (файл обнаружения: ${join(getUserDataDir(), 'agent-api.json')}).`
    );
  }

  const deadline = Date.now() + AUTO_LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const candidate = readDiscoveryFile();
    if (candidate?.baseUrl && candidate?.token && (await isServerHealthy(candidate.baseUrl))) {
      return candidate;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(
    'Не удалось дождаться запуска локального API Savvy. Убедись, что приложение Savvy открыто и «API для ИИ-агентов» включён в настройках.'
  );
}

async function forwardMcpRequest(rpcRequest) {
  const connection = await resolveActiveConnection();
  const response = await fetch(`${connection.baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(rpcRequest)
  });

  if (!response.ok) {
    throw new Error(`Savvy API вернул HTTP ${response.status}`);
  }

  return response.json();
}

function writeResponse(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function handleLine(line) {
  if (!line.trim()) {
    return;
  }

  let rpc;
  try {
    rpc = JSON.parse(line);
  } catch {
    return;
  }

  if (
    rpc.id === undefined &&
    typeof rpc.method === 'string' &&
    rpc.method.startsWith('notifications/')
  ) {
    return;
  }

  const id = rpc.id ?? null;

  try {
    switch (rpc.method) {
      case 'initialize':
        writeResponse({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'savvy', version: '1.0.0' }
          }
        });
        return;
      case 'ping':
        writeResponse({ jsonrpc: '2.0', id, result: {} });
        return;
      case 'tools/list': {
        const discovery = readDiscoveryFile();
        if (discovery?.baseUrl && discovery?.token && (await isServerHealthy(discovery.baseUrl))) {
          const proxied = await forwardMcpRequest(rpc);
          writeResponse(proxied);
          return;
        }
        writeResponse({
          jsonrpc: '2.0',
          id,
          result: { tools: FALLBACK_TOOLS }
        });
        return;
      }
      case 'tools/call': {
        const proxied = await forwardMcpRequest(rpc);
        writeResponse(proxied);
        return;
      }
      default:
        writeResponse({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${String(rpc.method ?? '')}`
          }
        });
    }
  } catch (error) {
    if (rpc.method === 'tools/call') {
      writeResponse({
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : 'Ошибка связи с Savvy.'
            }
          ]
        }
      });
      return;
    }

    writeResponse({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : 'Ошибка связи с Savvy.'
      }
    });
  }
}

const readline = createInterface({ input: process.stdin, crlfDelay: Infinity });
let pendingLine = Promise.resolve();
readline.on('line', (line) => {
  pendingLine = pendingLine.then(() => handleLine(line));
});

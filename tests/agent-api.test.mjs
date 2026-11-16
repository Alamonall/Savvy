import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

function createMockDependencies() {
  const tasks = [];
  let settings = {
    ytdlpPath: '/opt/homebrew/bin/yt-dlp',
    downloadDir: '/tmp/savvy-downloads',
    maxConcurrentDownloads: 2,
    extractAudio: false,
    audioFormat: 'mp3',
    format: '',
    agentApiEnabled: true
  };

  const downloads = {
    list() {
      return tasks.map((task) => ({ ...task, log: [...task.log] }));
    },
    add(payload) {
      const url = payload.url.trim();
      if (!url) {
        throw new Error('Ссылка не может быть пустой.');
      }
      if (tasks.some((task) => task.url === url)) {
        throw new Error('Эта ссылка уже добавлена.');
      }
      const task = {
        id: `task-${tasks.length + 1}`,
        url,
        title: `Video ${tasks.length + 1}`,
        optionsText: payload.optionsText ?? '',
        effectiveConfigText: '',
        downloadDir: payload.downloadDir?.trim() || settings.downloadDir,
        status: 'queued',
        createdAt: Date.now(),
        progress: 0,
        userMessage: null,
        log: ['Добавлено в очередь.']
      };
      tasks.unshift(task);
      return { ...task, log: [...task.log] };
    },
    cancel(taskId) {
      const task = tasks.find((item) => item.id === taskId);
      if (!task) {
        throw new Error('Задача не найдена.');
      }
      if (task.status !== 'queued' && task.status !== 'running') {
        throw new Error('Можно отменить только ожидающую или активную задачу.');
      }
      task.status = 'cancelled';
      task.finishedAt = Date.now();
      task.log.push('Скачивание отменено пользователем.');
      return { ...task, log: [...task.log] };
    },
    retry(taskId) {
      const original = tasks.find((item) => item.id === taskId);
      if (!original) {
        throw new Error('Задача не найдена.');
      }
      const retried = {
        ...original,
        id: `task-${tasks.length + 1}`,
        status: 'queued',
        createdAt: Date.now(),
        finishedAt: undefined,
        progress: null,
        userMessage: null,
        log: ['Добавлено в очередь повторно с актуальными настройками.']
      };
      tasks.push(retried);
      return { ...retried, log: [...retried.log] };
    },
    _complete(taskId) {
      const task = tasks.find((item) => item.id === taskId);
      if (task) {
        task.status = 'done';
        task.progress = 100;
        task.finishedAt = Date.now();
        task.log.push('Готово.');
      }
    }
  };

  return {
    downloads,
    settings: {
      get: () => settings,
      update: (next) => {
        settings = { ...settings, ...next };
        return settings;
      }
    }
  };
}

test('AgentHttpServer обслуживает health, REST API и требует Bearer-токен', async () => {
  const { AgentHttpServer } = await import('../src/main/agent-http-server.ts');
  const { downloads, settings } = createMockDependencies();
  const token = 'test-secret-token';

  const server = new AgentHttpServer({
    downloads,
    settings,
    version: '0.0.1-test',
    getToken: () => token
  });

  const port = await server.start(0);
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    assert.deepEqual(await healthRes.json(), { ok: true, app: 'savvy', version: '0.0.1-test' });

    const unauthorizedRes = await fetch(`${baseUrl}/api/downloads`);
    assert.equal(unauthorizedRes.status, 401);

    const authHeaders = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    const createRes = await fetch(`${baseUrl}/api/downloads`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        downloadDir: '/tmp/custom-dir',
        optionsText: '-x --audio-format mp3'
      })
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.task.id, 'task-1');
    assert.equal(created.task.downloadDir, '/tmp/custom-dir');

    const duplicateRes = await fetch(`${baseUrl}/api/downloads`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    });
    assert.equal(duplicateRes.status, 409);

    const listRes = await fetch(`${baseUrl}/api/downloads?status=queued`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.equal(listBody.tasks.length, 1);

    const cancelRes = await fetch(`${baseUrl}/api/downloads/task-1/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(cancelRes.status, 200);
    const cancelledBody = await cancelRes.json();
    assert.equal(cancelledBody.task.status, 'cancelled');

    const retryRes = await fetch(`${baseUrl}/api/downloads/task-1/retry`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(retryRes.status, 201);
    const retriedBody = await retryRes.json();
    assert.equal(retriedBody.task.id, 'task-2');
    assert.equal(retriedBody.task.status, 'queued');

    const allRes = await fetch(`${baseUrl}/api/downloads`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(allRes.status, 200);
    const allBody = await allRes.json();
    assert.equal(allBody.tasks.length, 2);

    const settingsRes = await fetch(`${baseUrl}/api/settings`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(settingsRes.status, 200);
    const settingsBody = await settingsRes.json();
    assert.equal(settingsBody.settings.downloadDir, '/tmp/savvy-downloads');
  } finally {
    await server.stop();
  }
});

test('AgentHttpServer поддерживает MCP Streamable HTTP (initialize, tools/list, tools/call)', async () => {
  const { AgentHttpServer } = await import('../src/main/agent-http-server.ts');
  const { downloads, settings } = createMockDependencies();
  const token = 'mcp-secret-token';

  const server = new AgentHttpServer({
    downloads,
    settings,
    version: '0.0.1-test',
    getToken: () => token
  });

  const port = await server.start(0);
  const mcpUrl = `http://127.0.0.1:${port}/mcp`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  try {
    const initRes = await fetch(mcpUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    });
    assert.equal(initRes.status, 200);
    const initJson = await initRes.json();
    assert.equal(initJson.result.serverInfo.name, 'savvy');

    const listRes = await fetch(mcpUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    });
    const listJson = await listRes.json();
    const toolNames = listJson.result.tools.map((tool) => tool.name);
    assert.ok(toolNames.includes('download_video'));
    assert.ok(toolNames.includes('list_downloads'));
    assert.ok(toolNames.includes('get_download_status'));
    assert.ok(toolNames.includes('cancel_download'));
    assert.ok(toolNames.includes('retry_download'));
    assert.ok(toolNames.includes('get_savvy_settings'));

    const callPromise = fetch(mcpUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'download_video',
          arguments: {
            url: 'https://youtu.be/test123',
            waitForCompletion: true,
            timeoutSeconds: 5
          }
        }
      })
    });

    setTimeout(() => downloads._complete('task-1'), 150);

    const callRes = await callPromise;
    assert.equal(callRes.status, 200);
    const callJson = await callRes.json();
    assert.equal(callJson.result.isError, undefined);
    const payload = JSON.parse(callJson.result.content[0].text);
    assert.equal(payload.task.id, 'task-1');
    assert.equal(payload.task.status, 'done');

    const duplicateCallRes = await fetch(mcpUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'download_video',
          arguments: { url: 'https://youtu.be/test123' }
        }
      })
    });
    const duplicateCallJson = await duplicateCallRes.json();
    assert.equal(duplicateCallJson.result.isError, undefined);
    const duplicatePayload = JSON.parse(duplicateCallJson.result.content[0].text);
    assert.equal(duplicatePayload.alreadyExists, true);
    assert.equal(duplicatePayload.task.id, 'task-1');

    const noLogRes = await fetch(mcpUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'get_download_status',
          arguments: { taskId: 'task-1', logLines: 0 }
        }
      })
    });
    const noLogJson = await noLogRes.json();
    const noLogPayload = JSON.parse(noLogJson.result.content[0].text);
    assert.deepEqual(noLogPayload.task.recentLog, []);
  } finally {
    await server.stop();
  }
});

test('stdio MCP bridge (resources/mcp/savvy-mcp.mjs) работает с Codex/Gemini через stdin/stdout', async () => {
  const { AgentHttpServer } = await import('../src/main/agent-http-server.ts');
  const { downloads, settings } = createMockDependencies();
  const token = 'bridge-token';
  const tempUserData = await mkdtemp(join(tmpdir(), 'savvy-mcp-test-'));

  const server = new AgentHttpServer({
    downloads,
    settings,
    version: '0.0.1-test',
    getToken: () => token
  });

  const port = await server.start(0);

  try {
    await mkdir(tempUserData, { recursive: true });
    await writeFile(
      join(tempUserData, 'agent-api.json'),
      JSON.stringify({
        pid: process.pid,
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        mcpHttpUrl: `http://127.0.0.1:${port}/mcp`,
        token
      })
    );

    const scriptPath = fileURLToPath(new URL('../resources/mcp/savvy-mcp.mjs', import.meta.url));
    const child = spawn(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        SAVVY_USER_DATA_DIR: tempUserData,
        SAVVY_NO_AUTO_LAUNCH: '1'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const responses = [];
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          responses.push(JSON.parse(line));
        }
      }
    });

    const sendRpc = (msg) => {
      child.stdin.write(`${JSON.stringify(msg)}\n`);
    };

    sendRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    sendRpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    sendRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    sendRpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'download_video',
        arguments: { url: 'https://vimeo.com/123456' }
      }
    });

    const deadline = Date.now() + 5000;
    while (responses.length < 3 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    child.stdin.end();
    await new Promise((resolve) => child.once('exit', resolve));

    assert.equal(responses.length, 3);
    const initResponse = responses.find((response) => response.id === 1);
    const listResponse = responses.find((response) => response.id === 2);
    const callResponse = responses.find((response) => response.id === 3);
    assert.equal(initResponse?.result.serverInfo.name, 'savvy');
    assert.ok(listResponse?.result.tools.some((tool) => tool.name === 'download_video'));
    const callPayload = JSON.parse(callResponse?.result.content[0].text);
    assert.equal(callPayload.task.url, 'https://vimeo.com/123456');
    assert.equal(callPayload.task.status, 'queued');
  } finally {
    await server.stop();
    await rm(tempUserData, { recursive: true, force: true });
  }
});

test('stdio MCP bridge сразу сообщает об ошибке, если API отключён в agent-api.json', async () => {
  const tempUserData = await mkdtemp(join(tmpdir(), 'savvy-mcp-disabled-'));

  try {
    await mkdir(tempUserData, { recursive: true });
    await writeFile(
      join(tempUserData, 'agent-api.json'),
      JSON.stringify({
        enabled: false,
        running: false,
        pid: null,
        port: null,
        baseUrl: null,
        token: ''
      })
    );

    const scriptPath = fileURLToPath(new URL('../resources/mcp/savvy-mcp.mjs', import.meta.url));
    const child = spawn(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        SAVVY_USER_DATA_DIR: tempUserData
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const responses = [];
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          responses.push(JSON.parse(line));
        }
      }
    });

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'download_video', arguments: { url: 'https://youtu.be/test' } }
      })}\n`
    );

    const deadline = Date.now() + 3000;
    while (responses.length < 1 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    child.stdin.end();
    await new Promise((resolve) => child.once('exit', resolve));

    assert.equal(responses.length, 1);
    assert.equal(responses[0].result.isError, true);
    assert.match(responses[0].result.content[0].text, /отключён/i);
  } finally {
    await rm(tempUserData, { recursive: true, force: true });
  }
});

test('AgentHttpServer останавливается без длительной задержки даже при ожидании waitForCompletion', async () => {
  const { AgentHttpServer } = await import('../src/main/agent-http-server.ts');
  const { downloads, settings } = createMockDependencies();
  const token = 'stop-test-token';

  const server = new AgentHttpServer({
    downloads,
    settings,
    version: '0.0.1-test',
    getToken: () => token
  });

  const port = await server.start(0);
  const mcpUrl = `http://127.0.0.1:${port}/mcp`;

  const inFlightPromise = fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: {
        name: 'download_video',
        arguments: {
          url: 'https://youtu.be/never-completes',
          waitForCompletion: true,
          timeoutSeconds: 300
        }
      }
    })
  }).catch(() => null);

  await new Promise((resolve) => setTimeout(resolve, 50));

  const stopStartTime = Date.now();
  await server.stop(300);
  const stopDurationMs = Date.now() - stopStartTime;

  assert.ok(
    stopDurationMs < 2000,
    `server.stop() занял слишком много времени: ${stopDurationMs}ms`
  );
  await inFlightPromise;
});

test('упакованное приложение включает MCP-мост в extraResources', () => {
  assert.ok(
    packageJson.build.extraResources.some(
      (entry) => entry.from === 'resources/mcp' && entry.to === 'mcp'
    )
  );
});

test('настройки и IPC-контракт содержат API для ИИ-агентов', async () => {
  const sharedTypes = await readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8');
  const preload = await readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
  const electronApp = await readFile(
    new URL('../src/main/electron-application.ts', import.meta.url),
    'utf8'
  );
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');

  assert.match(sharedTypes, /export interface AgentApiStatus/);
  assert.match(sharedTypes, /agentApiEnabled: boolean;/);
  assert.match(preload, /getAgentApiStatus\(\)/);
  assert.match(preload, /regenerateAgentApiToken\(\)/);
  assert.match(electronApp, /agent-api:get-status/);
  assert.match(electronApp, /agent-api:regenerate-token/);
  assert.match(renderer, /API для ИИ-агентов/);
  assert.match(renderer, /codex/i);
  assert.match(renderer, /gemini/i);
});

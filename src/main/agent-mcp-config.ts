import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { InstallAgentMcpOptions, InstallAgentMcpResult } from '../shared/types';

function resolveUserPath(inputPath: string, homeDir: string): string {
  if (inputPath === '~') {
    return homeDir;
  }
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return join(homeDir, inputPath.slice(2));
  }
  return inputPath;
}

function assertWritableFilePath(configPath: string): void {
  if (existsSync(configPath) && statSync(configPath).isDirectory()) {
    throw new Error(`Указанный путь является папкой, ожидался файл конфига: ${configPath}`);
  }
}

function getClaudeDesktopConfigPath(
  homeDir: string,
  platform: NodeJS.Platform,
  appDataDir?: string
): string | null {
  if (platform === 'darwin') {
    return join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (platform === 'win32') {
    const appData = appDataDir || join(homeDir, 'AppData', 'Roaming');
    return join(appData, 'Claude', 'claude_desktop_config.json');
  }
  if (platform === 'linux') {
    return join(homeDir, '.config', 'Claude', 'claude_desktop_config.json');
  }
  return null;
}

function upsertJsonMcpConfig(configPath: string, binaryPath: string, mcpScriptPath: string): void {
  assertWritableFilePath(configPath);
  mkdirSync(dirname(configPath), { recursive: true });
  let parsed: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf8').trim();
    if (raw) {
      try {
        const value: unknown = JSON.parse(raw);
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          throw new Error('Ожидался JSON-объект.');
        }
        parsed = value as Record<string, unknown>;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Не удалось прочитать ${configPath}: ${message}`);
      }
    }
  }

  const existingServers =
    typeof parsed.mcpServers === 'object' &&
    parsed.mcpServers !== null &&
    !Array.isArray(parsed.mcpServers)
      ? (parsed.mcpServers as Record<string, unknown>)
      : {};

  const nextConfig = {
    ...parsed,
    mcpServers: {
      ...existingServers,
      savvy: {
        command: binaryPath,
        args: [mcpScriptPath]
      }
    }
  };

  writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');
}

function upsertCodexMcpConfig(configPath: string, binaryPath: string, mcpScriptPath: string): void {
  assertWritableFilePath(configPath);
  mkdirSync(dirname(configPath), { recursive: true });
  const escapedBinary = binaryPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedPath = mcpScriptPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const section = `[mcp_servers.savvy]\ncommand = "${escapedBinary}"\nargs = ["${escapedPath}"]`;

  if (!existsSync(configPath)) {
    writeFileSync(configPath, `${section}\n`, 'utf8');
    return;
  }

  const raw = readFileSync(configPath, 'utf8');
  const sectionRegex = /^\[mcp_servers\.savvy\][ \t]*(?:\r?\n[\s\S]*?)?(?=\r?\n\[|$)/m;
  const nextContent = sectionRegex.test(raw)
    ? raw.replace(sectionRegex, section)
    : `${raw.trimEnd()}${raw.trimEnd() ? '\n\n' : ''}${section}`;

  writeFileSync(configPath, `${nextContent.trimEnd()}\n`, 'utf8');
}

/** Добавляет или обновляет секцию MCP-сервера Savvy в конфиге Claude, Codex или Gemini. */
export function installAgentMcpConfigFile(
  options: InstallAgentMcpOptions,
  mcpScriptPath: string,
  environment: {
    homeDir?: string;
    platform?: NodeJS.Platform;
    appDataDir?: string;
  } = {}
): InstallAgentMcpResult {
  const homeDir = environment.homeDir ?? homedir();
  const platform = environment.platform ?? process.platform;
  const appDataDir = environment.appDataDir ?? process.env.APPDATA;
  const { target } = options;
  const binaryPath = options.binaryPath?.trim() || 'node';
  const customConfigPath = options.configPath?.trim()
    ? resolveUserPath(options.configPath.trim(), homeDir)
    : null;

  if (target === 'codex') {
    const configPath = customConfigPath ?? join(homeDir, '.codex', 'config.toml');
    upsertCodexMcpConfig(configPath, binaryPath, mcpScriptPath);
    return { target, configPaths: [configPath] };
  }

  if (target === 'gemini') {
    const configPath = customConfigPath ?? join(homeDir, '.gemini', 'settings.json');
    upsertJsonMcpConfig(configPath, binaryPath, mcpScriptPath);
    return { target, configPaths: [configPath] };
  }

  if (target === 'claude') {
    if (customConfigPath) {
      upsertJsonMcpConfig(customConfigPath, binaryPath, mcpScriptPath);
      return { target, configPaths: [customConfigPath] };
    }
    const configPaths = [join(homeDir, '.claude.json')];
    const desktopConfigPath = getClaudeDesktopConfigPath(homeDir, platform, appDataDir);
    if (desktopConfigPath && existsSync(dirname(desktopConfigPath))) {
      configPaths.push(desktopConfigPath);
    }
    for (const configPath of configPaths) {
      upsertJsonMcpConfig(configPath, binaryPath, mcpScriptPath);
    }
    return { target, configPaths };
  }

  throw new Error(`Неподдерживаемый клиент MCP: ${String(target)}`);
}

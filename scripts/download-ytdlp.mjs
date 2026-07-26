import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function getYtdlpAsset() {
  if (process.platform === 'win32') {
    return { asset: 'yt-dlp.exe', fileName: 'yt-dlp.exe' };
  }

  if (process.platform === 'darwin') {
    return { asset: 'yt-dlp_macos', fileName: 'yt-dlp' };
  }

  if (process.platform === 'linux') {
    return { asset: 'yt-dlp', fileName: 'yt-dlp' };
  }

  throw new Error(`Платформа ${process.platform} не поддерживается для встроенного yt-dlp.`);
}

async function downloadYtdlp() {
  const { asset, fileName } = getYtdlpAsset();
  const targetDirectory = join(process.cwd(), 'build', 'ytdlp');
  const targetPath = join(targetDirectory, fileName);
  const response = await fetch(
    `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`
  );

  if (!response.ok) {
    throw new Error(`Не удалось скачать yt-dlp: HTTP ${response.status}.`);
  }

  await mkdir(targetDirectory, { recursive: true });
  await writeFile(targetPath, Buffer.from(await response.arrayBuffer()));

  if (process.platform !== 'win32') {
    await chmod(targetPath, 0o755);
  }

  console.log(`Встроенный yt-dlp подготовлен: ${targetPath}`);
}

downloadYtdlp().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Ошибка подготовки yt-dlp: ${message}`);
  process.exitCode = 1;
});

/** Разбирает строковую версию yt-dlp (`YYYY.MM.DD` или с префиксом `v`) в массив числовых сегментов. */
export function parseYtdlpVersion(version: string | null): number[] | null {
  if (!version) {
    return null;
  }

  const normalized = version.trim().replace(/^v/i, '');
  if (!/^\d+(?:\.\d+)*$/.test(normalized)) {
    return null;
  }

  return normalized.split('.').map((part) => Number.parseInt(part, 10));
}

/** Определяет, что опубликованная версия yt-dlp новее установленной. */
export function isYtdlpUpdateAvailable(
  currentVersion: string | null,
  latestVersion: string | null
): boolean {
  const currentParts = parseYtdlpVersion(currentVersion);
  const latestParts = parseYtdlpVersion(latestVersion);
  if (!currentParts || !latestParts) {
    return false;
  }

  const length = Math.max(currentParts.length, latestParts.length);
  for (let index = 0; index < length; index += 1) {
    const currentPart = currentParts[index] ?? 0;
    const latestPart = latestParts[index] ?? 0;
    if (latestPart !== currentPart) {
      return latestPart > currentPart;
    }
  }

  return false;
}

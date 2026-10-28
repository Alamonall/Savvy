/**
 * Включить после появления Developer ID подписи сборки macOS (secrets CSC_LINK и др.).
 */
export const MAC_AUTO_UPDATE_ENABLED = false;

/**
 * Определяет, нужно ли пользователю скачивать обновление вручную.
 * Linux без AppImage не умеет обновляться сам, а macOS до подписи Developer ID не проходит автообновление.
 */
export function isManualDownloadRequired(
  platform: NodeJS.Platform,
  appImagePath: string | undefined
): boolean {
  return (
    (platform === 'linux' && !appImagePath) || (platform === 'darwin' && !MAC_AUTO_UPDATE_ENABLED)
  );
}

/** Браузеры, которые принимает `--cookies-from-browser` в yt-dlp. */
export const COOKIES_BROWSERS = [
  { value: 'brave', label: 'Brave' },
  { value: 'chrome', label: 'Chrome' },
  { value: 'chromium', label: 'Chromium' },
  { value: 'edge', label: 'Edge' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'opera', label: 'Opera' },
  { value: 'safari', label: 'Safari' },
  { value: 'vivaldi', label: 'Vivaldi' },
  { value: 'whale', label: 'Whale' }
] as const;

/** Составные части значения `BROWSER[+KEYRING][:PROFILE][::CONTAINER]`; пустая строка — часть не задана. */
export interface BrowserCookiesSpec {
  browser: string;
  keyring: string;
  profile: string;
  container: string;
}

/** Та же грамматика, что в yt-dlp: профиль может быть путём, поэтому одиночное `:` в нём допустимо. */
const BROWSER_COOKIES_PATTERN =
  /^([^+:]+)(?:\s*\+\s*([^:]+))?(?:\s*:\s*(?!:)(.+?))?(?:\s*::\s*(.+))?$/;

/**
 * Разбирает значение `--cookies-from-browser`.
 *
 * Firefox-based браузеры (LibreWolf, Zen, Waterfox, Floorp) yt-dlp не знает по имени:
 * для них указывается `firefox` и путь к папке их профиля в части PROFILE.
 *
 * @param value Значение опции; нераспознанная строка попадает в `browser` без изменений.
 */
export function parseBrowserCookies(value: string): BrowserCookiesSpec {
  const trimmedValue = value.trim();
  const match = BROWSER_COOKIES_PATTERN.exec(trimmedValue);

  if (!match) {
    return { browser: trimmedValue, keyring: '', profile: '', container: '' };
  }

  const [, browser, keyring, profile, container] = match;

  return {
    browser: browser.trim().toLowerCase(),
    keyring: keyring?.trim() ?? '',
    profile: profile?.trim() ?? '',
    container: container?.trim() ?? ''
  };
}

/**
 * Собирает значение `--cookies-from-browser`; без браузера возвращает пустую строку,
 * потому что профиль и контейнер без браузера yt-dlp не принимает.
 */
export function formatBrowserCookies(spec: BrowserCookiesSpec): string {
  if (!spec.browser.trim()) {
    return '';
  }

  const keyring = spec.keyring.trim();
  const profile = spec.profile.trim();
  const container = spec.container.trim();

  return [
    spec.browser.trim(),
    keyring && `+${keyring}`,
    profile && `:${profile}`,
    container && `::${container}`
  ]
    .filter(Boolean)
    .join('');
}

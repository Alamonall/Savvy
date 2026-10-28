import assert from 'node:assert/strict';
import test from 'node:test';

const { COOKIES_BROWSERS, formatBrowserCookies, parseBrowserCookies } =
  await import('../src/shared/browser-cookies.ts');

test('пустое значение означает, что браузер не выбран', () => {
  assert.deepEqual(parseBrowserCookies(''), {
    browser: '',
    keyring: '',
    profile: '',
    container: ''
  });
  assert.equal(formatBrowserCookies(parseBrowserCookies('  ')), '');
});

test('разбирает браузер, keyring, профиль и контейнер по грамматике yt-dlp', () => {
  assert.deepEqual(parseBrowserCookies('chrome+gnomekeyring:Profile 1'), {
    browser: 'chrome',
    keyring: 'gnomekeyring',
    profile: 'Profile 1',
    container: ''
  });
  assert.deepEqual(parseBrowserCookies('Firefox:default-release::Work'), {
    browser: 'firefox',
    keyring: '',
    profile: 'default-release',
    container: 'Work'
  });
  assert.deepEqual(parseBrowserCookies('firefox::none'), {
    browser: 'firefox',
    keyring: '',
    profile: '',
    container: 'none'
  });
});

test('путь профиля Firefox-based браузера сохраняется целиком, включая двоеточие диска', () => {
  const unixPath = '/Users/me/Library/Application Support/librewolf/Profiles';
  const windowsPath = 'C:\\Users\\me\\AppData\\Roaming\\librewolf\\Profiles';

  assert.equal(parseBrowserCookies(`firefox:${unixPath}`).profile, unixPath);
  assert.equal(parseBrowserCookies(`firefox:${windowsPath}`).profile, windowsPath);
  assert.equal(
    formatBrowserCookies({ browser: 'firefox', keyring: '', profile: windowsPath, container: '' }),
    `firefox:${windowsPath}`
  );
});

test('сборка значения повторяет разбор и пропускает пустые части', () => {
  for (const value of [
    'firefox',
    'firefox:/home/me/.zen',
    'firefox:/home/me/.zen::Work',
    'firefox::Work',
    'chromium+kwallet:Default'
  ]) {
    assert.equal(formatBrowserCookies(parseBrowserCookies(value)), value);
  }
});

test('список браузеров совпадает с поддерживаемыми yt-dlp', () => {
  assert.deepEqual(
    COOKIES_BROWSERS.map((browser) => browser.value),
    ['brave', 'chrome', 'chromium', 'edge', 'firefox', 'opera', 'safari', 'vivaldi', 'whale']
  );
});

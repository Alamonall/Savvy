import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const { buildNoCookiesBypassArgs, hasCookieConfiguration, isYoutubeNChallengeDisposeError } =
  await import('../src/shared/youtube-n-challenge.ts');

test('распознаёт ошибку решателя n-challenge с addOnDisposeCallback и без него', () => {
  const realErrorLog = [
    'WARNING: [youtube] [jsc] Error solving n challenge request using "deno" provider: Error running deno process (returncode: 1): error: Uncaught (in promise) TypeError: a.addOnDisposeCallback is not a function',
    'WARNING: [youtube] up-PYDgqFtc: n challenge solving failed: Some formats may be missing.',
    'WARNING: Only images are available for download. use --list-formats to see them',
    'ERROR: [youtube] up-PYDgqFtc: Requested format is not available. Use --list-formats for a list of available formats'
  ].join('\n');

  assert.equal(isYoutubeNChallengeDisposeError(realErrorLog), true);

  const genericSolverCrashLog = [
    'WARNING: [youtube] [jsc] Error solving n challenge request using "deno" provider: Error running deno process',
    'ERROR: [youtube] up-PYDgqFtc: Requested format is not available.'
  ].join('\n');

  assert.equal(isYoutubeNChallengeDisposeError(genericSolverCrashLog), true);

  const missingRuntimeLog = [
    'WARNING: [youtube] No supported JavaScript runtime could be found.',
    'WARNING: [youtube] up-PYDgqFtc: n challenge solving failed: Some formats may be missing.'
  ].join('\n');

  assert.equal(isYoutubeNChallengeDisposeError(missingRuntimeLog), false);
});

test('определяет наличие cookies в эффективном конфиге или аргументах запуска', () => {
  assert.equal(
    hasCookieConfiguration(
      '--js-runtimes "deno:/opt/homebrew/bin/deno"\n--cookies-from-browser "firefox:/Users/test/Zen"',
      '--config-locations /tmp/cfg.conf'
    ),
    true
  );
  assert.equal(hasCookieConfiguration('', '--cookies /tmp/cookies.txt'), true);
  assert.equal(hasCookieConfiguration('--cookies=/tmp/cookies.txt', ''), true);
  assert.equal(
    hasCookieConfiguration('--no-cookies\n--no-cookies-from-browser', '--no-cookies'),
    false
  );
});

test('удаляет флаги cookies и добавляет --no-cookies и --no-cookies-from-browser для обхода', () => {
  assert.deepEqual(
    buildNoCookiesBypassArgs([
      '--config-locations',
      '/tmp/savvy.conf',
      '--cookies-from-browser',
      'firefox:/path/to/profile',
      '--cookies=/tmp/cookies.txt',
      '--cookies',
      '/tmp/other.txt',
      '--no-warnings'
    ]),
    [
      '--config-locations',
      '/tmp/savvy.conf',
      '--no-warnings',
      '--no-cookies',
      '--no-cookies-from-browser'
    ]
  );

  assert.deepEqual(
    buildNoCookiesBypassArgs(['--config-locations', '/tmp/savvy.conf', '--no-cookies']),
    ['--config-locations', '/tmp/savvy.conf', '--no-cookies', '--no-cookies-from-browser']
  );
});

test('DownloadsService автоматически запускает обход без cookies и сохраняет предупреждение об обновлении yt-dlp', async () => {
  const downloadsService = await readFile(
    new URL('../src/main/services/downloads.service.ts', import.meta.url),
    'utf8'
  );

  assert.match(downloadsService, /isYoutubeNChallengeDisposeError/);
  assert.match(downloadsService, /hasCookieConfiguration/);
  assert.match(downloadsService, /buildNoCookiesBypassArgs/);
  assert.match(downloadsService, /ytdlpUpdateRecommended\s*=\s*true/);
  assert.match(downloadsService, /retriedWithoutCookiesTaskIds/);
});

test('UI показывает предупреждение об обновлении yt-dlp со ссылкой на секцию обновления в настройках', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');

  assert.match(renderer, /renderYtdlpUpdateRecommendation/);
  assert.match(renderer, /ytdlpUpdateRecommended/);
  assert.match(renderer, /id="settings-ytdlp-binary"/);
  assert.match(renderer, /scrollIntoView/);
});

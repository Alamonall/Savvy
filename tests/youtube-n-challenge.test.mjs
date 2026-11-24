import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const { buildNoCookiesBypassArgs, hasCookieConfiguration, isYoutubeNChallengeDisposeError } =
  await import('../src/shared/youtube-n-challenge.ts');

test('распознаёт только ошибку решателя n-challenge с addOnDisposeCallback и не срабатывает на другие сбои', () => {
  const realErrorLog = [
    'WARNING: [youtube] [jsc] Error solving n challenge request using "deno" provider: Error running deno process (returncode: 1): error: Uncaught (in promise) TypeError: a.addOnDisposeCallback is not a function',
    'WARNING: [youtube] up-PYDgqFtc: n challenge solving failed: Some formats may be missing.',
    'WARNING: Only images are available for download. use --list-formats to see them',
    'ERROR: [youtube] up-PYDgqFtc: Requested format is not available. Use --list-formats for a list of available formats'
  ].join('\n');

  assert.equal(isYoutubeNChallengeDisposeError(realErrorLog), true);

  const denoTimeoutLog = [
    'WARNING: [youtube] [jsc] Error solving n challenge request using "deno" provider: Error running deno process: timed out',
    'ERROR: [youtube] up-PYDgqFtc: Requested format is not available.'
  ].join('\n');

  assert.equal(isYoutubeNChallengeDisposeError(denoTimeoutLog), false);

  const filenameCollisionLog = [
    '[download] Destination: /tmp/addOnDisposeCallback is not a function.mp4',
    'ERROR: [youtube] up-PYDgqFtc: Requested format is not available.'
  ].join('\n');

  assert.equal(isYoutubeNChallengeDisposeError(filenameCollisionLog), false);
});

test('определяет активные cookies с учётом кавычек, комментариев и переопределений --no-cookies', () => {
  assert.equal(
    hasCookieConfiguration(
      '--js-runtimes "deno:/opt/homebrew/bin/deno"\n"--cookies-from-browser" "firefox:/Users/test/Zen"',
      '--config-locations /tmp/cfg.conf'
    ),
    true
  );
  assert.equal(hasCookieConfiguration('', '--cookies /tmp/cookies.txt'), true);
  assert.equal(hasCookieConfiguration('--cookies=/tmp/cookies.txt', ''), true);
  assert.equal(
    hasCookieConfiguration('# --cookies /tmp/cookies.txt\n; --cookies-from-browser firefox', ''),
    false
  );
  assert.equal(
    hasCookieConfiguration('--cookies-from-browser firefox', '--no-cookies-from-browser'),
    false
  );
  assert.equal(hasCookieConfiguration('--cookies /tmp/cookies.txt', '--no-cookies'), false);
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

test('DownloadsService изолирует лог текущей попытки при автоповторе и анализе ошибки', async () => {
  const downloadsService = await readFile(
    new URL('../src/main/services/downloads.service.ts', import.meta.url),
    'utf8'
  );

  assert.match(downloadsService, /attemptLogStartIndex\s*=\s*task\.log\.length/);
  assert.match(downloadsService, /task\.log\.slice\(attemptLogStartIndex\)\.join\('\\n'\)/);
  assert.match(downloadsService, /this\.analyzeFailure\(attemptLogText\)/);
  assert.match(downloadsService, /this\.shouldRetryWithoutCookies\(task,\s*attemptLogText\)/);
  assert.match(downloadsService, /cleanupActiveTask/);
});

test('UI переиспользует общий каркас панели рекомендаций и прокручивает к настройке yt-dlp', async () => {
  const renderer = await readFile(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8');

  assert.match(renderer, /function renderRecommendationPanel\(/);
  assert.match(renderer, /function renderYtdlpUpdateRecommendation\(/);
  assert.match(renderer, /id="settings-ytdlp-binary"/);
  assert.match(renderer, /document\.getElementById\('settings-ytdlp-binary'\)\?\.scrollIntoView/);
});

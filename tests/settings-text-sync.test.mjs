import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [sharedTypes, preload, electronApplication, settingsService, renderer] = await Promise.all([
  read('src/shared/types.ts'),
  read('src/preload/index.ts'),
  read('src/main/electron-application.ts'),
  read('src/main/services/settings.service.ts'),
  read('src/renderer/src/main.ts')
]);

test('текстовый режим получает итоговый config с учётом UI-настроек', () => {
  assert.match(sharedTypes, /getEffectiveConfigText\(\): Promise<string>;/);
  assert.match(preload, /getEffectiveConfigText\(\)/);
  assert.match(preload, /'settings:get-effective-config-text'/);
  assert.match(electronApplication, /'settings:get-effective-config-text'/);
  assert.match(
    settingsService,
    /getEffectiveConfigText\(\): string \{\s*return this\.buildEffectiveConfigText\(\);/
  );
});

test('текстовая форма показывает итоговый config и обновляется после правки в UI', () => {
  assert.match(renderer, /textConfigDraft \?\? effectiveConfigText/);
  assert.doesNotMatch(renderer, /settings\.inlineConfigText \|\| effectiveOptionsPreview/);
  assert.match(
    renderer,
    /settings = await window\.ytdlp\.updateSettings\(nextSettings\);[\s\S]*?effectiveConfigText\] = await Promise\.all\([\s\S]*?window\.ytdlp\.getEffectiveConfigText\(\)/
  );
  assert.match(
    renderer,
    /mainSettings[\s\S]*?effectiveConfigText\] = await Promise\.all\([\s\S]*?window\.ytdlp\.getEffectiveConfigText\(\)/
  );
});

test('cookies из браузера задаются браузером, профилем и контейнером', () => {
  assert.match(renderer, /kind: 'browser-cookies'/);
  assert.match(renderer, /parseBrowserCookies\(settings\.cookiesFromBrowser\)/);
  assert.match(renderer, /formatBrowserCookies\(/);
  assert.match(renderer, /data-cookies-browser-part="profile"/);
  assert.match(renderer, /data-cookies-browser-part="container"/);
});

test('автоматический ffmpeg не перекрывает путь, уже заданный в тексте config', () => {
  assert.match(
    settingsService,
    /ffmpegDirectory &&\s*!appSettings\.ffmpegLocation\.trim\(\) &&\s*!this\.hasConfigOption\(appSettings\.inlineConfigText, '--ffmpeg-location'\)/
  );
});

test('текстовая форма без черновика перерисовывается после ответа на правку настроек', () => {
  assert.match(
    renderer,
    /function refreshSettingsPanelView\(\): void \{[\s\S]*?settingsMode === 'text' && textConfigDraft === null[\s\S]*?render\(\);/
  );
});

test('поиск настроек находит cookies по названию браузера', () => {
  assert.match(renderer, /option\.kind === 'browser-cookies'\s*\?\s*COOKIES_BROWSERS\.map/);
});

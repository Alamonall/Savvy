import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReleaseChanges } from '../src/main/release-changes.ts';

test('разбирает markdown-пункты GitHub и оставляет только текст коммита', () => {
  const notes = [
    '## What’s Changed',
    '* `fix(renderer): исправлен вывод` by [[Alamonall](https://github.com/Alamonall)] in [[commit](https://github.com/Alamonall/Savvy/commit/abc123)]',
    '- `feat(settings): добавлен переключатель` by [[Alamonall](https://github.com/Alamonall)] in [[commit](https://github.com/Alamonall/Savvy/commit/def456)]',
    '',
    '**Full Changelog**: https://github.com/Alamonall/Savvy/compare/v0.0.1...v0.0.2'
  ].join('\n');

  assert.deepEqual(parseReleaseChanges(notes), [
    { type: 'fix', text: 'исправлен вывод' },
    { type: 'feat', text: 'добавлен переключатель' }
  ]);
});

test('разбирает HTML-пункты из releases.atom и декодирует сущности', () => {
  const notes = [
    '<h2>What’s Changed</h2>',
    '<ul>',
    '<li><code>feat: добавить &quot;проверку&quot; &amp; очистку</code> by <a href="https://github.com/Alamonall">Alamonall</a> in <a href="https://github.com/Alamonall/Savvy/commit/abc">commit</a></li>',
    '<li><code>refactor(main): убрать &lt;любой&gt; код</code> by <a href="https://github.com/Alamonall">Alamonall</a></li>',
    '</ul>',
    '<p>Full Changelog: <a href="https://github.com/Alamonall/Savvy/compare/a...b">a...b</a></p>'
  ].join('\n');

  assert.deepEqual(parseReleaseChanges(notes), [
    { type: 'feat', text: 'добавить "проверку" & очистку' },
    { type: 'refactor', text: 'убрать <любой> код' }
  ]);
});

test('пропускает блок Post-merge automation вместе с его пунктами', () => {
  const notes = [
    '- `feat: новый пункт` by [[Alamonall](https://github.com/Alamonall)] in [[commit](https://github.com/x/commit/1)]',
    '',
    'Post-merge automation:',
    '- Merge pull request #31 from Alamonall/feat/x',
    '- `chore: подготовить релиз 0.0.2 [skip ci]` by [[github-actions](https://github.com/apps/github-actions)] in [[commit](https://github.com/x/commit/2)]',
    '',
    '**Full Changelog**: https://github.com/Alamonall/Savvy/compare/v0.0.1...v0.0.2'
  ].join('\n');

  assert.deepEqual(parseReleaseChanges(notes), [{ type: 'feat', text: 'новый пункт' }]);
});

test('пункты после блока Post-merge automation снова попадают в результат', () => {
  const notes = [
    '- `fix: до блока`',
    '**Post-merge automation:**',
    '- Merge pull request #5',
    '## Другой раздел',
    '- `fix: после блока`'
  ].join('\n');

  assert.deepEqual(parseReleaseChanges(notes), [
    { type: 'fix', text: 'до блока' },
    { type: 'fix', text: 'после блока' }
  ]);
});

test('пункт без Conventional Commits префикса получает type other', () => {
  const notes = [
    '- `Обновить README` by [[Alamonall](https://github.com/Alamonall)] in [[commit](https://github.com/x/commit/3)]',
    '- Просто текст без кода'
  ].join('\n');

  assert.deepEqual(parseReleaseChanges(notes), [
    { type: 'other', text: 'Обновить README' },
    { type: 'other', text: 'Просто текст без кода' }
  ]);
});

test('неизвестный Conventional Commits тип тоже превращается в other с полной строкой', () => {
  assert.deepEqual(parseReleaseChanges('- `wip: черновик`'), [
    { type: 'other', text: 'wip: черновик' }
  ]);
});

test('поддерживает scope и восклицательный знак breaking change', () => {
  const notes = ['- `feat(api)!: убрать устаревший канал`', '- `docs: обновить инструкции`'].join(
    '\n'
  );

  assert.deepEqual(parseReleaseChanges(notes), [
    { type: 'feat', text: 'убрать устаревший канал' },
    { type: 'docs', text: 'обновить инструкции' }
  ]);
});

test('без кавычек отрезает авторов и ссылки, но не трогает обычное слово by', () => {
  const notes = [
    '- fix: переписать разбор by [[Alamonall](https://github.com/Alamonall)] in [[commit](https://github.com/x/commit/4)]',
    '- fix: поведение by default'
  ].join('\n');

  assert.deepEqual(parseReleaseChanges(notes), [
    { type: 'fix', text: 'переписать разбор' },
    { type: 'fix', text: 'поведение by default' }
  ]);
});

test('пустые и отсутствующие входы дают пустой массив', () => {
  assert.deepEqual(parseReleaseChanges(null), []);
  assert.deepEqual(parseReleaseChanges(undefined), []);
  assert.deepEqual(parseReleaseChanges(''), []);
  assert.deepEqual(parseReleaseChanges('   \n\n'), []);
  assert.deepEqual(parseReleaseChanges([]), []);
  assert.deepEqual(parseReleaseChanges([{ note: null }]), []);
});

test('массив { note } склеивается через перевод строки', () => {
  const notes = [
    { note: '- `fix: первый`' },
    { note: null },
    { note: '- `feat: второй`\n- `fix: первый`' }
  ];

  assert.deepEqual(parseReleaseChanges(notes), [
    { type: 'fix', text: 'первый' },
    { type: 'feat', text: 'второй' },
    { type: 'fix', text: 'первый' }
  ]);
});

test('дубликаты пунктов сохраняются', () => {
  const notes = ['- `fix: одно и то же`', '- `fix: одно и то же`'].join('\n');

  assert.deepEqual(parseReleaseChanges(notes), [
    { type: 'fix', text: 'одно и то же' },
    { type: 'fix', text: 'одно и то же' }
  ]);
});

test('сохраняет HTML-пункты, где содержимое обёрнуто в абзац', () => {
  const notes = '<ul><li><p><code>fix: исправление</code></p></li></ul>';

  assert.deepEqual(parseReleaseChanges(notes), [{ type: 'fix', text: 'исправление' }]);
});

test('исключает блок Post-merge automation, если заголовок выделен HTML-тегами', () => {
  const notes = [
    '<ul><li><code>feat: настоящее изменение</code></li></ul>',
    '<h3><strong>Post-merge automation:</strong></h3>',
    '<ul><li><code>chore: release [skip ci]</code></li></ul>'
  ].join('\n');

  assert.deepEqual(parseReleaseChanges(notes), [{ type: 'feat', text: 'настоящее изменение' }]);
});

test('не обрезает описание, если пункт начинается с кода, но не является сообщением коммита', () => {
  assert.deepEqual(parseReleaseChanges('- `--cookies` теперь поддерживается'), [
    { type: 'other', text: '--cookies теперь поддерживается' }
  ]);
});

test('не считает обычное продолжение «by default» авторским хвостом', () => {
  assert.deepEqual(parseReleaseChanges('- `--cookies` by default включён'), [
    { type: 'other', text: '--cookies by default включён' }
  ]);
});

test('сохраняет литералы вида <tag> внутри markdown-кода коммита', () => {
  assert.deepEqual(parseReleaseChanges('- `fix: preserve <video> tags` by [[a](https://x.y)]'), [
    { type: 'fix', text: 'preserve <video> tags' }
  ]);
});

test('сохраняет структурные теги внутри markdown-кода однострочного пункта', () => {
  assert.deepEqual(parseReleaseChanges('- `fix: preserve <p> tags` by [[a](https://x.y)]'), [
    { type: 'fix', text: 'preserve <p> tags' }
  ]);
});

test('хвост «by default» без ссылки на автора остаётся описанием', () => {
  assert.deepEqual(parseReleaseChanges('- `--cookies` by default'), [
    { type: 'other', text: '--cookies by default' }
  ]);
});

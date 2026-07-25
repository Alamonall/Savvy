import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';
import { analyzeCommits } from '@semantic-release/commit-analyzer';

const workflow = await readFile(
  new URL('../.github/workflows/release.yml', import.meta.url),
  'utf8'
);
const releaseConfig = JSON.parse(
  await readFile(new URL('../.releaserc.json', import.meta.url), 'utf8')
);

test('release workflow runs alpha releases on the default branch', () => {
  assert.match(workflow, /\n\s+- master/);
  assert.match(workflow, /0\.0\.1-alpha\.1/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /conventional-changelog/);
  assert.match(
    workflow,
    /next release version is \(\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\(-\[0-9A-Za-z.-\]\+\)\?\)/
  );
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /issues:\s*write/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /semantic-release/);
});

test('release workflow uploads only distributable installer files', () => {
  assert.match(workflow, /artifact-path: \|\s+dist\/\*\.AppImage\s+dist\/\*\.deb/);
  assert.match(workflow, /artifact-path: \|\s+dist\/\*\.dmg\s+dist\/\*\.zip/);
  assert.match(workflow, /artifact-path: \|\s+dist\/\*\.exe\s+dist\/\*\.blockmap/);
  assert.doesNotMatch(workflow, /\n\s+path: dist\/\*/);
});

test('semantic release publishes alpha releases from master and attaches installer artifacts', () => {
  assert.deepEqual(releaseConfig.branches, [{ name: 'master', prerelease: 'alpha' }]);
  assert.match(JSON.stringify(releaseConfig.plugins), /@semantic-release\/github/);
  assert.match(workflow, /Обновить версию package\.json/);
  assert.match(workflow, /\[skip ci\]/);

  const releaseRules = releaseConfig.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === '@semantic-release/commit-analyzer'
  )[1].releaseRules;

  assert.deepEqual(releaseRules, [
    { release: 'patch' },
    { type: 'feat', release: 'minor' },
    { breaking: true, release: 'major' }
  ]);
  assert.match(JSON.stringify(releaseConfig.plugins), /release-assets\/\*\*\/*/);
  assert.match(JSON.stringify(releaseConfig.plugins), /@semantic-release\/changelog/);
  assert.match(JSON.stringify(releaseConfig.plugins), /@semantic-release\/git/);

  const githubConfig = releaseConfig.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === '@semantic-release/github'
  )[1];

  assert.deepEqual(githubConfig.assets, [{ path: 'release-assets/**/*' }]);
});

test('first alpha release uses the requested version', () => {
  assert.match(workflow, /INITIAL_RELEASE_VERSION: 0\.0\.1-alpha\.1/);
  assert.match(workflow, /v\$\{INITIAL_RELEASE_VERSION\}/);
});

test('build jobs allow the initial version to match package.json', () => {
  assert.match(workflow, /npm version --no-git-tag-version --allow-same-version/);
});

test('merge commit without a conventional type gets a patch release', async () => {
  const analyzerConfig = releaseConfig.plugins[0][1];
  const releaseType = await analyzeCommits(analyzerConfig, {
    cwd: process.cwd(),
    commits: [{ message: 'Merge pull request #2 from feature/example' }],
    logger: { log() {}, error() {}, warn() {}, success() {} }
  });

  assert.equal(releaseType, 'patch');
});

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

test('release workflow runs releases on the default branch', () => {
  assert.match(workflow, /\n\s+- master/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event_name.*workflow_dispatch/);
  assert.match(workflow, /should-release:/);
  assert.match(workflow, /0\.0\.1-alpha\.1/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /conventional-changelog/);
  assert.match(workflow, /next release version is \(\[0-9\]\+\\\.\[0-9\]\+/);
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

test('semantic release calculates stable versions for manual releases', () => {
  assert.deepEqual(releaseConfig.branches, ['master']);
  assert.match(JSON.stringify(releaseConfig.plugins), /@semantic-release\/github/);
  assert.match(workflow, /Обновить версию package\.json/);
  assert.match(workflow, /\[skip ci\]/);

  const releaseRules = releaseConfig.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === '@semantic-release/commit-analyzer'
  )[1].releaseRules;

  assert.deepEqual(releaseRules, [
    { release: 'patch' },
    { type: 'ci', release: false },
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

test('pushes to master calculate incrementing alpha versions', () => {
  assert.match(workflow, /RELEASE_CHANNEL.*alpha/);
  assert.match(workflow, /alpha_tag=.*git tag --list/);
  assert.match(workflow, /echo "version=\$\{base_version\}-alpha\.\$\{alpha_number\}"/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /--prerelease --generate-notes/);
});

test('stable releases run semantic-release only from manual workflow dispatch', () => {
  assert.match(workflow, /if \[ "\$RELEASE_CHANNEL" = "stable" \]; then/);
  assert.match(workflow, /npx semantic-release/);
});

test('build jobs update package.json only when the requested version differs', () => {
  assert.match(
    workflow,
    /if \[ "\$\(node -p \"require\('\.\/package\.json'\)\.version\"\)" != "\$\{?RELEASE_VERSION\}?" \]; then/
  );
  assert.match(workflow, /npm version --no-git-tag-version/);
  assert.doesNotMatch(workflow, /--allow-same-version/);
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

test('CI-only commits do not create a release', async () => {
  const analyzerConfig = releaseConfig.plugins[0][1];
  const releaseType = await analyzeCommits(analyzerConfig, {
    cwd: process.cwd(),
    commits: [{ message: 'ci: обновить workflow релиза' }],
    logger: { log() {}, error() {}, warn() {}, success() {} }
  });

  assert.equal(releaseType, null);
});

test('workflow skips build and publish jobs without release changes', () => {
  assert.match(workflow, /if: needs\.version\.outputs\.should-release == 'true'/g);
  assert.match(workflow, /if \[ -z "\$base_version" \]; then/);
  assert.match(workflow, /should-release=false/);
});

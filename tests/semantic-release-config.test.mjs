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

test('release workflow runs on the default branch and has release permissions', () => {
  assert.match(workflow, /push:\s*\n\s+branches:\s*\n\s+- main/);
  assert.match(workflow, /\n\s+- master/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /semantic-release/);
});

test('release workflow uploads only distributable installer files', () => {
  assert.match(workflow, /artifact-path: dist\/\*\.\{AppImage,deb\}/);
  assert.match(workflow, /artifact-path: dist\/\*\.\{dmg,zip\}/);
  assert.match(workflow, /artifact-path: dist\/\*\.\{exe,blockmap\}/);
  assert.doesNotMatch(workflow, /\n\s+path: dist\/\*/);
});

test('semantic release publishes every merge and attaches installer artifacts', () => {
  assert.deepEqual(releaseConfig.branches, ['main', 'master']);
  assert.match(JSON.stringify(releaseConfig.plugins), /@semantic-release\/github/);

  const releaseRules = releaseConfig.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === '@semantic-release/commit-analyzer'
  )[1].releaseRules;

  assert.deepEqual(releaseRules, [
    { release: 'patch' },
    { type: 'feat', release: 'minor' },
    { breaking: true, release: 'major' }
  ]);
  assert.match(JSON.stringify(releaseConfig.plugins), /release-assets\/\*\*\/*/);
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

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

test('release workflow runs alpha releases on a weekly schedule and stable releases manually', () => {
  assert.match(workflow, /\non:\n\s+schedule:\n/);
  assert.match(workflow, /- cron: '0 6 \* \* 1'/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event_name.*workflow_dispatch/);
  assert.match(workflow, /should-release:/);
  assert.match(workflow, /0\.0\.1-alpha\.1/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /conventional-changelog/);
  assert.match(workflow, /last_tag=.*git tag --merged HEAD --list 'v\*' --sort=-creatordate/);
  assert.match(workflow, /alpha_tag=.*git tag --merged HEAD --list/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /issues:\s*write/);
  assert.match(workflow, /npm ci/);
  assert.doesNotMatch(workflow, /npx semantic-release/);
});

test('release workflow uploads only distributable installer files', () => {
  assert.match(workflow, /artifact-path: \|\s+dist\/\*\.AppImage\s+dist\/\*\.deb/);
  assert.match(workflow, /artifact-path: \|\s+dist\/\*\.dmg\s+dist\/\*\.zip/);
  assert.match(workflow, /artifact-path: \|\s+dist\/\*\.exe\s+dist\/\*\.blockmap/);
  assert.doesNotMatch(workflow, /\n\s+path: dist\/\*/);
});

test('semantic release calculates stable versions for manual releases', () => {
  assert.match(JSON.stringify(releaseConfig.branches), /master/);
  assert.match(JSON.stringify(releaseConfig.plugins), /@semantic-release\/github/);
  assert.match(workflow, /Версия пишется только в рабочую копию/);
  assert.doesNotMatch(workflow, /git commit -m/);
  assert.doesNotMatch(workflow, /git push origin master/);

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
  assert.match(workflow, /base_version=.*INITIAL_RELEASE_VERSION/);
});

test('scheduled runs calculate incrementing alpha versions without changing the base version', () => {
  assert.match(workflow, /RELEASE_CHANNEL.*alpha/);
  assert.match(workflow, /last_tag=.*git tag --merged HEAD --list 'v\*' --sort=-creatordate/);
  assert.match(workflow, /git diff --quiet "\$last_tag" HEAD/);
  assert.match(workflow, /alpha_tag=.*git tag --merged HEAD --list/);
  assert.match(workflow, /echo "version=\$\{base_version\}-alpha\.\$\{alpha_number\}"/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /--prerelease --notes-file release-notes\.md/);
});

test('manual dispatch can publish alpha or a chosen stable version', () => {
  assert.match(workflow, /channel:\n\s+description:/);
  assert.match(workflow, /options:\n\s+- stable\n\s+- alpha/);
  assert.match(workflow, /version:\n\s+description:/);
  assert.match(workflow, /RELEASE_VERSION_OVERRIDE: \$\{\{ github\.event\.inputs\.version \}\}/);
  assert.match(workflow, /\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/);
});

test('stable versions that already have a complete release are rejected instead of reused', () => {
  assert.match(workflow, /git rev-parse -q --verify "refs\/tags\/v\$\{stable_version\}"/);
  assert.match(workflow, /release_complete "\$stable_version"/);
  assert.match(workflow, /уже опубликована/);
});

test('interrupted releases are re-published on the same tag', () => {
  assert.match(workflow, /release_complete\(\) \{/);
  assert.match(workflow, /release_complete "\$last_version"/);
  assert.match(workflow, /git ls-remote --exit-code --tags origin/);
  assert.match(workflow, /gh release upload .* --clobber/);
});

test('stable releases are published without a prerelease suffix', () => {
  assert.match(workflow, /if \[ "\$RELEASE_CHANNEL" = "stable" \]; then/);
  assert.doesNotMatch(workflow, /git commit -m/);
  assert.match(workflow, /git push origin "refs\/tags\/v\$\{RELEASE_VERSION\}"/);
  assert.match(workflow, /--title "\$\{RELEASE_VERSION\}"/);
  assert.match(workflow, /git push origin "refs\/tags\/v\$\{RELEASE_VERSION\}"/);
  assert.doesNotMatch(workflow, /--prerelease.*RELEASE_CHANNEL.*stable/);
});

test('stable releases start the next alpha cycle at the next patch version', () => {
  assert.match(workflow, /base_version=.*node --input-type=module/);
  assert.match(workflow, /patch \+ 1/);
  assert.match(workflow, /base_version="\$\{INITIAL_RELEASE_VERSION%-alpha\.\*\}"/);
});

test('build jobs update package.json only when the requested version differs', () => {
  assert.match(
    workflow,
    /if \[ "\$\(node -p "require\('\.\/package\.json'\)\.version"\)" != "\$\{?RELEASE_VERSION\}?" \]; then/
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
  assert.match(workflow, /echo "should-release=true"/);
});

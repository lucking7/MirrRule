import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { it } from 'node:test';

const repository = path.resolve(__dirname, '../..');

async function createFixture(directory: string) {
  const root = path.join(directory, 'root');
  const cwd = path.join(directory, 'working');
  const destination = path.join(directory, 'published');
  await fs.mkdir(path.join(root, 'public'), { recursive: true });
  await fs.mkdir(cwd);
  await fs.copyFile(path.join(repository, 'LICENSE'), path.join(root, 'LICENSE'));
  await fs.writeFile(path.join(root, 'public', 'sentinel'), 'preserve');
  await fs.writeFile(path.join(root, '.BUILD_FINISHED'), 'previous build');
  const preload = path.join(directory, 'fixture.cjs');
  await fs.writeFile(preload, `
const path = require('node:path');
const repository = ${JSON.stringify(repository)};
function replace(relative, exports) {
  const filename = require.resolve(path.join(repository, relative));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const constants = path.join(repository, 'Build/constants/dir.ts');
const dirs = require(constants);
replace('Build/constants/dir.ts', { ...dirs, ROOT_DIR: ${JSON.stringify(root)} });
replace('Build/download-geoip.ts', { downloadGEOIP: async () => ({ failed: 0 }) });
replace('Build/utils/network/fetch-assets.ts', {
  fetchAssets: async source => ['DOMAIN,' + (source.includes('special') ? 'special.example' : 'group.example')]
});
const targets = ['surge', 'clash', 'singbox', 'loon'];
replace('Build/lib/rule-sources.ts', {
  ruleGroups: [{ name: 'Fixture', targets, files: [{ path: 'List/group.list', url: 'https://fixture.test/group' }] }],
  specialRules: [{ name: 'Merged fixture', targets, targetFile: 'List/special.list', sourceFiles: ['https://fixture.test/special'] }]
});
const coverage = require(path.join(repository, 'Build/audit-rule-coverage.ts'));
coverage.exampleRoutingOrder.splice(0, coverage.exampleRoutingOrder.length, ['group.list', 'Proxy'], ['special.list', 'DIRECT']);
`);
  return { root, cwd, destination, preload };
}

function runBuild(fixture: { cwd: string; destination: string; preload: string }, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [
    '-r', require.resolve('@swc-node/register'), '-r', fixture.preload,
    path.join(repository, 'Build/index.ts'),
  ], {
    cwd: fixture.cwd,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, PUBLIC_DIR: fixture.destination, SWC_NODE_IGNORE_DYNAMIC: 'true', RUNNER_DEBUG: '0', ...env },
  });
}

it('build entry publishes rules, index and status under PUBLIC_DIR from another working directory', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-output-root-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const fixture = await createFixture(directory);
  const { root, cwd, destination } = fixture;
  const result = runBuild(fixture);
  assert.equal(result.status, 0, `${result.error?.message ?? ''}\n${result.stderr}\n${result.stdout}`);
  const outputs = [['List', 'list'], ['Clash', 'txt'], ['Loon', 'list'], ['sing-box', 'json']];
  for (const [platform, extension] of outputs) {
    for (const id of ['group', 'special']) {
      // eslint-disable-next-line no-await-in-loop -- assert each published platform fixture
      const content = await fs.readFile(path.join(destination, platform, `${id}.${extension}`), 'utf8');
      assert.match(content, new RegExp(String.raw`${id}\.example`));
    }
    // eslint-disable-next-line no-await-in-loop -- assert each published variant fixture
    const variant = await fs.readFile(path.join(destination, platform, 'domainset', `group.${extension}`), 'utf8');
    assert.match(variant, /group\.example/);
    // eslint-disable-next-line no-await-in-loop -- assert each absent variant fixture
    await assert.rejects(fs.access(path.join(destination, platform, 'ip', `group.${extension}`)), { code: 'ENOENT' });
  }
  const manifest = JSON.parse(await fs.readFile(path.join(destination, 'status.json'), 'utf8'));
  assert.deepEqual(manifest.rulesets.map((entry: { id: string }) => entry.id), ['group', 'special']);
  assert.deepEqual(manifest.reports, { ruleOutputAudit: 'Internal/rule-output-audit.json', sourceDelta: 'Internal/source-delta.json' });
  const audit = JSON.parse(await fs.readFile(path.join(destination, 'Internal', 'rule-output-audit.json'), 'utf8'));
  assert.equal(audit.schemaVersion, 1);
  assert.deepEqual(audit.rulesets.map((entry: { id: string }) => entry.id), ['group', 'special']);
  assert.equal(audit.rulesets[0].sources[0].configuredUrl, 'https://fixture.test/group');
  assert.equal(audit.rulesets[1].sources[0].selection, 'primary');
  assert.equal(audit.rulesets[0].outputs.length, 16);
  const delta = JSON.parse(await fs.readFile(path.join(destination, 'Internal', 'source-delta.json'), 'utf8'));
  assert.deepEqual(delta.sources.map((entry: { status: string }) => entry.status), ['baseline-unavailable', 'baseline-unavailable']);
  await fs.access(path.join(destination, 'Internal', 'source-snapshots', 'group.json'));
  const coverage = JSON.parse(await fs.readFile(path.join(destination, 'Internal', 'rule-coverage.json'), 'utf8'));
  assert.equal(coverage.schemaVersion, 1);
  assert.equal(coverage.basis, 'example-order');
  assert.equal(coverage.summary.auditedSubscriptions, 2);
  assert.equal(coverage.summary.missingLocalSubscriptions, 0);
  await assert.rejects(fs.access(path.join(root, 'public', 'Internal', 'rule-coverage.json')), { code: 'ENOENT' });
  const index = await fs.readFile(path.join(destination, 'index.html'), 'utf8');
  assert.match(index, /group\.list/);
  assert.match(index, /special\.json/);
  assert.deepEqual(await fs.readdir(path.join(root, 'public')), ['sentinel']);
  assert.equal(await fs.readFile(path.join(root, 'public', 'sentinel'), 'utf8'), 'preserve');
  await assert.rejects(fs.access(path.join(cwd, 'public')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(root, '.BUILD_FINISHED'), 'utf8'), 'BUILD_FINISHED\n');
  await assert.rejects(fs.access(path.join(destination, '.BUILD_FINISHED')), { code: 'ENOENT' });
});

it('compares with PUBLICATION_BASELINE_DIR and withholds .BUILD_FINISHED when reports cannot be written', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-output-reports-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const fixture = await createFixture(directory);
  const first = runBuild(fixture);
  assert.equal(first.status, 0, first.stderr);
  const baseline = path.join(directory, 'baseline');
  await fs.cp(fixture.destination, baseline, { recursive: true });

  const second = runBuild(fixture, { PUBLICATION_BASELINE_DIR: baseline, PUBLICATION_BASELINE_RECEIPT_ID: 'receipt-7' });
  assert.equal(second.status, 0, second.stderr);
  const delta = JSON.parse(await fs.readFile(path.join(fixture.destination, 'Internal', 'source-delta.json'), 'utf8'));
  assert.equal(delta.baseline.receiptId, 'receipt-7');
  assert.deepEqual(delta.sources.map((entry: { status: string; semanticChanged: boolean }) => [entry.status, entry.semanticChanged]), [
    ['compared', false], ['compared', false],
  ]);
  assert.equal(JSON.stringify(delta).includes(baseline), false);

  const relative = runBuild(fixture, { PUBLICATION_BASELINE_DIR: 'relative/baseline' });
  assert.equal(relative.status, 1);
  assert.match(relative.stderr, /\[rule-output-audit\] PUBLICATION_BASELINE_DIR must be an absolute path/);
  await assert.rejects(fs.access(path.join(fixture.root, '.BUILD_FINISHED')), { code: 'ENOENT' });

  await fs.rm(path.join(fixture.destination, 'Internal', 'source-snapshots'), { recursive: true });
  await fs.writeFile(path.join(fixture.destination, 'Internal', 'source-snapshots'), 'not a directory');
  const blocked = runBuild(fixture);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /\[rule-output-audit\]/);
  await assert.rejects(fs.access(path.join(fixture.root, '.BUILD_FINISHED')), { code: 'ENOENT' });
});

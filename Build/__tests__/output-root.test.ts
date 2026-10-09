import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { it } from 'node:test';

it('build entry publishes rules, index and status under PUBLIC_DIR from another working directory', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-output-root-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const repository = path.resolve(__dirname, '../..');
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
`);
  const result = spawnSync(process.execPath, [
    '-r', require.resolve('@swc-node/register'), '-r', preload,
    path.join(repository, 'Build/index.ts'),
  ], {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, PUBLIC_DIR: destination, SWC_NODE_IGNORE_DYNAMIC: 'true', RUNNER_DEBUG: '0' },
  });
  assert.equal(result.status, 0, `${result.error?.message ?? ''}\n${result.stderr}\n${result.stdout}`);
  const outputs = [['List', 'list'], ['Clash', 'txt'], ['Loon', 'list'], ['sing-box', 'json']];
  for (const [platform, extension] of outputs) {
    for (const id of ['group', 'special']) {
      // eslint-disable-next-line no-await-in-loop -- assert each published platform fixture
      const content = await fs.readFile(path.join(destination, platform, `${id}.${extension}`), 'utf8');
      assert.match(content, new RegExp(String.raw`${id}\.example`));
    }
  }
  const manifest = JSON.parse(await fs.readFile(path.join(destination, 'status.json'), 'utf8'));
  assert.deepEqual(manifest.rulesets.map((entry: { id: string }) => entry.id), ['group', 'special']);
  const index = await fs.readFile(path.join(destination, 'index.html'), 'utf8');
  assert.match(index, /group\.list/);
  assert.match(index, /special\.json/);
  assert.deepEqual(await fs.readdir(path.join(root, 'public')), ['sentinel']);
  assert.equal(await fs.readFile(path.join(root, 'public', 'sentinel'), 'utf8'), 'preserve');
  await assert.rejects(fs.access(path.join(cwd, 'public')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(root, '.BUILD_FINISHED'), 'utf8'), 'BUILD_FINISHED\n');
  await assert.rejects(fs.access(path.join(destination, '.BUILD_FINISHED')), { code: 'ENOENT' });
});

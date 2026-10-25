import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { it } from 'node:test';

const repository = path.resolve(__dirname, '../..');
const changedMessage = '[OK] Sync completed successfully with changes';
const unchangedMessage = '[OK] Sync completed - no changes detected';
const failedMessage = '[WARN] Sync completed with errors';
const content = '#!name=Current module';
const previousContent = '#!name=Previous module';

const scenarios = [
  { name: 'new', states: ['new'], message: changedMessage },
  { name: 'updated', states: ['updated'], message: changedMessage },
  { name: 'unchanged', states: ['unchanged'], message: unchangedMessage },
  { name: 'failed', states: ['failed'], message: failedMessage },
  { name: 'empty', states: [], message: unchangedMessage },
  { name: 'mixed changes', states: ['new', 'updated', 'unchanged'], message: changedMessage },
  { name: 'partial failure', states: ['new', 'failed'], message: failedMessage },
];

for (const scenario of scenarios) {
  for (const allGroups of [false, true]) {
    it(`mirror CLI preserves the ${scenario.name} message for ${allGroups ? 'all groups' : 'one group'}`, async t => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-sync-cli-'));
      t.after(() => fs.rm(directory, { recursive: true, force: true }));
      const repositories = scenario.states.map(state => ({
        repo: `fixture/${state}`,
        outputDir: path.join(directory, state),
        allowedTypes: ['sgmodule'],
      }));
      await Promise.all(scenario.states.map(async state => {
        if (state === 'new') return;
        const outputDir = path.join(directory, state, 'sgmodule');
        await fs.mkdir(outputDir, { recursive: true });
        await fs.writeFile(path.join(outputDir, `${state}.sgmodule`), state === 'unchanged' ? content : previousContent);
      }));

      const preload = path.join(directory, 'fixture.cjs');
      await fs.writeFile(preload, `
const path = require('node:path');
const repository = ${JSON.stringify(repository)};
function replace(relative, exports) {
  const filename = require.resolve(path.join(repository, relative));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
replace('Build/integration/mirror-sync/mirror-config.ts', {
  MIRROR_GROUPS: [{ name: 'Fixture', repositories: ${JSON.stringify(repositories)} }],
});
replace('Build/integration/mirror-sync/github-api.ts', {
  fetchLatestRelease: async repo => {
    const state = repo.split('/')[1];
    return {
      tag_name: 'v1', name: 'v1', html_url: 'https://example.test/release',
      assets: [
        { name: state + '.sgmodule', url: state, browser_download_url: state, size: ${content.length} },
        { name: 'ignored.txt', url: 'ignored', browser_download_url: 'ignored', size: 20 },
      ],
    };
  },
  downloadAsset: async url => {
    if (url === 'failed') throw new Error('fixture download failed');
    return Buffer.from(${JSON.stringify(content)});
  },
});
`);
      const result = spawnSync(process.execPath, [
        '-r', require.resolve('@swc-node/register'), '-r', preload,
        path.join(repository, 'Build/sync-mirrors.ts'),
        ...(allGroups ? [] : ['Fixture']),
      ], {
        cwd: repository,
        encoding: 'utf8',
        timeout: 30000,
        // picocolors treats any non-empty FORCE_COLOR as enabled; NO_COLOR keeps the output plain.
        env: { ...process.env, SWC_NODE_IGNORE_DYNAMIC: 'true', FORCE_COLOR: undefined, NO_COLOR: '1', RUNNER_DEBUG: '0' },
      });
      const failures = scenario.states.filter(state => state === 'failed').length;
      const diagnostic = `${result.error?.message ?? ''}\n${result.stderr}\n${result.stdout}`;
      assert.equal(result.status, failures > 0 ? 1 : 0, diagnostic);
      assert.deepEqual(
        result.stdout.split('\n').filter(line => /^\[(?:OK|WARN)\]/.test(line)),
        [scenario.message],
        diagnostic
      );
      assert.ok(result.stdout.includes(`  Total: ${scenario.states.length * 2}\n`), diagnostic);
      assert.ok(result.stdout.includes(`  ✓ Succeeded: ${scenario.states.length - failures}\n`), diagnostic);
      assert.ok(result.stdout.includes(`  ○ Skipped: ${scenario.states.length}\n`), diagnostic);
      assert.ok(result.stdout.includes(`  ✓ New files: ${scenario.states.filter(state => state === 'new').length}\n`), diagnostic);
      assert.ok(result.stdout.includes(`  ↻ Updated files: ${scenario.states.filter(state => state === 'updated').length}\n`), diagnostic);
      assert.ok(result.stdout.includes(`  ✗ Failed files: ${failures}\n`), diagnostic);
      if (failures > 0) {
        assert.match(result.stderr, /\[ERROR\] Sync failed with error:/);
        assert.match(result.stderr, /Sync completed with 1 errors/);
      }
      await Promise.all(scenario.states.map(async state => {
        const outputDir = path.join(directory, state, 'sgmodule');
        const filename = `${state}.sgmodule`;
        assert.equal(await fs.readFile(path.join(outputDir, filename), 'utf8'), state === 'failed' ? previousContent : content);
        assert.deepEqual(await fs.readdir(outputDir), [filename]);
      }));
    });
  }
}

/* eslint-disable @typescript-eslint/no-require-imports -- CJS project, node:test requires require() for SWC compat */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

describe('shared secondary pipeline failure contract', () => {
  it('fails only when a required asset fails', () => {
    const { hasRequiredFailures } = require('../integration/mirror-sync/sync-engine');
    assert.equal(hasRequiredFailures({ total: 1, succeeded: 0, skipped: 0, failed: [
      { asset: 'optional', error: 'offline', required: false },
    ] }), false);
    assert.equal(hasRequiredFailures({ total: 1, succeeded: 0, skipped: 0, failed: [
      { asset: 'required', error: 'offline', required: true },
    ] }), true);
  });

  it('does not overwrite a valid destination when post-processing fails', async () => {
    const { FileType, syncRepository } = require('../integration/mirror-sync/sync-engine');
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirrrule-post-process-'));
    const destination = path.join(dir, 'sgmodule', 'asset.sgmodule');
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.writeFile(destination, 'valid-existing-content');
    const result = await syncRepository({
      repo: 'owner/repo', outputDir: dir, allowedTypes: [FileType.SGMODULE],
      postProcess() { throw new Error('processor failed'); },
    }, {
      fetchRelease: () => Promise.resolve({
        tag_name: 'v1', name: 'v1', html_url: 'https://example.test',
        assets: [{ name: 'asset.sgmodule', url: 'asset-url', browser_download_url: 'asset-url', size: 20 }],
      }),
      download: () => Promise.resolve(Buffer.from('different raw content')),
    });
    assert.deepEqual(result.failed, [{ asset: 'asset.sgmodule', error: 'processor failed', required: true }]);
    assert.equal(await fsp.readFile(destination, 'utf8'), 'valid-existing-content');
    await fsp.rm(dir, { recursive: true, force: true });
  });
});

describe('fmz200 CLI decision', () => {
  it('runs each download once and preserves required/optional failure exit codes', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirrrule-fmz200-cli-'));
    const preload = path.join(dir, 'mock-fetch.cjs');
    await fsp.writeFile(preload, `
const fs = require('node:fs');
global.fetch = async url => {
  fs.appendFileSync(process.env.FMZ200_REQUEST_LOG, String(url) + '\\n');
  const catalog = String(url).includes('api.github.com');
  const fails = process.env.FMZ200_SCENARIO === 'required' && catalog
    || process.env.FMZ200_SCENARIO === 'optional' && !catalog;
  return {
    ok: !fails,
    status: fails ? 503 : 200,
    json: async () => [],
    text: async () => '#!name=example\\n[Rule]\\nDOMAIN,example.test,REJECT\\n'
  };
};
`);

    try {
      for (const [scenario, expectedStatus] of [['success', 0], ['required', 1], ['optional', 0]] as const) {
        const requestLog = path.join(dir, `${scenario}.requests`);
        const result = spawnSync(process.execPath, [
          '-r', '@swc-node/register', '-r', preload, 'Build/download-fmz200-split.ts'
        ], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            SWC_NODE_IGNORE_DYNAMIC: 'true',
            PUBLIC_DIR: path.join(dir, 'public'),
            FMZ200_REQUEST_LOG: requestLog,
            FMZ200_SCENARIO: scenario
          },
          encoding: 'utf8',
          timeout: 10000
        });
        assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
        const requests = (await fsp.readFile(requestLog, 'utf8')).trim().split('\n');
        assert.equal(requests.length, 4, `unexpected request count for ${scenario}`);
        assert.equal(new Set(requests).size, 4, `duplicate requests for ${scenario}`);
        assert.equal((result.stdout.match(/fmz200 Modules Sync/g) ?? []).length, 1);
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects required partial and total failures but accepts success', () => {
    const { assertFmz200Success } = require('../download-fmz200-split');
    assert.doesNotThrow(() => assertFmz200Success({ total: 2, succeeded: 2, failed: [], skipped: 0 }));
    assert.throws(() => assertFmz200Success({ total: 2, succeeded: 1, skipped: 0, failed: [
      { asset: 'one', error: 'failed', required: true },
    ] }));
    assert.throws(() => assertFmz200Success({ total: 2, succeeded: 0, skipped: 0, failed: [
      { asset: 'one', error: 'failed', required: true },
      { asset: 'two', error: 'failed', required: true },
    ] }));
  });
});

describe('mock/modules CLI decision', () => {
  it('rejects required per-file and extraction failures', () => {
    const { assertMockModulesSuccess } = require('../download-mock-modules');
    for (const asset of ['Mock/file.txt', 'tar-extraction']) {
      assert.throws(() => assertMockModulesSuccess({ total: 1, succeeded: 0, skipped: 0, failed: [
        { asset, error: 'injected failure', required: true },
      ] }));
    }
  });
});

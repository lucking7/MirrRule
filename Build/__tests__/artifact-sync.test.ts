/* eslint-disable @typescript-eslint/no-require-imports -- CJS project, node:test requires require() for SWC compat */

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { writeFileAtomic } from '../lib/atomic-file';

describe('artifact synchronization', () => {
  it('selects the configured release asset family', async () => {
    const { FileType, syncRepository } = require('../integration/mirror-sync/sync-engine');
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirrrule-release-selector-'));
    const downloaded: string[] = [];

    try {
      const result = await syncRepository({
        repo: 'NSRingo/Siri',
        outputDir: directory,
        allowedTypes: [FileType.SGMODULE],
        assetNamePattern: /^iRingo\.(?:Siri|Search|Spotlight)\.sgmodule$/,
      }, {
        fetchRelease: () => Promise.resolve({
          tag_name: 'v1',
          name: 'v1',
          html_url: 'https://example.test/release',
          assets: [
            {
              name: 'iRingo.Siri.sgmodule',
              url: 'siri-url',
              browser_download_url: 'siri-url',
              size: 20,
            },
            {
              name: 'Legacy.Siri.sgmodule',
              url: 'legacy-url',
              browser_download_url: 'legacy-url',
              size: 20,
            },
          ],
        }),
        download(url: string) {
          downloaded.push(url);
          return Promise.resolve(Buffer.from('#!name=iRingo Siri'));
        },
      });

      assert.deepEqual(downloaded, ['siri-url']);
      assert.equal(result.succeeded, 1);
      assert.equal(result.skipped, 1);
      assert.equal(
        await fsp.readFile(path.join(directory, 'sgmodule', 'iRingo.Siri.sgmodule'), 'utf8'),
        '#!name=iRingo Siri'
      );
    } finally {
      await fsp.rm(directory, { recursive: true, force: true });
    }
  });

  it('replaces files atomically without leaving temporary artifacts', async () => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirrrule-atomic-file-'));
    const destination = path.join(directory, 'nested', 'artifact.sgmodule');

    try {
      await writeFileAtomic(destination, 'first');
      await writeFileAtomic(destination, 'second');

      assert.equal(await fsp.readFile(destination, 'utf8'), 'second');
      assert.deepEqual(await fsp.readdir(path.dirname(destination)), ['artifact.sgmodule']);
    } finally {
      await fsp.rm(directory, { recursive: true, force: true });
    }
  });

  it('fails when a configured release selector matches no assets', async () => {
    const { FileType, hasRequiredFailures, syncRepository } = require('../integration/mirror-sync/sync-engine');
    const result = await syncRepository({
      repo: 'NSRingo/Siri',
      outputDir: '/unused',
      allowedTypes: [FileType.SGMODULE],
      assetNamePattern: /^iRingo\.Siri\.sgmodule$/,
    }, {
      fetchRelease: () => Promise.resolve({
        tag_name: 'v2',
        name: 'v2',
        html_url: 'https://example.test/release',
        assets: [{
          name: 'renamed.sgmodule',
          url: 'renamed-url',
          browser_download_url: 'renamed-url',
          size: 20,
        }],
      }),
    });

    assert.equal(result.succeeded, 0);
    assert.equal(result.failed.length, 1);
    assert.match(result.failed[0].error, /No release assets matched/);
    assert.equal(hasRequiredFailures(result), true);
  });
});

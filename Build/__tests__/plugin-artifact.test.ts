import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { publishPluginArtifacts } from '../integration/plugin-converter/plugin-artifact';
import { identifyPluginSource } from '../integration/plugin-converter/plugin-identity';
import { getPluginMirrorFilename } from '../integration/plugin-converter/plugin-mirror';

function pluginIdentity(name: string) {
  return identifyPluginSource({
    name,
    url: `https://plugins.test/${name}.plugin`,
    extension: 'plugin',
  });
}

describe('plugin artifact lifecycle', () => {
  it('preserves last-known-good output when a required script is unavailable', async () => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirrrule-plugin-artifact-'));
    const outputPath = path.join(directory, 'example.sgmodule');

    try {
      await fsp.writeFile(outputPath, 'known-good');
      const [result] = await publishPluginArtifacts([{
        result: {
          pluginName: 'example',
          ...pluginIdentity('example'),
          success: true,
          outputPath,
          scripts: [{
            originalUrl: 'https://upstream.test/main.js',
            filename: 'main.js',
            isMirrored: false,
          }],
        },
        content: 'script-path=https://upstream.test/main.js',
      }], {});

      assert.equal(result.success, false);
      assert.equal(result.status, 'degraded');
      assert.match(result.error ?? '', /required script/i);
      assert.equal(await fsp.readFile(outputPath, 'utf8'), 'known-good');
      assert.deepEqual(await fsp.readdir(directory), ['example.sgmodule']);
    } finally {
      await fsp.rm(directory, { recursive: true, force: true });
    }
  });

  it('publishes a module atomically after replacing every script URL', async () => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirrrule-plugin-artifact-'));
    const outputPath = path.join(directory, 'example.sgmodule');
    const mirrorUrl = 'https://nrrule.pages.dev/Scripts/hash-main.js';

    try {
      const [result] = await publishPluginArtifacts([{
        result: {
          pluginName: 'example',
          ...pluginIdentity('example'),
          success: true,
          outputPath,
          scripts: [{
            originalUrl: 'https://upstream.test/main.js',
            filename: 'main.js',
            isMirrored: false,
          }],
        },
        content: 'script-path=https://upstream.test/main.js',
      }], {
        'https://upstream.test/main.js': mirrorUrl,
      });

      assert.equal(result.success, true);
      assert.equal(result.status, 'ready');
      assert.equal(await fsp.readFile(outputPath, 'utf8'), `script-path=${mirrorUrl}`);
      assert.deepEqual(await fsp.readdir(directory), ['example.sgmodule']);
    } finally {
      await fsp.rm(directory, { recursive: true, force: true });
    }
  });

  it('marks a missing current artifact as failed when no last-known-good output exists', async () => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirrrule-plugin-artifact-'));
    const outputPath = path.join(directory, 'missing.sgmodule');

    try {
      const [result] = await publishPluginArtifacts([{
        result: {
          pluginName: 'missing',
          ...pluginIdentity('missing'),
          success: true,
          outputPath,
          scripts: [{
            originalUrl: 'https://upstream.test/missing.js',
            filename: 'missing.js',
            isMirrored: false,
          }],
        },
        content: 'script-path=https://upstream.test/missing.js',
      }], {});

      assert.equal(result.success, false);
      assert.equal(result.status, 'failed');
      await assert.rejects(fsp.access(outputPath));
    } finally {
      await fsp.rm(directory, { recursive: true, force: true });
    }
  });

  it('publishes a usable module as degraded when its script comes from warm cache', async () => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirrrule-plugin-artifact-'));
    const outputPath = path.join(directory, 'cached.sgmodule');
    const originalUrl = 'https://upstream.test/cached.js';
    const mirrorUrl = 'https://nrrule.pages.dev/Scripts/hash-cached.js';

    try {
      const [result] = await publishPluginArtifacts([{
        result: {
          pluginName: 'cached',
          ...pluginIdentity('cached'),
          success: true,
          outputPath,
          scripts: [{ originalUrl, filename: 'cached.js', isMirrored: false }],
        },
        content: `script-path=${originalUrl}`,
      }], { [originalUrl]: mirrorUrl }, new Set([originalUrl]));

      assert.equal(result.success, false);
      assert.equal(result.status, 'degraded');
      assert.match(result.error ?? '', /cached artifact/);
      assert.equal(await fsp.readFile(outputPath, 'utf8'), `script-path=${mirrorUrl}`);
    } finally {
      await fsp.rm(directory, { recursive: true, force: true });
    }
  });

  it('uses canonical URLs to separate same-name plugin cache entries', () => {
    const first = getPluginMirrorFilename({
      name: 'same-name',
      url: 'https://one.test/plugin.lpx#fragment',
      extension: 'lpx',
    });
    const equivalent = getPluginMirrorFilename({
      name: 'same-name',
      url: 'https://one.test/plugin.lpx',
      extension: 'lpx',
    });
    const second = getPluginMirrorFilename({
      name: 'same-name',
      url: 'https://two.test/plugin.lpx',
      extension: 'lpx',
    });

    assert.equal(first, equivalent);
    assert.notEqual(first, second);
    assert.equal(
      identifyPluginSource({
        name: 'same-name',
        url: 'https://one.test/plugin.lpx#fragment',
        extension: 'lpx',
      }).sourceId,
      identifyPluginSource({
        name: 'different-display-name',
        url: 'https://one.test/plugin.lpx',
        extension: 'lpx',
      }).sourceId
    );
  });
});

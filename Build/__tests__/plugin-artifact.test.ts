import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { publishPluginArtifacts } from '../integration/plugin-converter/plugin-artifact';
import { identifyPluginSource } from '../integration/plugin-converter/plugin-identity';
import {
  getPluginContent,
  getPluginMirrorFilename,
} from '../integration/plugin-converter/plugin-mirror';

function pluginIdentity(name: string) {
  return identifyPluginSource({
    name,
    url: `https://plugins.test/${name}.plugin`,
    extension: 'plugin',
  });
}

describe('plugin artifact lifecycle', () => {
  it('rejects retired subscription names before reporting an active unrelated source ready', async (t) => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirrrule-retired-artifact-'));
    t.after(() => fsp.rm(directory, { recursive: true, force: true }));
    const names = ['腾讯视频去广告.sgmodule', 'Tencent_Video_remove_ads.sgmodule'];
    const results = await publishPluginArtifacts(names.map(name => ({
      result: {
        pluginName: 'Active alternative',
        ...pluginIdentity('Tencent_Video_remove_ads'),
        outputPath: path.join(directory, name),
        scripts: [],
      },
      content: '#!name=腾讯视频去广告\n[Rule]\nDOMAIN,active.test,REJECT',
    })), {});
    assert.deepEqual(results.map(result => result.status), ['failed', 'failed']);
    assert.ok(results.every(result => result.error?.includes('retired subscription filename')));
    assert.deepEqual(await fsp.readdir(directory), []);
    const [renamed] = await publishPluginArtifacts([{
      result: {
        pluginName: 'Active alternative',
        ...pluginIdentity('Tencent_Video_remove_ads'),
        outputPath: path.join(directory, 'Active alternative.sgmodule'),
        scripts: [],
      },
      content: '#!name=Active alternative\n[Rule]\nDOMAIN,active.test,REJECT',
    }], {});
    assert.equal(renamed.status, 'ready');
    assert.ok(renamed.outputPath);
    assert.match(await fsp.readFile(renamed.outputPath, 'utf8'), /DOMAIN,active.test,REJECT/);
  });

  it('fails every different artifact targeting the same output without overwriting last-known-good', async () => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirrrule-plugin-artifact-'));
    const outputPath = path.join(directory, '挖财记账去广告.sgmodule');

    try {
      await fsp.writeFile(outputPath, 'known-good');
      const results = await publishPluginArtifacts([
        {
          result: {
            pluginName: 'WaCaiJiZhang_remove_ads',
            ...pluginIdentity('WaCaiJiZhang_remove_ads'),
            outputPath,
            scripts: [],
          },
          content: '#!name=挖财记账去广告\nfirst',
        },
        {
          result: {
            pluginName: 'Wacai_remove_ads',
            ...pluginIdentity('Wacai_remove_ads'),
            outputPath,
            scripts: [],
          },
          content: '#!name=挖财记账去广告\nsecond',
        },
      ], {});

      assert.deepEqual(results.map(result => result.status), ['failed', 'failed']);
      assert.ok(results.every(result => result.error?.includes('Conflicting converted plugins')));
      assert.equal(await fsp.readFile(outputPath, 'utf8'), 'known-good');
    } finally {
      await fsp.rm(directory, { recursive: true, force: true });
    }
  });

  it('allows different plugin sources to share an output when final content is identical', async () => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirrrule-plugin-artifact-'));
    const outputPath = path.join(directory, '挖财记账去广告.sgmodule');
    const content = '#!name=挖财记账去广告\nshared';

    try {
      const results = await publishPluginArtifacts([
        {
          result: {
            pluginName: 'WaCaiJiZhang_remove_ads',
            ...pluginIdentity('WaCaiJiZhang_remove_ads'),
            outputPath,
            scripts: [],
          },
          content,
        },
        {
          result: {
            pluginName: 'Wacai_remove_ads',
            ...pluginIdentity('Wacai_remove_ads'),
            outputPath,
            scripts: [],
          },
          content,
        },
      ], {});

      assert.deepEqual(results.map(result => result.status), ['ready', 'ready']);
      assert.equal(await fsp.readFile(outputPath, 'utf8'), content);
    } finally {
      await fsp.rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves last-known-good output when a required script is unavailable', async () => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirrrule-plugin-artifact-'));
    const outputPath = path.join(directory, 'example.sgmodule');

    try {
      await fsp.writeFile(outputPath, 'known-good');
      const [result] = await publishPluginArtifacts([{
        result: {
          pluginName: 'example',
          ...pluginIdentity('example'),
          outputPath,
          scripts: [{
            originalUrl: 'https://upstream.test/main.js',
            filename: 'main.js',
            isMirrored: false,
          }],
        },
        content: 'script-path=https://upstream.test/main.js',
      }], {});

      assert.equal(result.status, 'degraded');
      assert.match(result.error ?? '', /required script/i);
      assert.equal(await fsp.readFile(outputPath, 'utf8'), 'known-good');
      assert.deepEqual(await fsp.readdir(directory), ['example.sgmodule']);
    } finally {
      await fsp.rm(directory, { recursive: true, force: true });
    }
  });

  it('does not mark an owned mirror dependency ready without current validation', async () => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirrrule-plugin-artifact-'));
    const outputPath = path.join(directory, 'owned.sgmodule');
    const ownedUrl = 'https://nrrule.pages.dev/Scripts/owned.js';

    try {
      await fsp.writeFile(outputPath, 'known-good');
      const [result] = await publishPluginArtifacts([{
        result: {
          pluginName: 'owned',
          ...pluginIdentity('owned'),
          outputPath,
          scripts: [{ originalUrl: ownedUrl, filename: 'owned.js', isMirrored: true }],
        },
        content: `script-path=${ownedUrl}`,
      }], {});

      assert.equal(result.status, 'degraded');
      assert.match(result.error ?? '', /required script/i);
      assert.equal(await fsp.readFile(outputPath, 'utf8'), 'known-good');
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
          outputPath,
          scripts: [{
            originalUrl: 'https://upstream.test/missing.js',
            filename: 'missing.js',
            isMirrored: false,
          }],
        },
        content: 'script-path=https://upstream.test/missing.js',
      }], {});

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
          outputPath,
          scripts: [{ originalUrl, filename: 'cached.js', isMirrored: false }],
        },
        content: `script-path=${originalUrl}`,
      }], { [originalUrl]: mirrorUrl }, new Set([originalUrl]));

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
    const renamed = getPluginMirrorFilename({
      name: 'renamed-display-name',
      url: 'https://one.test/plugin.lpx',
      extension: 'plugin',
    });

    assert.equal(first, equivalent);
    assert.equal(first, renamed);
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

  it('falls back to last-known-good content after a forced refresh fails', async () => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirrrule-plugin-cache-'));
    const plugin = {
      name: 'refresh-test',
      url: 'https://plugins.test/refresh-test.plugin',
      extension: 'plugin' as const,
    };
    let available = true;
    const options = {
      mirrorDirectory: directory,
      fetchFn: () => Promise.resolve(available
        ? new Response('#!name = last-known-good\n[Rewrite]\n^https://ads\\.test/ reject\n')
        : new Response('unavailable', { status: 503 })),
    };

    try {
      const initial = await getPluginContent(plugin, true, options);
      assert.equal(initial.success, true);
      assert.equal(initial.fromCache, undefined);

      available = false;
      const fallback = await getPluginContent(plugin, true, options);
      assert.equal(fallback.success, true);
      assert.equal(fallback.content, '#!name = last-known-good\n[Rewrite]\n^https://ads\\.test/ reject\n');
      assert.equal(fallback.fromCache, true);
      assert.equal(fallback.degraded, true);
      assert.match(fallback.error ?? '', /HTTP 503/);
      assert.deepEqual(await fsp.readdir(directory), [getPluginMirrorFilename(plugin)]);
    } finally {
      await fsp.rm(directory, { recursive: true, force: true });
    }
  });
});

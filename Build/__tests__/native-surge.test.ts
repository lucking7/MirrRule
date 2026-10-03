import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadNativeSurgeModule } from '../integration/plugin-converter/native-surge';
import { getPluginContent } from '../integration/plugin-converter/plugin-mirror';
import { identifyPluginSource } from '../integration/plugin-converter/plugin-identity';
import type { PluginInfo } from '../integration/plugin-converter/types';

const plugin: PluginInfo = {
  name: 'blockAds',
  url: 'https://raw.githubusercontent.com/fmz200/wool_scripts/main/Surge/module/blockAds.module',
  extension: 'module',
  useNativeSurge: true,
};

test('native Surge sources remain unchanged and use canonical native identity', async () => {
  const content = '#!name=Native\n[Header Rewrite]\nhttp-response ^https://test/ header-del X-Test\n[Body Rewrite]\nhttp-response-jq ^https://test/ del(.ads)\n[Script]\nrun=type=http-response, script-path=https://example.com/a.js\n';
  const result = await loadNativeSurgeModule(plugin, (input, forceUpdate) => {
    assert.equal(input, plugin);
    assert.equal(forceUpdate, true);
    return Promise.resolve({ success: true, content });
  });
  assert.deepEqual(result, { pluginName: 'blockAds', ...identifyPluginSource(plugin), content });
});

test('native source refresh failures and cached or empty modules never become ready', async () => {
  for (const downloaded of [
    { success: false, error: 'unavailable' },
    { success: true, content: '#!name=Empty' },
    { success: true, content: '#!name=Cached\n[Rule]\nDOMAIN,test,DIRECT', degraded: true },
  ]) {
    const result = await loadNativeSurgeModule(plugin, () => Promise.resolve(downloaded));
    assert.equal(typeof result.content, 'object');
  }
});

test('native-only sections pass the actual mirror validator while Loon format stays strict', async () => {
  const mirrorDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-native-validator-'));
  try {
    for (const [section, entry] of [
      ['Header Rewrite', 'http-response ^https://test/ header-del X-Test'],
      ['Body Rewrite', 'http-response-jq ^https://test/ del(.ads)'],
      ['URL Rewrite', '^https://test/ - reject'],
      ['Panel', 'status=script-name=status'],
    ]) {
      const content = `#!name=Native\n[${section}]\n${entry}\n`;
      const result = await loadNativeSurgeModule(plugin, (input, forceUpdate) => getPluginContent(input, forceUpdate, {
        mirrorDirectory,
        fetchFn: () => Promise.resolve(new Response(content)),
      }));
      assert.equal(result.content, content, `${section} must survive the mirror validation`);
    }
    const loon = { ...plugin, url: 'https://plugins.test/loon.plugin', extension: 'plugin' as const, useNativeSurge: false };
    const result = await getPluginContent(loon, true, {
      mirrorDirectory,
      fetchFn: () => Promise.resolve(new Response('[Header Rewrite]\nhttp-response ^https://test/ header-del X-Test\n')),
    });
    assert.equal(result.success, false, 'Loon source validation must not gain native-only sections');
    for (const content of ['#!name=Empty', '[Header Rewrite]\n# no action\n']) {
      const rejected = await loadNativeSurgeModule(plugin, (input, forceUpdate) => getPluginContent(input, forceUpdate, {
        mirrorDirectory,
        fetchFn: () => Promise.resolve(new Response(content)),
      }));
      assert.equal(typeof rejected.content, 'object', 'empty native results and their cached fallback must fail');
    }
  } finally {
    await fs.rm(mirrorDirectory, { recursive: true, force: true });
  }
});

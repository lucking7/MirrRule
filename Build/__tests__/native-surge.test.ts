import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadNativeSurgeModule } from '../integration/plugin-converter/native-surge';
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

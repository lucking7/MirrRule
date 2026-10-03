import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import {
  convertPluginsLocallyBatch,
  setLocalConverterContentLoader,
} from '../integration/plugin-converter/local-converter';
import { identifyPluginSource } from '../integration/plugin-converter/plugin-identity';
import type { PluginInfo } from '../integration/plugin-converter/types';
import { LocalPluginConverter } from '../integration/plugin-converter/loon-to-surge-converter';

test('mixed Rewrite script entries retain body flags expressed as booleans', async () => {
  const source = '#!name=Mixed\n[Rewrite]\nhttp-response ^https://example.test/data script-path=https://example.test/a.js, requires-body=true, binary-body-mode=true\n';
  const converted = await new LocalPluginConverter().convert(source);
  assert.match(converted, /\[Script]/);
  assert.match(converted, /script-path=https:\/\/example\.test\/a\.js/);
  assert.match(converted, /requires-body=1/);
  assert.match(converted, /binary-body-mode=1/);
});

test('local fallback rejects native Loon v2 actions instead of publishing empty conversion', async t => {
  t.after(() => setLocalConverterContentLoader(null));
  setLocalConverterContentLoader(() => Promise.resolve({
    success: true,
    // eslint-disable-next-line no-template-curly-in-string -- Literal Loon v2 variable.
    content: '#!name=Native\n[Rewrite]\nresponse if ${url} ~= /^https:/ then response.body.mock("json", "{}", 200)\n',
  }));
  const [result] = await convertPluginsLocallyBatch([{ name: 'Native', url: 'fixture://native', extension: 'plugin' }]);
  assert.deepEqual(result.content, { error: 'Local fallback does not support Loon v2 syntax' });
});

test('local fallback rejects standalone body/header sections instead of dropping their actions', async t => {
  t.after(() => setLocalConverterContentLoader(null));
  for (const section of ['Header Rewrite', 'Body Rewrite']) {
    setLocalConverterContentLoader(() => Promise.resolve({
      success: true,
      content: `#!name=Standalone\n[${section}]\nhttp-response ^https://test/ unchanged\n`,
    }));
    const [result] = await convertPluginsLocallyBatch([{ name: 'Standalone', url: 'fixture://standalone', extension: 'plugin' }]);
    assert.deepEqual(result.content, { error: 'Local fallback does not support standalone Header/Body Rewrite sections' });
  }
});

test('local fallback rejects Loon PROXY rules without a Surge policy binding', async t => {
  t.after(() => setLocalConverterContentLoader(null));
  setLocalConverterContentLoader(() => Promise.resolve({
    success: true,
    content: '#!name=DNS防泄露\n[Rule]\nDOMAIN-SUFFIX,dnsleaktest.com,PROXY\n',
  }));
  const [result] = await convertPluginsLocallyBatch([{ name: 'Prevent_DNS_Leaks', url: 'fixture://dns', extension: 'plugin' }]);
  assert.deepEqual(result.content, { error: 'Loon PROXY rules require an explicit Surge policy binding' });
});

const fixtureRoot = path.join(process.cwd(), 'Build', '__tests__', 'fixtures');
const fixtureNames = ['metadata-rules', 'rewrites', 'scripts', 'minimal'] as const;
const plugins: PluginInfo[] = fixtureNames.map(name => ({
  name,
  url: `fixture://${name}`,
  extension: 'plugin',
}));

function readFixture(name: string): string {
  return fs.readFileSync(path.join(fixtureRoot, 'loon-plugins', `${name}.plugin`), 'utf8');
}

function readGolden(name: string): string {
  return fs.readFileSync(path.join(fixtureRoot, 'goldens', `${name}.sgmodule`), 'utf8');
}

test('convertPluginsLocallyBatch matches byte-level goldens deterministically and in order', async t => {
  t.after(() => setLocalConverterContentLoader(null));
  setLocalConverterContentLoader(plugin =>
    Promise.resolve({
      success: true,
      content: readFixture(plugin.name),
    })
  );

  const first = await convertPluginsLocallyBatch(plugins);
  const second = await convertPluginsLocallyBatch(plugins);

  assert.deepEqual(
    first.map(result => result.pluginName),
    fixtureNames
  );
  assert.deepEqual(second, first);
  for (const result of first) {
    assert.equal(result.content, readGolden(result.pluginName));
  }
});

test('loader failure preserves the error shape and does not affect later plugins', async t => {
  t.after(() => setLocalConverterContentLoader(null));
  setLocalConverterContentLoader(plugin => {
    if (plugin.name === 'failure') {
      return Promise.resolve({ success: false, error: 'simulated failure' });
    }
    return Promise.resolve({ success: true, content: readFixture(plugin.name) });
  });

  const results = await convertPluginsLocallyBatch([
    { name: 'failure', url: 'fixture://failure', extension: 'plugin' },
    plugins[0],
  ]);

  assert.deepEqual(results[0], {
    pluginName: 'failure',
    ...identifyPluginSource({ name: 'failure', url: 'fixture://failure', extension: 'plugin' }),
    content: { error: 'simulated failure' },
  });
  assert.deepEqual(results[1], {
    pluginName: 'metadata-rules',
    ...identifyPluginSource(plugins[0]),
    content: readGolden('metadata-rules'),
  });
});

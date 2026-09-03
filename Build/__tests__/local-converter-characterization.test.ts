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

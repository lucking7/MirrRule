import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  publishPluginArtifacts,
} from '../integration/plugin-converter/plugin-artifact';
import type { PendingPluginArtifact, PluginPublicationWork } from '../integration/plugin-converter/plugin-artifact';
import { extractScriptUrls } from '../integration/plugin-converter/script-extractor';
import { convertPluginsLocallyBatch, setLocalConverterContentLoader } from '../integration/plugin-converter/local-converter';
import { identifyPluginSource } from '../integration/plugin-converter/plugin-identity';

function plugin(name: string) {
  return { name, url: `https://plugins.test/${name}.plugin`, extension: 'plugin' as const };
}

test('ordered publication preserves interleaved failures, batch conflicts and dependency readiness', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-publication-work-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sharedUrl = 'https://scripts.test/shared.js';
  const mirroredUrl = 'https://nrrule.pages.dev/shared.js';
  const script = `[Script]\nrun = type=http-response, pattern=^https:, script-path=${sharedUrl}`;
  const pending = (name: string, filename: string, content: string): PendingPluginArtifact => ({
    result: {
      pluginName: name,
      ...identifyPluginSource(plugin(name)),
      outputPath: path.join(directory, filename),
      scripts: extractScriptUrls(content),
    },
    content,
  });
  const failed = {
    pluginName: 'download-failed',
    ...identifyPluginSource(plugin('download-failed')),
    status: 'failed' as const,
    scripts: [],
    error: 'download unavailable',
  };
  const work: PluginPublicationWork[] = [
    pending('first', 'first.sgmodule', script),
    failed,
    pending('conflict-a', 'conflict.sgmodule', '#!name=A\n' + script),
    pending('shared', 'shared.sgmodule', script),
    pending('conflict-b', 'conflict.sgmodule', '#!name=B\n' + script),
    pending('missing', 'missing.sgmodule', script.replace(sharedUrl, 'https://scripts.test/missing.js')),
    pending('retired', 'Tencent_Video_remove_ads.sgmodule', '[Rule]\nDOMAIN,test,REJECT'),
  ];
  await fs.writeFile(path.join(directory, 'conflict.sgmodule'), 'known-good');
  await fs.writeFile(path.join(directory, 'missing.sgmodule'), 'known-good');
  const results = await publishPluginArtifacts(work, { [sharedUrl]: mirroredUrl });
  assert.deepEqual(results.map(result => result.pluginName), ['first', 'download-failed', 'conflict-a', 'shared', 'conflict-b', 'missing', 'retired']);
  assert.deepEqual(results.map(result => result.status), ['ready', 'failed', 'failed', 'ready', 'failed', 'degraded', 'failed']);
  assert.deepEqual(results[1], failed);
  assert.match(results[2].error!, /Conflicting converted plugins/);
  assert.match(results[4].error!, /Conflicting converted plugins/);
  assert.match(results[5].error!, /required script.*unavailable/);
  assert.match(results[6].error!, /retired subscription filename/);
  const readyContents = await Promise.all(['first.sgmodule', 'shared.sgmodule'].map(filename => fs.readFile(path.join(directory, filename), 'utf8')));
  assert.deepEqual(readyContents, [script.replace(sharedUrl, mirroredUrl), script.replace(sharedUrl, mirroredUrl)]);
  const retainedContents = await Promise.all(['conflict.sgmodule', 'missing.sgmodule'].map(filename => fs.readFile(path.join(directory, filename), 'utf8')));
  assert.deepEqual(retainedContents, ['known-good', 'known-good']);
  await assert.rejects(fs.access(path.join(directory, 'Tencent_Video_remove_ads.sgmodule')));
});

test('local fallback retains every request and response jq action through publication', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-jq-publication-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  t.after(() => setLocalConverterContentLoader(null));
  setLocalConverterContentLoader(() => Promise.resolve({
    success: true,
    content: '#!name=Directions\n[Rewrite]\n^https://test/request1 request-body-json-jq del(.ad1)\n^https://test/request2 http-request-json-jq del(.ad2)\n^https://test/response1 response-body-json-jq del(.ad3)\n^https://test/response2 http-response-json-jq del(.ad4)\n^https://test/response3 response-json-jq del(.ad5)\n[MITM]\nhostname=test\n',
  }));
  const [conversion] = await convertPluginsLocallyBatch([plugin('Directions')]);
  assert.equal(typeof conversion.content, 'string');
  if (typeof conversion.content !== 'string') throw new Error(conversion.content.error);
  const outputPath = path.join(directory, 'Directions.sgmodule');
  const [result] = await publishPluginArtifacts([{
    content: conversion.content,
    result: { pluginName: conversion.pluginName, sourceId: conversion.sourceId, sourceUrl: conversion.sourceUrl, outputPath, scripts: extractScriptUrls(conversion.content) },
  }], {});
  assert.equal(result.status, 'ready');
  const emitted = await fs.readFile(outputPath, 'utf8');
  assert.deepEqual(emitted.split('\n').filter(line => /^http-.*-jq /.test(line)), [
    'http-request-jq ^https://test/request1 \'del(.ad1)\'',
    'http-request-jq ^https://test/request2 \'del(.ad2)\'',
    'http-response-jq ^https://test/response1 \'del(.ad3)\'',
    'http-response-jq ^https://test/response2 \'del(.ad4)\'',
    'http-response-jq ^https://test/response3 \'del(.ad5)\'',
  ]);
});

test('unknown rewrite fails through fallback rather than producing a MITM-only ready artifact', async t => {
  t.after(() => setLocalConverterContentLoader(null));
  setLocalConverterContentLoader(() => Promise.resolve({
    success: true,
    content: '#!name=Unknown\n[Rewrite]\n^https://test/data request-body-unknown del(.ads)\n[MITM]\nhostname=test\n',
  }));
  const [result] = await convertPluginsLocallyBatch([plugin('Unknown')]);
  assert.deepEqual(result.content, { error: 'Unsupported local rewrite: ^https://test/data request-body-unknown del(.ads)' });
});

test('real conversion entry deduplicates shared scripts and returns interleaved results in order', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-plugin-entry-work-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const converterDirectory = path.resolve(__dirname, '../integration/plugin-converter');
  const program = String.raw`
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    const Module = require('node:module');
    const converterDirectory = ${JSON.stringify(converterDirectory)};
    function replace(filename, exports) {
      const mod = new Module(filename);
      mod.filename = filename;
      mod.loaded = true;
      mod.exports = exports;
      require.cache[filename] = mod;
    }
    function replaceFile(name, overrides) {
      const filename = require.resolve(path.join(converterDirectory, name));
      replace(filename, { ...require(filename), ...overrides });
    }
    const names = ['first', 'download-failed', 'collision-a', 'second', 'collision-b', 'missing'];
    const plugins = names.map(name => ({ name, url: 'https://plugins.test/' + name + '.plugin', extension: 'plugin' }));
    const { identifyPluginSource } = require(path.join(converterDirectory, 'plugin-identity.ts'));
    const shared = 'https://scripts.test/shared.js';
    const missing = 'https://scripts.test/missing.js';
    replaceFile('plugin-list.ts', { getPluginList: async () => plugins });
    replaceFile('script-hub-client.ts', {
      convertPluginsBatchFromLocalMirror: async () => plugins.map(plugin => ({
        pluginName: plugin.name,
        ...identifyPluginSource(plugin),
        content: plugin.name === 'download-failed' ? { error: 'failed input' } :
          '#!name=' + (plugin.name.startsWith('collision-') ? 'Collision' : plugin.name) +
          '\n#!desc=' + plugin.name + '\n[Script]\nrun = type=http-response, pattern=^https:, script-path=' +
          (plugin.name === 'missing' ? missing : shared),
      })),
    });
    let mirrored;
    replaceFile('script-mirror.ts', {
      mirrorScripts: async scripts => {
        mirrored = scripts.map(script => script.originalUrl);
        return { urlMap: { [shared]: 'https://nrrule.pages.dev/shared.js' }, degradedUrls: [], mirrored: 1, skipped: 0 };
      },
      printMirrorSummary: () => {},
    });
    (async () => {
      const output = path.join(process.env.PUBLIC_DIR, 'Modules/Converted');
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, 'Collision.sgmodule'), 'known-good');
      const { convertAndMirrorPlugins } = require(path.join(converterDirectory, 'index.ts'));
      const results = await convertAndMirrorPlugins(false, false);
      assert.deepEqual(results.map(result => result.pluginName), names);
      assert.deepEqual(results.map(result => result.status), ['ready', 'failed', 'failed', 'ready', 'failed', 'failed']);
      assert.deepEqual(mirrored, [shared, missing]);
      assert.equal(fs.readFileSync(path.join(output, 'Collision.sgmodule'), 'utf8'), 'known-good');
      assert.equal(fs.existsSync(path.join(output, 'missing.sgmodule')), false);
      assert.match(fs.readFileSync(path.join(output, 'first.sgmodule'), 'utf8'), /script-path=https:\/\/nrrule.pages.dev\/shared.js/);
      assert.match(fs.readFileSync(path.join(output, 'second.sgmodule'), 'utf8'), /script-path=https:\/\/nrrule.pages.dev\/shared.js/);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const run = spawnSync(process.execPath, ['-r', require.resolve('@swc-node/register'), '-e', program], {
    cwd: directory,
    env: { ...process.env, SWC_NODE_IGNORE_DYNAMIC: 'true', SWC_NODE_PROJECT: path.resolve(__dirname, '../../tsconfig.json'), PUBLIC_DIR: path.join(directory, 'public') },
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.ifError(run.error);
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

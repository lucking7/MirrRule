import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';

import { updatePluginMetadata } from '../integration/plugin-converter/provenance';
import { buildClassifiedProxyUrlCandidates } from '../utils/network/proxy';

describe('plugin proxy candidates', () => {
  it('classifies no-proxy, direct-first, and forced fallback candidates structurally', () => {
    const previous = process.env.PROXY_BASE;
    const url = 'https://example.test/list.json';
    try {
      delete process.env.PROXY_BASE;
      assert.deepEqual(buildClassifiedProxyUrlCandidates(url, { forceProxy: true }), [
        { url, source: 'direct' },
      ]);
      process.env.PROXY_BASE = 'https://opaque.example/?url=';
      assert.deepEqual(buildClassifiedProxyUrlCandidates(url, { forceProxy: true, preferDirect: true }), [
        { url, source: 'direct' },
        { url: `https://opaque.example/?url=${url}`, source: 'proxy' },
      ]);
      assert.deepEqual(buildClassifiedProxyUrlCandidates(url, { forceProxy: true }), [
        { url: `https://opaque.example/?url=${url}`, source: 'proxy' },
        { url, source: 'direct' },
      ]);
    } finally {
      if (previous === undefined) delete process.env.PROXY_BASE;
      else process.env.PROXY_BASE = previous;
    }
  });
});

describe('plugin provenance metadata', () => {
  it('handles baselines, thresholds, digest changes, corruption, and unchanged content', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-provenance-'));
    const metadataPath = path.join(directory, 'metadata.json');
    const summaryPath = path.join(directory, 'summary.md');
    try {
      assert.deepEqual(await updatePluginMetadata({ listCount: 100, scripts: { a: 'one' } }, metadataPath, summaryPath), []);
      assert.deepEqual(await updatePluginMetadata({ listCount: 70, scripts: { a: 'one' } }, metadataPath, summaryPath), []);
      await updatePluginMetadata({ listCount: 100 }, metadataPath, summaryPath);
      assert.equal((await updatePluginMetadata({ listCount: 69 }, metadataPath, summaryPath)).length, 1);
      assert.deepEqual(await updatePluginMetadata({ scripts: { a: 'one' } }, metadataPath, summaryPath), []);
      assert.deepEqual(await updatePluginMetadata({ scripts: { a: 'two' } }, metadataPath, summaryPath), [
        'script SHA-256 changed: a',
      ]);
      assert.match(await fs.readFile(summaryPath, 'utf8'), /Plugin provenance warnings/);

      await fs.writeFile(metadataPath, '{broken');
      assert.deepEqual(await updatePluginMetadata({ listCount: 10, scripts: { a: 'fresh' } }, metadataPath, summaryPath), []);
      assert.equal(JSON.parse(await fs.readFile(metadataPath, 'utf8')).listCount, 10);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

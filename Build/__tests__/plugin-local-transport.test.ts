import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { request } from 'node:http';
import { test } from 'node:test';

import { convertPluginsBatchFromLocalMirror } from '../integration/plugin-converter/script-hub-client';
import { identifyPluginSource } from '../integration/plugin-converter/plugin-identity';
import type { PluginInfo } from '../integration/plugin-converter/types';
import { startLocalPluginServer } from '../integration/plugin-converter/local-plugin-server';
import process from 'node:process';
import { applyProxyIfNeeded, buildProxyUrlCandidates } from '../utils/network/proxy';

test('loopback gateway preserves nested plugin query parameters', () => {
  const previous = process.env.PROXY_BASE;
  process.env.PROXY_BASE = 'http://127.0.0.1:13193?url=';
  try {
    const source = 'https://kelee.one/sample.plugin?version=2&key=a%2Bb';
    assert.equal(new URL(applyProxyIfNeeded(source)).searchParams.get('url'), source);
    assert.equal(new URL(buildProxyUrlCandidates(source)[0]).searchParams.get('url'), source);
  } finally {
    if (previous === undefined) delete process.env.PROXY_BASE;
    else process.env.PROXY_BASE = previous;
  }
});

test('loopback plugin server limits methods and paths and waits for shared shutdown', async () => {
  const plugin: PluginInfo = { name: 'sample', url: 'https://plugins.test/sample.lpx', extension: 'lpx' };
  const content = '#!name=示例\n[Rule]\nDOMAIN,ads.test,REJECT\n';
  const server = await startLocalPluginServer([{ plugin, content }]);
  const sourceUrl = server.sourceUrls.get(identifyPluginSource(plugin).sourceId)!;
  try {
    const head = await fetch(sourceUrl, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers.get('content-length')), new TextEncoder().encode(content).length);
    assert.equal(await head.text(), '');
    assert.equal((await fetch(sourceUrl, { method: 'POST' })).status, 405);
    assert.equal((await fetch(new URL('/unlisted.plugin', sourceUrl))).status, 404);
    const malformedStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: new URL(sourceUrl).port, path: 'http://[' }, res => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(malformedStatus, 400);
    assert.equal(await (await fetch(sourceUrl)).text(), content, 'malformed requests must not crash the server');
  } finally {
    const firstClose = server.close();
    assert.equal(server.close(), firstClose);
    await firstClose;
  }
  await assert.rejects(fetch(sourceUrl));
});

test('Script-Hub reads freshly downloaded plugins from a closed loopback mirror', async () => {
  const mirrorDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirrrule-local-plugin-'));
  const available: PluginInfo = {
    name: 'available',
    url: 'https://plugins.test/available.plugin',
    extension: 'plugin',
  };
  const unavailable: PluginInfo = {
    name: 'unavailable',
    url: 'https://plugins.test/unavailable.plugin',
    extension: 'plugin',
  };
  const pluginBody = '#!name = Available\n\n[Rewrite]\n^https://ads\\.test/ reject\n';
  let scriptHubCalls = 0;
  let localSourceUrl = '';

  try {
    const results = await convertPluginsBatchFromLocalMirror(
      [available, unavailable],
      undefined,
      5,
      {
        mirrorOptions: {
          mirrorDirectory,
          fetchFn: url => Promise.resolve(url.includes('unavailable')
            ? new Response('<!doctype html><title>blocked</title>')
            : new Response(pluginBody)),
        },
        async scriptHubFetchFn(url) {
          scriptHubCalls++;
          const match = /\/file\/_start_\/(.+)\/_end_\//.exec(url);
          assert.ok(match, 'Script-Hub request should contain a source URL');
          localSourceUrl = decodeURI(match[1]);
          const parsed = new URL(localSourceUrl);
          assert.equal(parsed.hostname, '127.0.0.1');
          assert.match(parsed.pathname, new RegExp(identifyPluginSource(available).sourceId));

          const sourceResponse = await fetch(localSourceUrl);
          assert.equal(sourceResponse.status, 200);
          assert.equal(await sourceResponse.text(), pluginBody);

          return new Response('#!name=Available\n[Map Local]\n^https://example.test/ data="error: a valid response body", status-code=200\n');
        },
      }
    );

    assert.equal(scriptHubCalls, 1, 'a failed download must not reach Script-Hub');
    assert.deepEqual(results[0], {
      pluginName: available.name,
      ...identifyPluginSource(available),
      content: '#!name=Available\n[Map Local]\n^https://example.test/ data="error: a valid response body", status-code=200\n',
    });
    assert.equal(results[1].pluginName, unavailable.name);
    assert.equal(results[1].failureStage, 'download');
    assert.deepEqual(
      { sourceId: results[1].sourceId, sourceUrl: results[1].sourceUrl },
      identifyPluginSource(unavailable),
    );
    assert.match(
      typeof results[1].content === 'string' ? '' : results[1].content.error,
      /download failed.*invalid plugin format/i,
    );

    await assert.rejects(fetch(localSourceUrl), /fetch failed/i);
  } finally {
    await fsp.rm(mirrorDirectory, { recursive: true, force: true });
  }
});

test('staged jq_file and mock_file actions use the gateway without changing canonical source identity', async () => {
  const previous = process.env.PROXY_BASE;
  process.env.PROXY_BASE = 'http://127.0.0.1:13193?url=';
  const mirrorDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirrrule-jq-plugin-'));
  const plugin: PluginInfo = { name: 'jq', url: 'https://plugins.test/jq.plugin', extension: 'plugin' };
  const dependency = 'https://kelee.one/Resource/JQLang/Bilibili/test.jq?version=2&key=a%2Bb';
  const other = 'https://other.test/test.jq';
  const mockFile = 'https://kelee.one/Resource/JavaScript/test.js?version=2&key=a%2Bb';
  const source = `#!name=JQ\n[Rewrite]\nresponse then response.json.jq_file("${dependency}")\nresponse then response.json.jq_file("${other}")\nresponse then response.body.mock_file("text", "${mockFile}", 200)\n`;
  try {
    const results = await convertPluginsBatchFromLocalMirror([plugin], undefined, 1, {
      mirrorOptions: { mirrorDirectory, fetchFn: () => Promise.resolve(new Response(source)) },
      async scriptHubFetchFn(url) {
        const match = /\/file\/_start_\/(.+)\/_end_\//.exec(url)!;
        const staged = await (await fetch(decodeURI(match[1]))).text();
        assert.ok(staged.includes(`jq_file("${applyProxyIfNeeded(dependency)}")`));
        assert.ok(staged.includes(`jq_file("${other}")`));
        assert.ok(staged.includes(`mock_file("text", "${applyProxyIfNeeded(mockFile)}", 200)`));
        const gateway = new URL(/jq_file\("([^"]+)"\)/.exec(staged)![1]);
        assert.equal(gateway.searchParams.get('url'), dependency);
        return new Response('#!name=JQ\n[Body Rewrite]\nhttp-response-jq ^https://test/ del(.ads)\n');
      },
    });
    assert.equal(results[0].sourceId, identifyPluginSource(plugin).sourceId);
    assert.equal(typeof results[0].content, 'string');
  } finally {
    if (previous === undefined) delete process.env.PROXY_BASE;
    else process.env.PROXY_BASE = previous;
    await fsp.rm(mirrorDirectory, { recursive: true, force: true });
  }
});

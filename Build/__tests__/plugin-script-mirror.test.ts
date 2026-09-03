import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';

import { applyScriptMirrorMap } from '../integration/plugin-converter';
import { extractScriptUrls } from '../integration/plugin-converter/script-extractor';
import { mirrorScripts } from '../integration/plugin-converter/script-mirror';

const firstUrl = 'https://one.example/assets/main.js';
const secondUrl = 'https://two.example/main.js';

function script(url: string) {
  return { originalUrl: url, filename: 'main.js', isMirrored: false };
}

function response(content: string, status = 200) {
  return Promise.resolve(new Response(content, { status }));
}

describe('plugin script mirroring', () => {
  it('uses stable collision-free names for equal basenames', async () => {
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-scripts-'));

    try {
      const fetchFn = () => response('console.log("valid script");');
      const first = await mirrorScripts([script(firstUrl), script(secondUrl)], 2, {
        outputDirectory,
        fetchFn,
        metadataPath: path.join(outputDirectory, 'metadata.json'),
      });
      const second = await mirrorScripts([script(firstUrl), script(secondUrl)], 2, {
        outputDirectory,
        fetchFn,
        metadataPath: path.join(outputDirectory, 'metadata.json'),
      });

      assert.notEqual(first.urlMap[firstUrl], first.urlMap[secondUrl]);
      assert.deepEqual(second.urlMap, first.urlMap);
      assert.match(first.urlMap[firstUrl], /\/Scripts\/[\da-f]{12}-main\.js$/);
      assert.equal(second.mirrored, 0);
      assert.equal(second.skipped, 2);
    } finally {
      fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it('refreshes changed bytes and preserves a warm cache after refresh failure', async () => {
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-scripts-'));

    try {
      const initial = await mirrorScripts([script(firstUrl)], 1, {
        outputDirectory,
        fetchFn: () => response('console.log("version one");'),
        metadataPath: path.join(outputDirectory, 'metadata.json'),
      });
      const filename = path.basename(new URL(initial.urlMap[firstUrl]).pathname);
      const outputPath = path.join(outputDirectory, filename);

      const refreshed = await mirrorScripts([script(firstUrl)], 1, {
        outputDirectory,
        fetchFn: () => response('console.log("version two");'),
        metadataPath: path.join(outputDirectory, 'metadata.json'),
      });
      assert.equal(refreshed.mirrored, 1);
      assert.equal(fs.readFileSync(outputPath, 'utf8'), 'console.log("version two");');

      const failed = await mirrorScripts([script(firstUrl)], 1, {
        outputDirectory,
        fetchFn: () => response('bad', 500),
        metadataPath: path.join(outputDirectory, 'metadata.json'),
      });
      assert.equal(failed.failed, 1);
      assert.equal(failed.urlMap[firstUrl], initial.urlMap[firstUrl]);
      assert.deepEqual(failed.degradedUrls, [firstUrl]);
      assert.equal(fs.readFileSync(outputPath, 'utf8'), 'console.log("version two");');
    } finally {
      fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it('uses direct first, then records a structurally classified proxy fallback', async () => {
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-scripts-'));
    const proxyEligibleUrl = 'https://kelee.one/assets/main.js';
    const previousProxy = process.env.PROXY_BASE;
    process.env.PROXY_BASE = 'https://secret-proxy.example/?url=';
    const calls: string[] = [];

    try {
      const result = await mirrorScripts([script(proxyEligibleUrl)], 1, {
        outputDirectory,
        metadataPath: path.join(outputDirectory, 'metadata.json'),
        fetchFn(url) {
          calls.push(url);
          return calls.length === 1
            ? response('unavailable', 503)
            : response('console.log("proxy fallback");');
        },
      });

      assert.deepEqual(calls, [proxyEligibleUrl, `${process.env.PROXY_BASE}${proxyEligibleUrl}`]);
      assert.equal(result.provenance[proxyEligibleUrl].source, 'proxy');
      assert.equal(result.provenance[proxyEligibleUrl].bytes, 30);
      assert.match(result.provenance[proxyEligibleUrl].sha256, /^[\da-f]{64}$/);
    } finally {
      if (previousProxy === undefined) delete process.env.PROXY_BASE;
      else process.env.PROXY_BASE = previousProxy;
      fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it('rewrites available warm-cache mirrors and leaves unavailable URLs external', () => {
    const content = `[Script]\nfirst = script-path=${firstUrl}\nsecond = script-path=${secondUrl}`;
    const scripts = extractScriptUrls(content);
    const mirrorUrl = 'https://nrrule.pages.dev/Scripts/abc123def456-main.js';

    const updated = applyScriptMirrorMap(content, scripts, { [firstUrl]: mirrorUrl });

    assert.match(updated, new RegExp(mirrorUrl));
    assert.match(updated, new RegExp(secondUrl.replaceAll('.', String.raw`\.`)));
  });
});

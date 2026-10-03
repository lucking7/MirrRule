import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';

import { applyScriptMirrorMap } from '../integration/plugin-converter';
import { extractScriptUrls, validateScriptPreservation } from '../integration/plugin-converter/script-extractor';
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
  it('requires both legacy and Loon v2 source scripts to survive conversion', () => {
    const source = `#!name=sample\n[Script]\nhttp-response ^https://one script-path=${firstUrl}\nresponse if \u0024{url} == "https://two" then script("${secondUrl}") with requires_body=true\n# response then script("https://ignored.test/example.js")\n`;
    assert.match(validateScriptPreservation(source, '#!name=sample\n[MITM]\nhostname=one') ?? '', /dropped 2/);
    assert.match(validateScriptPreservation(source, `[Script]\nfirst=script-path=${firstUrl}`) ?? '', /dropped 1/);
    assert.equal(validateScriptPreservation(source, `[Script]\nfirst=script-path=${firstUrl}\nsecond=script-path=${secondUrl}`), undefined);
    assert.match(validateScriptPreservation(source, `# response.body.mock(...) [Loon v2: unsupported]\n[Script]\nfirst=script-path=${firstUrl}\nsecond=script-path=${secondUrl}`) ?? '', /Unsupported Loon v2/);
  });
  it('rejects HTTP 200 challenge pages and preserves only a degraded warm mirror', async () => {
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-scripts-'));
    try {
      const options = { outputDirectory, metadataPath: path.join(outputDirectory, 'metadata.json') };
      const ready = await mirrorScripts([script(firstUrl)], 1, {
        ...options, fetchFn: () => response('console.log("<body> valid script");'),
      });
      const blocked = await mirrorScripts([script(firstUrl), script(secondUrl)], 1, {
        ...options, fetchFn: () => response('<!doctype html><title>Just a moment</title>'),
      });
      assert.equal(blocked.failed, 2);
      assert.deepEqual(blocked.degradedUrls, [firstUrl]);
      assert.equal(blocked.urlMap[firstUrl], ready.urlMap[firstUrl]);
      assert.equal(blocked.urlMap[secondUrl], undefined);
      assert.equal(fs.readFileSync(path.join(outputDirectory, path.basename(ready.urlMap[firstUrl])), 'utf8'), 'console.log("<body> valid script");');
    } finally {
      fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
  it('extracts source metadata without predicting a mirror URL', () => {
    assert.deepEqual(extractScriptUrls(`script-path=${firstUrl}`), [{
      originalUrl: firstUrl,
      filename: 'main.js',
      isMirrored: false,
    }]);
  });

  it('recognizes mirrored scripts with either HTTP scheme', () => {
    for (const scheme of ['http', 'https']) {
      const [script] = extractScriptUrls(`script-path=${scheme}://nrrule.pages.dev/Scripts/main.js`);
      assert.equal(script.isMirrored, true);
    }
  });

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

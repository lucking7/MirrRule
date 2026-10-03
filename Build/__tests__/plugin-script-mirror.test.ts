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
const ownedMirrorUrl = 'https://nrrule.pages.dev/Scripts/owned-main.js';

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

  it('rejects metadata-only and empty converted modules', () => {
    const dnsMetadataOnly = [
      '#!name=DNS防泄露',
      '#!desc=防止 DNS 泄露',
      '#!author=KOP-XIAO',
      '#!homepage=https://github.com/KOP-XIAO/QuantumultX',
    ].join('\n');
    assert.match(validateScriptPreservation('#!name=DNS防泄露', dnsMetadataOnly) ?? '', /no active supported functional entries/);
    assert.match(validateScriptPreservation('#!name=empty', '#!name=empty\n[Script]\n# no converted entries\n; disabled') ?? '', /no active supported functional entries/);
  });

  it('accepts active entries in supported functional sections', () => {
    const entries = new Map([
      ['General', 'skip-proxy = 192.168.0.0/16'],
      ['Rule', 'DOMAIN,example.com,DIRECT'],
      ['URL Rewrite', '^https://example\\.com - reject'],
      ['Map Local', '^https://example\\.com data="" status-code=404'],
      ['Script', `example = type=http-response,pattern=^https://example\\.com,script-path=${firstUrl}`],
      ['Panel', 'example = script-name=example,update-interval=60'],
      ['MITM', 'hostname = example.com'],
      ['Body Rewrite', 'http-response ^https://example\\.com response-body-replace-regex foo bar'],
    ]);

    for (const [section, entry] of entries) {
      assert.equal(validateScriptPreservation('', `[${section}]\n${entry}`), undefined, section);
    }
    assert.equal(
      validateScriptPreservation('', '[Header Rewrite]\nhttp-request ^https://example\\.com header-replace X-Test value\n[Rule]\nDOMAIN,example.com,DIRECT'),
      undefined
    );
  });

  it('accepts Header Rewrite as the only active section', () => {
    const converted = '[Header Rewrite]\nhttp-request ^https://example\\.com header-replace X-Test value';
    assert.equal(validateScriptPreservation('', converted), undefined);
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

  it('recognizes only exact HTTPS owned mirror URLs', () => {
    const [owned] = extractScriptUrls('script-path=https://nrrule.pages.dev/Scripts/main.js');
    assert.equal(owned.isMirrored, true);

    const externalUrls = [
      'http://nrrule.pages.dev/Scripts/main.js',
      'https://nrrule.pages.dev.evil.test/Scripts/main.js',
      'https://example.test/main.js?next=https://nrrule.pages.dev/Scripts/main.js',
      'https://nrrule.pages.dev/Other/main.js?path=/Scripts/main.js',
    ];
    for (const url of externalUrls) {
      const [external] = extractScriptUrls(`script-path=${url}`);
      assert.equal(external.isMirrored, false, url);
    }
  });

  it('downloads and validates an owned mirror into the referenced Scripts path', async () => {
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-scripts-'));
    const calls: string[] = [];

    try {
      const result = await mirrorScripts([{
        originalUrl: ownedMirrorUrl,
        filename: 'owned-main.js',
        isMirrored: true,
      }], 1, {
        outputDirectory,
        metadataPath: path.join(outputDirectory, 'metadata.json'),
        fetchFn(url) {
          calls.push(url);
          return response('console.log("owned mirror");');
        },
      });

      assert.deepEqual(calls, [ownedMirrorUrl]);
      assert.equal(result.mirrored, 1);
      assert.equal(result.urlMap[ownedMirrorUrl], ownedMirrorUrl);
      assert.equal(
        fs.readFileSync(path.join(outputDirectory, 'owned-main.js'), 'utf8'),
        'console.log("owned mirror");'
      );
    } finally {
      fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it('fails an unavailable owned mirror and marks a valid cached file degraded', async () => {
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-scripts-'));
    const options = {
      outputDirectory,
      metadataPath: path.join(outputDirectory, 'metadata.json'),
      fetchFn: () => response('unavailable', 503),
    };
    const ownedScript = {
      originalUrl: ownedMirrorUrl,
      filename: 'owned-main.js',
      isMirrored: true,
    };

    try {
      const missing = await mirrorScripts([ownedScript], 1, options);
      assert.equal(missing.failed, 1);
      assert.equal(missing.urlMap[ownedMirrorUrl], undefined);

      fs.writeFileSync(path.join(outputDirectory, 'owned-main.js'), 'console.log("cached mirror");');
      const cached = await mirrorScripts([ownedScript], 1, options);
      assert.equal(cached.failed, 1);
      assert.equal(cached.urlMap[ownedMirrorUrl], ownedMirrorUrl);
      assert.deepEqual(cached.degradedUrls, [ownedMirrorUrl]);
    } finally {
      fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it('rejects an HTML response for an owned mirror without publishing it', async () => {
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-scripts-'));

    try {
      const result = await mirrorScripts([{
        originalUrl: ownedMirrorUrl,
        filename: 'owned-main.js',
        isMirrored: true,
      }], 1, {
        outputDirectory,
        metadataPath: path.join(outputDirectory, 'metadata.json'),
        fetchFn: () => response('<!doctype html><title>Just a moment</title>'),
      });

      assert.equal(result.failed, 1);
      assert.equal(result.urlMap[ownedMirrorUrl], undefined);
      assert.equal(fs.existsSync(path.join(outputDirectory, 'owned-main.js')), false);
    } finally {
      fs.rmSync(outputDirectory, { recursive: true, force: true });
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

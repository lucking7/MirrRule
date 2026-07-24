import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
      });
      const second = await mirrorScripts([script(firstUrl), script(secondUrl)], 2, {
        outputDirectory,
        fetchFn,
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
      });
      const filename = path.basename(new URL(initial.urlMap[firstUrl]).pathname);
      const outputPath = path.join(outputDirectory, filename);

      const refreshed = await mirrorScripts([script(firstUrl)], 1, {
        outputDirectory,
        fetchFn: () => response('console.log("version two");'),
      });
      assert.equal(refreshed.mirrored, 1);
      assert.equal(fs.readFileSync(outputPath, 'utf8'), 'console.log("version two");');

      const failed = await mirrorScripts([script(firstUrl)], 1, {
        outputDirectory,
        fetchFn: () => response('bad', 500),
      });
      assert.equal(failed.failed, 1);
      assert.equal(failed.urlMap[firstUrl], initial.urlMap[firstUrl]);
      assert.equal(fs.readFileSync(outputPath, 'utf8'), 'console.log("version two");');
    } finally {
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

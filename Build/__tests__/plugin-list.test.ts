import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import { downloadPluginList, extractPluginUrls } from '../integration/plugin-converter/plugin-list';
import type { CatalogAttempt } from '../integration/plugin-converter/plugin-list';

describe('plugin catalog URL extraction', () => {
  it('unwraps Loon installation links without dropping query parameters or source identity', () => {
    const source = 'https://kelee.one/Tool/Loon/Lpx/example.lpx?version=2';
    const catalog = JSON.stringify({ lists: [
      { url: `loon://install-plugin?url=${encodeURIComponent(source)}` },
      { nested: [source, 'https://plugins.test/another.plugin#description'] },
      { url: 'https://plugins.test/not-a-plugin.js' },
      { url: 'https://plugins.test/fake.plugin/not-plugin' },
    ] });

    assert.deepEqual(extractPluginUrls(catalog), [
      source,
      'https://plugins.test/another.plugin#description',
    ]);
  });

  it('rejects HTML and invalid catalog JSON before extracting URLs', () => {
    assert.throws(() => extractPluginUrls('<html>https://plugins.test/fake.plugin</html>'));
    assert.deepEqual(extractPluginUrls('{"lists":[]}'), []);
  });
});

describe('private runner-input catalog reuse', () => {
  it('accepts only matching bytes that contain usable URLs', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'plugin-list-test-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'catalog.json');
    const savedEnv = process.env;
    process.env = { ...savedEnv, KELEE_INTERNAL_CHECK: 'true', KELEE_CATALOG_FILE: file };
    t.after(() => { process.env = savedEnv; });

    const url = 'https://plugins.test/demo.lpx';
    const catalog = JSON.stringify({ lists: [{ url }] });
    const fixtures = [
      { body: catalog, digest: createHash('sha256').update(catalog).digest('hex'), accepted: true },
      { body: catalog, digest: '0'.repeat(64), accepted: false },
      { body: '{"lists":[]}', digest: createHash('sha256').update('{"lists":[]}').digest('hex'), accepted: false },
    ];
    for (const { body, digest, accepted } of fixtures) {
      await writeFile(file, body);
      process.env.KELEE_CATALOG_SHA256 = digest;
      const attempts: CatalogAttempt[] = [];
      const result = await downloadPluginList((attempt) => attempts.push(attempt));
      if (accepted) assert.deepEqual(result, [url]);
      else assert.equal(Array.isArray(result), false);
      assert.deepEqual(attempts, [{
        source: 'runner-input',
        bytes: Buffer.byteLength(body),
        sha256: createHash('sha256').update(body).digest('hex'),
        outcome: accepted ? 'accepted' : 'invalid-body',
      }]);
    }
  });
});

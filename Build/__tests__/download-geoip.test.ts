import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import { Response } from 'undici';
import type { GEOIPFile } from '../download-geoip';
import { downloadGEOIPFiles } from '../download-geoip';
import type { Span } from '../trace';

const fakeSpan = {
  traceChildAsync<T>(_name: string, fn: () => Promise<T>) {
    return fn();
  }
};

describe('downloadGEOIPFiles', () => {
  it('downloads GEOIP files concurrently', async () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-geoip-'));

    const files: GEOIPFile[] = [
      { path: 'GeoIP/a.mmdb', url: 'https://example.com/a.mmdb' },
      { path: 'GeoIP/b.mmdb', url: 'https://example.com/b.mmdb' },
      { path: 'GeoIP/c.mmdb', url: 'https://example.com/c.mmdb' }
    ];

    let active = 0;
    let maxActive = 0;

    const fetchFn = async (): Promise<Response> => {
      active++;
      maxActive = Math.max(maxActive, active);
      let timer: ReturnType<typeof setTimeout> | undefined;
      await new Promise(resolve => {
        timer = setTimeout(resolve, 25);
      });
      if (timer) {
        clearTimeout(timer);
      }
      active--;
      const body = Readable.toWeb(Readable.from(['mmdb-data'])) as ReadableStream<Uint8Array>;
      return new Response(body);
    };

    const stats = await downloadGEOIPFiles(fakeSpan as Span, files, { outputRoot, fetchFn });

    assert.equal(stats.success, files.length);
    assert.equal(stats.failed, 0);
    assert.equal(stats.total, files.length);
    assert.ok(maxActive > 1, `expected concurrent downloads, but maxActive was ${maxActive}`);

    for (const file of files) {
      const expectedPath = path.join(outputRoot, file.path);
      assert.ok(fs.existsSync(expectedPath), `expected ${expectedPath} to exist`);
      assert.ok(fs.statSync(expectedPath).size > 0);
    }
  });
});

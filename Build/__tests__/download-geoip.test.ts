import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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

const validMmdbBytes = fs.readFileSync(path.join(__dirname, 'fixtures/mmdb/GeoIP2-ISP-Test.mmdb'));

function assertNoTemporarySiblings(outputPath: string) {
  const prefix = `${path.basename(outputPath)}.`;
  const siblings = fs.readdirSync(path.dirname(outputPath));
  assert.deepEqual(siblings.filter(name => name.startsWith(prefix) && name.endsWith('.tmp')), []);
}

function partialErrorResponse(): Response {
  const body = new Readable({
    read() {
      this.push('partial-mmdb-data');
      this.destroy(new Error('stream failed'));
    }
  });
  return new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>);
}

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
      const body = Readable.toWeb(Readable.from([validMmdbBytes])) as ReadableStream<Uint8Array>;
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

  it('does not create a final file when a stream fails after emitting bytes', async () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-geoip-'));
    const file = { path: 'GeoIP/failing.mmdb', url: 'https://example.com/failing.mmdb' };
    const outputPath = path.join(outputRoot, file.path);

    const stats = await downloadGEOIPFiles(fakeSpan as Span, [file], {
      outputRoot,
      fetchFn: () => Promise.resolve(partialErrorResponse())
    });

    assert.deepEqual(stats, { success: 0, failed: 1, total: 1 });
    assert.equal(fs.existsSync(outputPath), false);
    assertNoTemporarySiblings(outputPath);
  });

  it('preserves an existing final file when a stream fails after emitting bytes', async () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-geoip-'));
    const file = { path: 'GeoIP/failing.mmdb', url: 'https://example.com/failing.mmdb' };
    const outputPath = path.join(outputRoot, file.path);
    const sentinel = Buffer.from('existing-good-mmdb');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, sentinel);

    const stats = await downloadGEOIPFiles(fakeSpan as Span, [file], {
      outputRoot,
      fetchFn: () => Promise.resolve(partialErrorResponse())
    });

    assert.deepEqual(stats, { success: 0, failed: 1, total: 1 });
    assert.deepEqual(fs.readFileSync(outputPath), sentinel);
    assertNoTemporarySiblings(outputPath);
  });

  it('replaces an existing final file with a readable MMDB download', async () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-geoip-'));
    const file = { path: 'GeoIP/valid.mmdb', url: 'https://example.com/valid.mmdb' };
    const outputPath = path.join(outputRoot, file.path);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, 'old-mmdb');

    const stats = await downloadGEOIPFiles(fakeSpan as Span, [file], {
      outputRoot,
      fetchFn: () => Promise.resolve(new Response(validMmdbBytes))
    });

    assert.deepEqual(stats, { success: 1, failed: 0, total: 1 });
    assert.deepEqual(fs.readFileSync(outputPath), validMmdbBytes);
    assertNoTemporarySiblings(outputPath);
  });

  it('rejects an undersized download and preserves an existing final file', async () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-geoip-'));
    const file = { path: 'GeoIP/small.mmdb', url: 'https://example.com/small.mmdb' };
    const outputPath = path.join(outputRoot, file.path);
    const sentinel = Buffer.from('existing-good-mmdb');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, sentinel);

    const stats = await downloadGEOIPFiles(fakeSpan as Span, [file], {
      outputRoot,
      fetchFn: () => Promise.resolve(new Response(Buffer.alloc(1024)))
    });

    assert.deepEqual(stats, { success: 0, failed: 1, total: 1 });
    assert.deepEqual(fs.readFileSync(outputPath), sentinel);
    assertNoTemporarySiblings(outputPath);
  });

  for (const [name, payload] of [
    ['HTML error page', Buffer.from('<!doctype html><html>' + 'Upstream unavailable. '.repeat(4000) + '</html>')],
    ['padding', Buffer.alloc(64 * 1024, 0x5A)],
    ['truncated database', validMmdbBytes.subarray(0, -100)],
    ['invalid tree pointer', Buffer.concat([Buffer.alloc(7, 0xFF), validMmdbBytes.subarray(7)])],
    ['cyclic search tree', Buffer.concat([Buffer.alloc(7), validMmdbBytes.subarray(7)])],
  ] as const) {
    it(`rejects a large ${name} and retains the previous database`, async t => {
      const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-geoip-format-'));
      t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));
      const file = { path: 'GeoIP/test.mmdb', url: 'https://example.com/test.mmdb' };
      const outputPath = path.join(outputRoot, file.path);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, validMmdbBytes);

      const stats = await downloadGEOIPFiles(fakeSpan as Span, [file], {
        outputRoot,
        fetchFn: () => Promise.resolve(new Response(payload)),
      });

      assert.deepEqual(stats, { success: 0, failed: 1, total: 1 });
      assert.deepEqual(fs.readFileSync(outputPath), validMmdbBytes);
      assertNoTemporarySiblings(outputPath);
    });
  }
});

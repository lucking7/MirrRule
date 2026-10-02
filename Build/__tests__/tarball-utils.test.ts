import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import { test } from 'node:test';
import * as tarFs from 'tar-fs';

import { chooseTarballUrl, getTarballBody } from '../lib/tarball-utils';
import { UA_MIRROR } from '../constants/user-agents';

const tarPack = (tarFs as typeof tarFs & { pack: (directory: string) => Readable }).pack;

async function createFixture(tempDir: string): Promise<Buffer> {
  const sourceDir = path.join(tempDir, 'source');
  await fs.mkdir(path.join(sourceDir, 'archive-root'), { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'archive-root', 'example.txt'), 'fixture content\n');

  const chunks: Buffer[] = [];
  await pipeline(
    tarPack(sourceDir),
    zlib.createGzip(),
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    })
  );
  return Buffer.concat(chunks);
}

test('tarball source selection preserves HEAD 304 fallback and rejects HEAD 404', async () => {
  const seen: Array<{ method: string; url: string }> = [];
  const server = createServer((request, response) => {
    seen.push({ method: request.method ?? '', url: request.url ?? '' });
    let statusCode = 200;
    if (request.url === '/not-found') statusCode = 404;
    else if (request.url === '/unchanged') statusCode = 304;
    response.writeHead(statusCode);
    response.end();
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const fallbackStatuses: number[] = [];
    assert.equal(
      await chooseTarballUrl(`${base}/ok`, `${base}/fallback`, status => fallbackStatuses.push(status)),
      `${base}/ok`
    );
    assert.equal(
      await chooseTarballUrl(`${base}/unchanged`, `${base}/fallback`, status => fallbackStatuses.push(status)),
      `${base}/fallback`
    );
    assert.deepEqual(fallbackStatuses, [304]);
    await assert.rejects(
      chooseTarballUrl(`${base}/not-found`, `${base}/fallback`, status => fallbackStatuses.push(status)),
      /HTTP 404/
    );
    assert.deepEqual(fallbackStatuses, [304], 'HEAD 404 must not enter the fallback callback');
    assert.deepEqual(seen, [
      { method: 'HEAD', url: '/ok' },
      { method: 'HEAD', url: '/unchanged' },
      { method: 'HEAD', url: '/not-found' },
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

test('tarball GET preserves headers, non-200 callback, and gzip/tar bytes', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-tarball-'));
  const fixture = await createFixture(tempDir);
  const seen: Array<{ method: string; url: string; userAgent: string; fetchMode: string }> = [];
  const server = createServer((request, response) => {
    seen.push({
      method: request.method ?? '',
      url: request.url ?? '',
      userAgent: String(request.headers['user-agent']),
      fetchMode: String(request.headers['sec-fetch-mode']),
    });
    if (request.url === '/missing') {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/gzip' });
    response.end(fixture);
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const outputDir = path.join(tempDir, 'extracted');

  try {
    for (const userAgent of ['curl/8.12.1', UA_MIRROR]) {
      // eslint-disable-next-line no-await-in-loop -- each profile writes the same extraction directory
      await pipeline(
        getTarballBody(`${base}/archive`, userAgent, status => {
          throw new Error(`unexpected ${status}`);
        }),
        zlib.createGunzip(),
        tarFs.extract(outputDir)
      );
      assert.equal(
        // eslint-disable-next-line no-await-in-loop -- verify bytes before the next profile overwrites them
        await fs.readFile(path.join(outputDir, 'archive-root', 'example.txt'), 'utf8'),
        'fixture content\n'
      );
    }
    await assert.rejects(
      pipeline(getTarballBody(`${base}/missing`, 'curl/8.12.1', status => {
        assert.equal(status, 404);
        throw new Error('entry-specific 404');
      }), zlib.createGunzip(), tarFs.extract(outputDir)),
      /entry-specific 404/
    );
    assert.deepEqual(seen.map(item => item.method), ['GET', 'GET', 'GET']);
    assert.deepEqual(seen.map(item => item.userAgent), ['curl/8.12.1', UA_MIRROR, 'curl/8.12.1']);
    assert.ok(seen.every(item => item.fetchMode === 'same-origin'));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

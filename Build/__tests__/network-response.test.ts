import assert from 'node:assert/strict';
import process from 'node:process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import { buildProxyUrlCandidates } from '../utils/network/proxy';
import { isLikelyHtmlRuleText } from '../utils/network/rule-text-response';

describe('rule text network safeguards', () => {
  it('contains malformed content encodings without an uncaught stream error', { timeout: 30000 }, t => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-encoding-'));
    t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
    const program = String.raw`
      const assert = require('node:assert/strict');
      const net = require('node:net');
      const constantsPath = require.resolve(${JSON.stringify(path.resolve(__dirname, '../constants/dir.ts'))});
      const constants = require(constantsPath);
      require.cache[constantsPath].exports = { ...constants, CACHE_DIR: ${JSON.stringify(cacheDir)} };
      const { $$fetch, dispatcher } = require(${JSON.stringify(path.resolve(__dirname, '../utils/network/fetch-retry.ts'))});
      const server = net.createServer(socket => {
        socket.on('error', () => {});
        socket.once('data', () => socket.end(
          'HTTP/1.1 200 OK\r\nContent-Encoding: gzip, gzip, gzip, gzip, gzip, gzip\r\n'
          + 'Content-Length: 10\r\nConnection: close\r\n\r\n'
        ));
      });
      server.listen(0, '127.0.0.1', async () => {
        await assert.rejects(async () => {
          const response = await $$fetch('http://127.0.0.1:' + server.address().port + '/rules', {
            signal: AbortSignal.timeout(2500),
          });
          await response.text();
        });
        console.log('DOWNLOAD_REJECTED');
        setTimeout(async () => {
          assert.equal(server.listening, true);
          await dispatcher.destroy();
          server.close(() => console.log('PROCESS_SURVIVED'));
        }, 18000);
      });
    `;
    // The old dependency emits an uncaught error after the full 15.5-second retry sequence.
    const result = spawnSync(process.execPath, ['-r', require.resolve('@swc-node/register'), '-e', program], {
      encoding: 'utf8',
      timeout: 25000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DOWNLOAD_REJECTED/);
    assert.match(result.stdout, /PROCESS_SURVIVED/);
  });

  it('can prefer direct rule downloads before proxy fallback', () => {
    const previous = process.env.PROXY_BASE;
    process.env.PROXY_BASE = 'https://proxy.example/?url=';

    try {
      const url = 'https://rule.kelee.one/Loon/Netflix.lsr';
      assert.deepEqual(buildProxyUrlCandidates(url, { preferDirect: true }), [
        url,
        `https://proxy.example/?url=${url}`,
      ]);
      assert.deepEqual(buildProxyUrlCandidates(url), [
        `https://proxy.example/?url=${url}`,
        url,
      ]);
    } finally {
      if (previous === undefined) {
        delete process.env.PROXY_BASE;
      } else {
        process.env.PROXY_BASE = previous;
      }
    }
  });

  it('rejects HTML error pages before they are converted into rules', () => {
    assert.equal(
      isLikelyHtmlRuleText(new Headers({ 'content-type': 'text/html; charset=UTF-8' }), [
        '<html><body>forbidden</body></html>',
      ]),
      true
    );
    assert.equal(
      isLikelyHtmlRuleText(new Headers({ 'content-type': 'application/octet-stream' }), [
        '<link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.7/css/bootstrap.min.css">',
        '<button type="submit" class="btn btn-porkbun">Submit</button>',
      ]),
      true
    );
    assert.equal(
      isLikelyHtmlRuleText(new Headers({ 'content-type': 'application/octet-stream' }), [
        'DOMAIN-SUFFIX,example.com',
        'IP-CIDR,1.2.3.0/24,no-resolve',
      ]),
      false
    );
  });
});

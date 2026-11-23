import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import http from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import process from 'node:process';
import { describe, it } from 'node:test';
import { UA_MIRROR } from '../constants/user-agents';
import { downloadRawFile } from '../integration/mirror-sync/github-api';

interface RecordedRequest {
  url: string,
  headers: IncomingHttpHeaders
}

const VALID_RAW_BODY = '#!name=DNS\n[Rule]\nDOMAIN,example.com,DIRECT\n';

async function withRawServer(
  run: (baseUrl: string, requests: RecordedRequest[]) => Promise<void>
): Promise<void> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((request, response) => {
    requests.push({
      url: request.url ?? '',
      headers: { ...request.headers },
    });

    switch (request.url) {
      case '/ok': {
        response.writeHead(200, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(VALID_RAW_BODY);
        break;
      }
      case '/empty': {
        response.writeHead(200, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end();
        break;
      }
      default: {
        response.writeHead(404, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end('404: Not Found');
      }
    }
  });

  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const previousToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'ghp_test_token_must_not_be_sent';

  try {
    await run(baseUrl, requests);
  } finally {
    if (previousToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = previousToken;
    }

    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

describe('downloadRawFile', () => {
  it('sends the mirror User-Agent without Authorization even when GITHUB_TOKEN is set', async () => {
    const tokenBefore = process.env.GITHUB_TOKEN;

    await withRawServer(async (baseUrl, requests) => {
      assert.equal(process.env.GITHUB_TOKEN, 'ghp_test_token_must_not_be_sent');
      const result = await downloadRawFile(`${baseUrl}/ok`);
      if (!Buffer.isBuffer(result)) {
        assert.fail(`Expected Buffer, got error: ${result.error.message}`);
      }

      assert.equal(result.toString('utf8'), VALID_RAW_BODY);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].headers['user-agent'], UA_MIRROR);
      assert.equal(requests[0].headers.authorization, undefined);
      assert.equal('authorization' in requests[0].headers, false);
    });

    assert.equal(process.env.GITHUB_TOKEN, tokenBefore);
  });

  it('maps HTTP 404 to a non-retryable not-found error without sending Authorization', async () => {
    await withRawServer(async (baseUrl, requests) => {
      const targetUrl = `${baseUrl}/missing`;
      const result = await downloadRawFile(targetUrl);
      if (Buffer.isBuffer(result)) {
        assert.fail('Expected 404 ApiError, got Buffer');
      }

      assert.equal(result.error.type, '404');
      assert.equal(result.error.message, 'File not found on branch');
      assert.equal(result.error.url, targetUrl);
      assert.equal(result.error.canRetry, false);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].headers['user-agent'], UA_MIRROR);
      assert.equal(requests[0].headers.authorization, undefined);
    });
  });

  it('returns an EMPTY_RESPONSE error for an empty response body', async () => {
    await withRawServer(async (baseUrl, requests) => {
      const targetUrl = `${baseUrl}/empty`;
      const result = await downloadRawFile(targetUrl);
      if (Buffer.isBuffer(result)) {
        assert.fail('Expected EMPTY_RESPONSE ApiError, got Buffer');
      }

      assert.equal(result.error.type, 'EMPTY_RESPONSE');
      assert.equal(result.error.message, 'Downloaded file is empty');
      assert.equal(result.error.url, targetUrl);
      assert.equal(result.error.canRetry, false);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].headers['user-agent'], UA_MIRROR);
      assert.equal(requests[0].headers.authorization, undefined);
    });
  });
});

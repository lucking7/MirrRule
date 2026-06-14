import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getTextEncodingFromHeaders } from '../utils/network/charset';

describe('network charset handling', () => {
  it('uses charset from Headers before decoding remote text', () => {
    const headers = new Headers({
      'content-type': 'text/plain; charset=gbk',
    });
    const gbkBytes = Uint8Array.from([214, 208, 206, 196]);

    assert.notEqual(new TextDecoder().decode(gbkBytes), '中文');
    assert.equal(new TextDecoder(getTextEncodingFromHeaders(headers)).decode(gbkBytes), '中文');
  });

  it('normalizes quoted charset labels and falls back to UTF-8', () => {
    assert.equal(
      getTextEncodingFromHeaders({ 'content-type': 'text/plain; charset="gb2312"' }),
      'gbk'
    );
    assert.equal(
      getTextEncodingFromHeaders({ 'content-type': 'text/plain; charset=unknown-encoding' }),
      'utf-8'
    );
    assert.equal(getTextEncodingFromHeaders({}), 'utf-8');
  });
});

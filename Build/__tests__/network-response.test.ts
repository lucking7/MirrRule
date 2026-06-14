import assert from 'node:assert/strict';
import process from 'node:process';
import { describe, it } from 'node:test';

import { buildProxyUrlCandidates } from '../utils/network/proxy';
import { isLikelyHtmlRuleText } from '../utils/network/rule-text-response';

describe('rule text network safeguards', () => {
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

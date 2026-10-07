import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cleanPolicy, cleanPolicyForModule } from '../lib/policy-cleaner';

describe('policy-cleaner', () => {
  it('removes policy groups while retaining supported parameters', () => {
    assert.equal(cleanPolicy('DOMAIN-SUFFIX,example.com,PROXY'), 'DOMAIN-SUFFIX,example.com');
    assert.equal(
      cleanPolicy('IP-CIDR,1.2.3.0/24,REJECT,no-resolve'),
      'IP-CIDR,1.2.3.0/24,no-resolve'
    );
    assert.equal(
      cleanPolicy('DOMAIN,test.com,MyGroup,pre-matching,extended-matching,unexpected'),
      'DOMAIN,test.com,pre-matching,extended-matching'
    );
  });

  it('preserves comments and leaves malformed rules unchanged', () => {
    assert.equal(cleanPolicy('# comment'), '# comment');
    assert.equal(cleanPolicy('// comment'), '// comment');
    assert.equal(cleanPolicy('not-a-rule'), 'not-a-rule');
  });

  it('preserves regex commas while removing only trailing policy fields', () => {
    const patterns = [
      String.raw`^http://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/(adgateway|adv)/`,
      String.raw`^https?://ads\.test/items/\d{1,3}\,promo$`,
      String.raw`^https://ads\.test/[a,b]/(one,two)/?$`
    ];
    for (const pattern of patterns) {
      const rule = `URL-REGEX,${pattern}`;
      assert.equal(cleanPolicy(rule), rule);
      assert.equal(cleanPolicy(`${rule},REJECT`), rule);
      assert.equal(cleanPolicy(`${rule},MyProxy,extended-matching`), `${rule},extended-matching`);
      assert.equal(cleanPolicyForModule(rule), `${rule},REJECT`);
      assert.equal(cleanPolicyForModule(`${rule},REJECT-DROP`), `${rule},REJECT-DROP`);
      assert.equal(cleanPolicyForModule(`${rule},MyProxy,pre-matching`), `${rule},REJECT,pre-matching`);
    }
  });

  it('strips policies from logical rules while retaining allowed parameters', () => {
    assert.equal(
      cleanPolicy('AND,((DOMAIN,foo.com),(DOMAIN-SUFFIX,bar.com)),Proxy,no-resolve'),
      'AND,((DOMAIN,foo.com),(DOMAIN-SUFFIX,bar.com)),no-resolve'
    );
  });

  it('normalizes module policies to built-ins or the default reject policy', () => {
    assert.equal(
      cleanPolicyForModule('DOMAIN-SUFFIX,ad.com,MyProxy'),
      'DOMAIN-SUFFIX,ad.com,REJECT'
    );
    assert.equal(
      cleanPolicyForModule('DOMAIN-SUFFIX,ad.com,REJECT-DROP,no-resolve'),
      'DOMAIN-SUFFIX,ad.com,REJECT-DROP,no-resolve'
    );
    assert.equal(
      cleanPolicyForModule('IP-CIDR,1.2.3.0/24,no-resolve'),
      'IP-CIDR,1.2.3.0/24,REJECT,no-resolve'
    );
  });
});

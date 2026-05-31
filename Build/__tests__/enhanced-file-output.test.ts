import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSpan } from '../trace';
import { EnhancedFileOutput } from '../lib/enhanced-file-output';

function parseSingboxContent(content: string[] | null) {
  assert.ok(content, 'sing-box content should be present');
  return JSON.parse(content.join('\n')) as {
    rules: Array<{
      domain?: string[];
      domain_suffix?: string[];
      domain_keyword?: string[];
      ip_cidr?: string[];
    }>;
  };
}

describe('EnhancedFileOutput', () => {
  it('classifies raw rules and compiles equivalent multi-platform outputs', async () => {
    const output = new EnhancedFileOutput(
      createSpan('test'),
      'sample',
      'mixed',
      ['surge', 'clash', 'singbox', 'loon'],
      null,
      { applyNoResolve: true },
      'out'
    );

    output.addRules([
      'example.com',
      '.example.org',
      'DOMAIN-KEYWORD,video',
      'IP-CIDR,1.2.3.0/24,Proxy',
      'IP-CIDR6,2001:db8::/32',
      'DOMAIN-SUFFIX,policy.test,Proxy,no-resolve',
      '# ignored comment',
    ]);

    const [surge, clash, singbox, loon] = await output.compile();

    assert.ok(surge?.includes('DOMAIN,example.com'));
    assert.ok(surge?.includes('DOMAIN-SUFFIX,example.org'));
    assert.ok(surge?.includes('DOMAIN-KEYWORD,video'));
    assert.ok(surge?.includes('IP-CIDR,1.2.3.0/24,no-resolve'));
    assert.ok(surge?.includes('IP-CIDR6,2001:db8::/32,no-resolve'));
    assert.ok(surge?.includes('DOMAIN-SUFFIX,policy.test'));

    assert.ok(clash?.includes('DOMAIN,example.com'));
    assert.ok(clash?.includes('DOMAIN-SUFFIX,example.org'));
    assert.ok(clash?.includes('DOMAIN-KEYWORD,video'));
    assert.ok(clash?.includes('IP-CIDR,1.2.3.0/24,no-resolve'));

    const singboxJson = parseSingboxContent(singbox);
    assert.deepEqual(singboxJson.rules[0].domain, ['example.com']);
    assert.deepEqual(new Set(singboxJson.rules[0].domain_suffix), new Set(['example.org', 'policy.test']));
    assert.deepEqual(singboxJson.rules[0].domain_keyword, ['video']);
    assert.deepEqual(singboxJson.rules[0].ip_cidr, ['1.2.3.0/24', '2001:db8::/32']);

    assert.ok(loon?.includes('DOMAIN,example.com'));
    assert.ok(loon?.includes('DOMAIN-SUFFIX,example.org'));
    assert.ok(loon?.includes('DOMAIN-KEYWORD,video'));
    assert.ok(loon?.includes('IP-CIDR,1.2.3.0/24,no-resolve'));
  });

  it('keeps explicit policies when a default policy is configured', async () => {
    const output = new EnhancedFileOutput(
      createSpan('test'),
      'sample-policy',
      'mixed',
      ['surge'],
      'Proxy',
      undefined,
      'out'
    );

    output.addRawRule('AND,((DOMAIN,foo.com),(DOMAIN-SUFFIX,bar.com)),Proxy,no-resolve');

    const [surge] = await output.compile();

    assert.deepEqual(surge, [
      'AND,((DOMAIN,foo.com),(DOMAIN-SUFFIX,bar.com)),Proxy,no-resolve',
    ]);
  });
});

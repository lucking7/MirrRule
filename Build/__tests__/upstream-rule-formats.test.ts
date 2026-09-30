import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EnhancedFileOutput } from '../lib/enhanced-file-output';
import { createSpan } from '../trace';

interface SingboxRuleSet {
  rules: Array<{
    domain?: string[];
    ip_cidr?: string[];
  }>;
}

describe('upstream rule formats', () => {
  it('converts numeric-leading domains and bare CIDRs for every platform', async () => {
    const output = new EnhancedFileOutput(
      createSpan('test'),
      'upstream-formats',
      ['surge', 'clash', 'singbox', 'loon'],
      null,
      { applyNoResolve: true },
      'out'
    );

    output.addRules([
      '2mdn.net',
      '0x0.st',
      '192.0.2.0/24',
      '2001:db8::/32',
      'IP-CIDR,198.51.100.0/24,no-resolve',
      'IP-CIDR6,2001:db9::/32,no-resolve',
      '192.0.2.1',
      '2001:db8::1',
      '123456',
      '123.456',
      '192.0.2.0/33',
      '2001:db8::/129',
      'NOT-A-RULE,garbage',
    ]);

    const [surge, clash, singbox, loon] = await output.compile();

    for (const content of [surge, clash, loon]) {
      assert.ok(content);
      assert.ok(content.includes('DOMAIN,2mdn.net'));
      assert.ok(content.includes('DOMAIN,0x0.st'));
      assert.ok(content.includes('IP-CIDR,192.0.2.0/24,no-resolve'));
      assert.ok(content.includes('IP-CIDR6,2001:db8::/32,no-resolve'));
      assert.ok(content.includes('IP-CIDR,198.51.100.0/24,no-resolve'));
      assert.ok(content.includes('IP-CIDR6,2001:db9::/32,no-resolve'));
      assert.equal(content.some(line => line.includes('192.0.2.1')), false);
      assert.equal(content.some(line => line.includes('2001:db8::1')), false);
      assert.equal(content.some(line => line.includes('123456')), false);
      assert.equal(content.some(line => line.includes('123.456')), false);
      assert.equal(content.some(line => line.includes('/33')), false);
      assert.equal(content.some(line => line.includes('/129')), false);
      assert.equal(content.some(line => line.includes('NOT-A-RULE')), false);
    }

    assert.ok(singbox);
    const singboxRuleSet = JSON.parse(singbox.join('\n')) as SingboxRuleSet;
    assert.deepEqual(new Set(singboxRuleSet.rules[0].domain), new Set(['2mdn.net', '0x0.st']));
    assert.deepEqual(
      new Set(singboxRuleSet.rules[0].ip_cidr),
      new Set([
        '192.0.2.0/24',
        '198.51.100.0/24',
        '2001:db8::/32',
        '2001:db9::/32',
      ])
    );

    for (const summary of Object.values(output.getRuleDropSummaries())) {
      assert.equal(summary.malformed, 6);
      assert.deepEqual(summary.unknown, { 'NOT-A-RULE': 1 });
    }
  });
});

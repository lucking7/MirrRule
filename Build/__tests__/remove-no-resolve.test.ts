import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EnhancedFileOutput } from '../lib/enhanced-file-output';
import { specialRules } from '../lib/rule-sources';
import { createSpan } from '../trace';

describe('removeNoResolve', () => {
  it('is enabled for google only among service rules', () => {
    const google = specialRules.find(rule => rule.targetFile === 'List/google.list');
    assert.ok(google);
    assert.equal(google.removeNoResolve, true);
    assert.equal(google.applyNoResolve, undefined);
    const youtube = specialRules.find(rule => rule.targetFile === 'List/youtube.list');
    assert.ok(youtube);
    assert.equal(youtube.applyNoResolve, true);
    assert.equal(youtube.removeNoResolve, undefined);
  });

  it('drops no-resolve from destination IP rules in merged and ip outputs', async () => {
    const output = new EnhancedFileOutput(
      createSpan('remove-no-resolve'), 'remove-no-resolve', ['surge', 'clash'], null,
      { removeNoResolve: true }
    );
    output.addRules([
      'IP-CIDR,198.51.100.0/24,DIRECT,no-resolve',
      'ip-cidr6,2001:db8::/32,no-resolve',
      'IP-ASN,64496,No-Resolve',
      'DOMAIN-SUFFIX,example.com,DIRECT',
    ]);
    const [surge, clash] = await output.compile();
    for (const lines of [surge, clash]) {
      const rules = new Set(lines);
      assert.ok(rules.has('IP-CIDR,198.51.100.0/24'));
      assert.ok(rules.has('IP-CIDR6,2001:db8::/32'));
      assert.ok(rules.has('IP-ASN,64496'));
      assert.ok(rules.has('DOMAIN-SUFFIX,example.com'));
    }
    const ip = output.getVariantContent('surge', 'ip').join('\n');
    assert.match(ip, /^IP-CIDR,198\.51\.100\.0\/24$/m);
    assert.equal(ip.includes('no-resolve'), false);
  });

  it('rejects a configuration that both adds and removes no-resolve', () => {
    assert.throws(
      () => new EnhancedFileOutput(createSpan('conflict'), 'conflict', ['surge'], null, { applyNoResolve: true, removeNoResolve: true }),
      /mutually exclusive/
    );
  });
});

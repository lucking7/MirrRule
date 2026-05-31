import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ClashClassicRuleSet } from '../core/output/writing-strategy/clash';
import { LoonRuleSet } from '../core/output/writing-strategy/loon';
import { SingboxSource } from '../core/output/writing-strategy/singbox';
import { SurgeRuleSet } from '../core/output/writing-strategy/surge';

function parseSingbox(strategy: SingboxSource) {
  assert.ok(strategy.content, 'sing-box content should be present');
  return JSON.parse(strategy.content.join('\n')) as {
    version: number;
    rules: Array<{
      domain?: string[];
      domain_suffix?: string[];
      domain_keyword?: string[];
      domain_regex?: string[];
      ip_cidr?: string[];
    }>;
  };
}

describe('writing strategies', () => {
  it('writes Surge rules in normalized ruleset form', () => {
    const strategy = new SurgeRuleSet('', 'out');

    strategy.writeDomain('example.com');
    strategy.writeDomainSuffix('example.org');
    strategy.writeDomainKeywords(new Set(['video']));
    strategy.writeIpCidrs(['1.2.3.0/24'], true);
    strategy.writeOtherRules(['DOMAIN-SUFFIX,example.net', 'DOMAIN-SUFFIX,policy.test,Proxy,no-resolve']);

    assert.deepEqual(strategy.content, [
      'DOMAIN,example.com',
      'DOMAIN-SUFFIX,example.org',
      'DOMAIN-KEYWORD,video',
      'IP-CIDR,1.2.3.0/24,no-resolve',
      'DOMAIN-SUFFIX,example.net',
      'DOMAIN-SUFFIX,policy.test',
    ]);
  });

  it('writes Clash classic rules and strips policies from passthrough rules', () => {
    const strategy = new ClashClassicRuleSet('', 'out');

    strategy.writeDomain('example.com');
    strategy.writeDomainSuffix('example.org');
    strategy.writeProcessNames(new Set(['Safari']));
    strategy.writeIpCidr6s(['2001:db8::/32'], true);
    strategy.writeOtherRules(['DOMAIN-SUFFIX,policy.test,Proxy,no-resolve']);

    assert.deepEqual(strategy.content, [
      'DOMAIN,example.com',
      'DOMAIN-SUFFIX,example.org',
      'PROCESS-NAME,Safari',
      'IP-CIDR6,2001:db8::/32,no-resolve',
      'DOMAIN-SUFFIX,policy.test,no-resolve',
    ]);
  });

  it('writes Loon rules and omits unsupported wildcard rules', () => {
    const strategy = new LoonRuleSet('', 'out');

    strategy.writeDomain('example.com');
    strategy.writeDomainSuffix('example.org');
    strategy.writeDomainWildcard('*.wild.example');
    strategy.writeUrlRegexes(new Set([String.raw`^https://example\.com/ad`]));
    strategy.writeDestinationPorts(new Set(['443']));

    assert.deepEqual(strategy.content, [
      'DOMAIN,example.com',
      'DOMAIN-SUFFIX,example.org',
      String.raw`URL-REGEX,^https://example\.com/ad`,
      'DEST-PORT,443',
    ]);
  });

  it('writes sing-box JSON rule-set fields', () => {
    const strategy = new SingboxSource('', 'out');

    strategy.writeDomain('example.com');
    strategy.writeDomainSuffix('example.org');
    strategy.writeDomainKeywords(new Set(['video']));
    strategy.writeDomainWildcard('*.wild.example');
    strategy.writeOtherRules(['DOMAIN,other.example', 'IP-CIDR,1.2.3.0/24,no-resolve']);

    const json = parseSingbox(strategy);
    assert.equal(json.version, 2);
    assert.deepEqual(json.rules[0].domain, ['example.com', 'other.example']);
    assert.deepEqual(json.rules[0].domain_suffix, ['example.org']);
    assert.deepEqual(json.rules[0].domain_keyword, ['video']);
    assert.deepEqual(json.rules[0].domain_regex, [String.raw`^[\w.-]*?\.wild\.example$`]);
    assert.deepEqual(json.rules[0].ip_cidr, ['1.2.3.0/24']);
  });
});

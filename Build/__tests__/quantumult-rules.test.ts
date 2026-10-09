import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EnhancedFileOutput } from '../lib/enhanced-file-output';
import { smartConvertRule } from '../lib/misc';
import { cleanPolicy } from '../lib/policy-cleaner';
import { createSpan } from '../trace';

describe('Quantumult X rule aliases', () => {
  it('preserves fmz domain, keyword, and CIDR matches in all four platform outputs', async () => {
    const output = new EnhancedFileOutput(
      createSpan('quantumult-rules'),
      'fmz-sample',
      ['surge', 'clash', 'singbox', 'loon'],
      null,
      { applyNoResolve: true }
    );

    // Actual fmz200/wool_scripts QuantumultX/filter/{filterFix,filter}.list, 2026-10-09.
    output.addRules([
      'host, ad.12306.cn, direct',
      'host-suffix, weather-data.apple.com, direct',
      'host-keyword, anti-ad.net, direct',
      'host-KEYWORD,clk.gentags.net, reject',
      'ip-cidr, 192.168.0.1/24, direct',
      'IP6-CIDR, 2402:db40:5100:1011::5/128, reject',
    ]);

    const [surge, clash, singbox, loon] = await output.compile();
    const expected = new Set([
      'DOMAIN,ad.12306.cn',
      'DOMAIN-SUFFIX,weather-data.apple.com',
      'DOMAIN-KEYWORD,anti-ad.net',
      'DOMAIN-KEYWORD,clk.gentags.net',
      'IP-CIDR,192.168.0.0/24,no-resolve',
      'IP-CIDR6,2402:db40:5100:1011::5/128,no-resolve',
    ]);
    for (const content of [surge, clash, loon]) {
      assert.deepEqual(new Set(content), expected);
    }
    const json = JSON.parse(singbox.join('\n')) as { rules: Array<{
      domain?: string[];
      domain_suffix?: string[];
      domain_keyword?: string[];
      ip_cidr?: string[];
    }> };
    assert.deepEqual(json.rules, [{
      domain: ['ad.12306.cn'],
      domain_suffix: ['weather-data.apple.com'],
      domain_keyword: ['anti-ad.net', 'clk.gentags.net'],
      ip_cidr: ['192.168.0.0/24', '2402:db40:5100:1011::5/128'],
    }]);
    for (const summary of Object.values(output.getRuleDropSummaries())) {
      assert.deepEqual(summary, { unsupported: {}, malformed: 0, unknown: {} });
    }
  });

  it('converts known aliases case-insensitively without consuming policies or options', () => {
    const cases = [
      ['HoSt, Exact.Example, Proxy, pre-matching', 'DOMAIN, Exact.Example, Proxy, pre-matching', 'DOMAIN,Exact.Example,pre-matching'],
      ['HOST-SUFFIX , example.org, DIRECT, extended-matching', 'DOMAIN-SUFFIX, example.org, DIRECT, extended-matching', 'DOMAIN-SUFFIX,example.org,extended-matching'],
      ['host-KEYWORD, ads, REJECT', 'DOMAIN-KEYWORD, ads, REJECT', 'DOMAIN-KEYWORD,ads'],
      ['Ip-CiDr, 192.0.2.0/24, Custom, no-resolve', 'IP-CIDR, 192.0.2.0/24, Custom, no-resolve', 'IP-CIDR,192.0.2.0/24,no-resolve'],
      ['Ip6-CiDr,2001:db8::/32,REJECT,no-resolve', 'IP-CIDR6,2001:db8::/32,REJECT,no-resolve', 'IP-CIDR6,2001:db8::/32,no-resolve'],
    ];
    for (const [input, converted, cleaned] of cases) {
      assert.equal(smartConvertRule(input), converted);
      assert.equal(cleanPolicy(smartConvertRule(input)), cleaned);
    }
  });

  it('leaves unknown aliases and existing canonical or compound comma rules unchanged', () => {
    for (const rule of [
      'host-wildcard,*.example.com,Proxy',
      'HOST-WILDCARD,*.example.com,Proxy',
      'host-suffix-extra,example.com,Proxy',
      'UNKNOWN,example.com,Proxy',
      'DOMAIN,example.com,Proxy,pre-matching',
      'DOMAIN-SUFFIX,example.org',
      'ip-cidr6,2001:db8::/32,no-resolve',
      'AND,((DOMAIN,example.com),(PROTOCOL,UDP)),Proxy',
      String.raw`URL-REGEX,^https://example\.com/[a,b]{1,3},REJECT`,
    ]) {
      assert.equal(smartConvertRule(rule), rule);
    }
  });

  it('keeps alias conversion disabled when formatConversion is false', async () => {
    const output = new EnhancedFileOutput(
      createSpan('quantumult-rules-disabled'),
      'unconverted-sample',
      ['surge', 'clash', 'singbox', 'loon'],
      null,
      { formatConversion: false }
    );
    output.addRules([
      'host,unconverted.example,Proxy',
      'ip6-cidr,2001:db8::/32,DIRECT',
      'DOMAIN,preserved.example,Proxy',
    ]);
    const [surge, clash, singbox, loon] = await output.compile();
    for (const content of [surge, clash, loon]) {
      assert.deepEqual(content, ['DOMAIN,preserved.example']);
    }
    assert.deepEqual(JSON.parse(singbox.join('\n')), {
      version: 2,
      rules: [{ domain: ['preserved.example'], domain_suffix: [] }],
    });
    for (const summary of Object.values(output.getRuleDropSummaries())) {
      assert.deepEqual(summary.unknown, { HOST: 1, 'IP6-CIDR': 1 });
    }
  });
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { EnhancedFileOutput } from '../lib/enhanced-file-output';
import type { RuleProcessingOptions } from '../lib/rule-source-types';
import { createSpan } from '../trace';

const mixedRules = [
  'host,exact-direct.example,direct',
  'HOST-SUFFIX, suffix-direct.example, DIRECT',
  'host-keyword,allow-direct,DiReCt',
  'host-keyword, amp-api.podcasts.apple.com, proxy',
  'host,proxy-only.example,PROXY',
  'host,reject-only.example,reject',
  'IP-CIDR,198.51.100.0/24,direct,no-resolve',
  'IP6-CIDR,2001:db8::/32,DIRECT,no-resolve',
  'host,missing-policy.example',
  'host,empty-policy.example,',
];

async function publish(
  directory: string,
  id: string,
  rules: string[],
  config: RuleProcessingOptions,
) {
  const output = new EnhancedFileOutput(
    createSpan('source-policy-filter'),
    id,
    ['surge', 'clash', 'singbox', 'loon'],
    null,
    config,
    directory,
  ).withTitle('Source policy filter').withDescription(['Source policy publication regression.']);
  output.addRules(rules);
  await output.write();
  const text = [
    fs.readFileSync(path.join(directory, 'List', `${id}.list`), 'utf8'),
    fs.readFileSync(path.join(directory, 'Clash', `${id}.txt`), 'utf8'),
    fs.readFileSync(path.join(directory, 'Loon', `${id}.list`), 'utf8'),
  ];
  const singbox: {
    rules: Array<{
      domain?: string[];
      domain_suffix?: string[];
      domain_keyword?: string[];
      ip_cidr?: string[];
    }>
  } = JSON.parse(fs.readFileSync(path.join(directory, 'sing-box', `${id}.json`), 'utf8'));
  return { output, text, singbox };
}

describe('opt-in source policy filtering', () => {
  it('publishes only DIRECT rules to all four clients before their source policies are removed', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-policy-direct-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const sourcePolicies = ['DiReCt'] as const;
    const { output, text, singbox } = await publish(directory, 'direct', mixedRules, {
      sourcePolicies,
      validate: true,
      applyNoResolve: true,
    });
    assert.equal(output.getOutputSummary().ruleCount, 5);
    assert.deepEqual(sourcePolicies, ['DiReCt']);
    for (const content of text) {
      assert.match(content, /DOMAIN,exact-direct\.example/);
      assert.match(content, /DOMAIN-SUFFIX,suffix-direct\.example/);
      assert.match(content, /DOMAIN-KEYWORD,allow-direct/);
      assert.match(content, /IP-CIDR,198\.51\.100\.0\/24/);
      assert.match(content, /IP-CIDR6,2001:db8::\/32/);
      for (const excluded of [
        'amp-api.podcasts.apple.com', 'proxy-only.example', 'reject-only.example',
        'missing-policy.example', 'empty-policy.example',
      ]) {
        assert.equal(content.includes(excluded), false, excluded);
      }
    }
    assert.deepEqual(singbox.rules.flatMap(rule => rule.domain ?? []), ['exact-direct.example']);
    assert.deepEqual(singbox.rules.flatMap(rule => rule.domain_suffix ?? []), ['suffix-direct.example']);
    assert.deepEqual(singbox.rules.flatMap(rule => rule.domain_keyword ?? []), ['allow-direct']);
    assert.deepEqual(
      new Set(singbox.rules.flatMap(rule => rule.ip_cidr ?? [])),
      new Set(['198.51.100.0/24', '2001:db8::/32']),
    );
    assert.equal(JSON.stringify(singbox).includes('amp-api.podcasts.apple.com'), false);
  });

  it('supports selecting REJECT without leaking the same source DIRECT or PROXY rules', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-policy-reject-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const { output, text, singbox } = await publish(directory, 'reject', mixedRules, {
      sourcePolicies: ['REJECT'],
      validate: true,
    });
    assert.equal(output.getOutputSummary().ruleCount, 1);
    for (const content of text) {
      assert.match(content, /DOMAIN,reject-only\.example/);
      assert.equal(content.includes('exact-direct.example'), false);
      assert.equal(content.includes('amp-api.podcasts.apple.com'), false);
      assert.equal(content.includes('proxy-only.example'), false);
    }
    assert.deepEqual(singbox.rules.flatMap(rule => rule.domain ?? []), ['reject-only.example']);
    assert.equal(singbox.rules.flatMap(rule => rule.domain_keyword ?? []).length, 0);
    assert.equal(singbox.rules.flatMap(rule => rule.ip_cidr ?? []).length, 0);
  });

  it('accepts multiple allowed policies and rejects policyless inputs when opted in', () => {
    const output = new EnhancedFileOutput(createSpan('multiple-source-policies'), 'multiple', ['surge'], null, {
      sourcePolicies: ['direct', 'reject'],
    });
    output.addRules([
      'DOMAIN,direct.example,DIRECT',
      'DOMAIN,reject.example,REJECT',
      'DOMAIN,proxy.example,PROXY',
      'DOMAIN,missing.example',
      'unlabelled.example',
    ]);
    assert.equal(output.getOutputSummary().ruleCount, 2);
  });

  it('treats an explicit empty allowlist as selecting no active rules', () => {
    const output = new EnhancedFileOutput(createSpan('empty-source-policies'), 'empty', ['surge'], null, {
      sourcePolicies: [],
    });
    output.addRules(mixedRules);
    assert.equal(output.getOutputSummary().ruleCount, 0);
  });

  it('preserves unfiltered canonical policies and policyless rules when the option is absent', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-policy-default-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const { output, text, singbox } = await publish(directory, 'unfiltered', [
      'DOMAIN,direct.example,DIRECT',
      'DOMAIN,reject.example,REJECT',
      'DOMAIN-KEYWORD,amp-api.podcasts.apple.com,PROXY',
      'DOMAIN,policyless.example',
    ], { validate: true });
    assert.equal(output.getOutputSummary().ruleCount, 4);
    for (const content of text) {
      assert.match(content, /DOMAIN,direct\.example/);
      assert.match(content, /DOMAIN,reject\.example/);
      assert.match(content, /DOMAIN,policyless\.example/);
      assert.match(content, /DOMAIN-KEYWORD,amp-api\.podcasts\.apple\.com/);
    }
    assert.deepEqual(
      new Set(singbox.rules.flatMap(rule => rule.domain ?? [])),
      new Set(['direct.example', 'reject.example', 'policyless.example']),
    );
    assert.deepEqual(singbox.rules.flatMap(rule => rule.domain_keyword ?? []), ['amp-api.podcasts.apple.com']);
  });
});

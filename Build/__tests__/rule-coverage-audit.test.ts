import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { auditRuleCoverage } from '../lib/rule-coverage-audit';
import { createRuleCoverageReport, exampleRoutingOrder, readProfileSubscriptions } from '../audit-rule-coverage';

function source(id: string, policy: string, content: string) {
  return { id, policy, lines: content.split('\n') };
}

describe('cross-subscription domain coverage', () => {
  it('detects AppleAI fully shadowed by a previous aggregate AI subscription', () => {
    const report = auditRuleCoverage([
      source('ai', 'Proxy', 'DOMAIN-SUFFIX,apple.com\nDOMAIN,chatgpt.com'),
      source('apple_ai', 'AppleAI', 'DOMAIN,guzzoni.apple.com\nDOMAIN-SUFFIX,smoot.apple.com'),
    ]);
    assert.equal(report.subscriptions[1].fullyShadowedSubscription, true);
    assert.equal(report.subscriptions[1].differentPolicyConflicts, 2);
    assert.equal(report.subscriptions[1].examples[0].earlier[0].subscription, 'ai');
  });

  it('audits the five extended AppleAI hostname conditions without claiming unproven Host/SNI coverage', () => {
    const hosts = ['apple-relay.apple.com', 'apple-relay.cloudflare.com', 'apple-relay.fastly-edge.com', 'apple-relay.mask.apple-dns.net', 'cp4.cloudflare.com'];
    const report = auditRuleCoverage([
      source('ai', 'AI', hosts.map(host => `DOMAIN,${host},extended-matching`).join('\n')),
      source('apple_ai', 'AppleAI', hosts.map(host => `DOMAIN,${host}`).join('\n')),
      source('extended_later', 'AppleAI', hosts.map(host => `DOMAIN,${host},extended-matching`).join('\n')),
    ]);
    assert.equal(report.subscriptions[1].fullyCoveredDomainRules, 5);
    assert.equal(report.subscriptions[1].fullyShadowedSubscription, true);
    assert.equal(report.subscriptions[2].fullyCoveredDomainRules, 5);
    assert.equal(report.subscriptions[2].fullyShadowedSubscription, false);
  });

  it('counts unknown matching modifiers as unsupported conditions', () => {
    const report = auditRuleCoverage([source('unknown', 'AI', 'DOMAIN,example.com,unknown-matching')]);
    assert.equal(report.subscriptions[0].domainRules, 0);
    assert.equal(report.subscriptions[0].unsupportedRules, 1);
  });

  it('respects suffix label boundaries and normalizes case and a trailing root dot', () => {
    const report = auditRuleCoverage([
      source('first', 'DIRECT', 'DOMAIN-SUFFIX,Example.COM'),
      source('later', 'DIRECT', 'DOMAIN,EXAMPLE.COM.\nDOMAIN,a.example.com\nDOMAIN,badexample.com'),
    ]);
    assert.equal(report.subscriptions[1].samePolicyRedundancies, 2);
    assert.equal(report.subscriptions[1].fullyShadowedDomains, false);
  });

  it('uses the earliest matching subscription rather than the most specific suffix', () => {
    const report = auditRuleCoverage([
      source('specific', 'A', 'DOMAIN,api.example.com'),
      source('broad', 'B', 'DOMAIN-SUFFIX,example.com'),
      source('later', 'A', 'DOMAIN,api.example.com\nDOMAIN,www.example.com'),
    ]);
    assert.equal(report.subscriptions[1].partlyOverlappingDomainRules, 1);
    assert.equal(report.subscriptions[2].samePolicyRedundancies, 1);
    assert.equal(report.subscriptions[2].differentPolicyConflicts, 1);
    assert.equal(report.subscriptions[2].examples[0].earlier[0].subscription, 'specific');
  });

  it('distinguishes an earlier exact exception inside a covered suffix from uniform redundancy', () => {
    const report = auditRuleCoverage([
      source('exception', 'A', 'DOMAIN,api.example.com'),
      source('broad', 'B', 'DOMAIN-SUFFIX,example.com'),
      source('later', 'B', 'DOMAIN-SUFFIX,example.com'),
    ]);
    assert.equal(report.subscriptions[2].fullyShadowedSubscription, true);
    assert.equal(report.subscriptions[2].samePolicyRedundancies, 0);
    assert.equal(report.subscriptions[2].differentPolicyConflicts, 1);
    assert.equal(report.subscriptions[2].examples[0].relation, 'mixed-policy');
  });

  it('keeps unsupported conditions from claiming a whole subscription is shadowed', () => {
    const report = auditRuleCoverage([
      source('first', 'A', 'DOMAIN-SUFFIX,example.com'),
      source('mixed', 'B', 'DOMAIN,www.example.com\nIP-CIDR,1.2.3.0/24\nDOMAIN-KEYWORD,example'),
    ]);
    assert.equal(report.subscriptions[1].fullyShadowedDomains, true);
    assert.equal(report.subscriptions[1].fullyShadowedSubscription, false);
    assert.equal(report.subscriptions[1].unsupportedTypes['IP-CIDR'], 1);
  });

  it('warns on conditional UA/process rules without treating them as domain coverage', () => {
    const report = auditRuleCoverage([
      source('wechat', 'DIRECT', 'USER-AGENT,WeChat*\nOR,((USER-AGENT,MicroMessenger*),(PROCESS-NAME,WeChat))'),
      source('ai', 'Proxy', 'DOMAIN,chatgpt.com'),
    ]);
    assert.equal(report.conditionalWarnings.length, 3);
    assert.equal(report.subscriptions[1].fullyCoveredDomainRules, 0);
  });

  it('keeps counts independent of the bounded example list', () => {
    const report = auditRuleCoverage([
      source('first', 'A', 'DOMAIN-SUFFIX,example.com'),
      source('later', 'A', 'DOMAIN,a.example.com\nDOMAIN,b.example.com\nDOMAIN,c.example.com'),
    ], { exampleLimit: 1 });
    assert.equal(report.subscriptions[1].fullyCoveredDomainRules, 3);
    assert.equal(report.subscriptions[1].examples.length, 1);
  });

  it('does not index pre-matching conditions as ordinary first-match coverage', () => {
    const report = auditRuleCoverage([
      source('first', 'A', 'DOMAIN-SUFFIX,example.com,pre-matching'),
      source('later', 'A', 'DOMAIN,a.example.com'),
    ]);
    assert.equal(report.subscriptions[0].unsupportedTypes['DOMAIN-SUFFIX'], 1);
    assert.equal(report.subscriptions[1].fullyCoveredDomainRules, 0);
  });

  it('places AppleAI before AI and CDN before broad Google and Amazon subscriptions in the example', () => {
    const files = exampleRoutingOrder.map(([file]) => file);
    assert.ok(files.indexOf('apple_intelligence.list') < files.indexOf('ai.list'));
    assert.ok(files.indexOf('cdn.list') < files.indexOf('google.list'));
    assert.ok(files.indexOf('cdn.list') < files.indexOf('amazon.list'));
    assert.ok(files.includes('wechat_no_ua.list'));
    assert.ok(!files.includes('emby.list'));
  });
});

describe('coverage CLI and profile input', () => {
  it('loads only [Rule], resolves local files and reports gaps without exposing profile secrets', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-audit-'));
    try {
      const profile = path.join(directory, 'profile.conf');
      await fs.writeFile(path.join(directory, 'ai.list'), 'DOMAIN,chatgpt.com\n');
      await fs.writeFile(path.join(directory, 'local.list'), 'DOMAIN,chatgpt.com\n');
      await fs.writeFile(profile, '[Proxy]\nsecret=token-password\n[Rule]\nRULE-SET,https://nrrule.pages.dev/List/ai.list,AI\nRULE-SET,local.list,DIRECT\nRULE-SET,https://example.com/private?secret=token-password,DIRECT\nRULE-SET,missing.list,DIRECT\n[Host]\nsecret=token-password\n');
      const report = await createRuleCoverageReport({ profilePath: profile, rulesDir: directory });
      assert.equal(report.subscriptions.filter(item => item.status === 'audited').length, 2);
      assert.equal(report.subscriptions[1].differentPolicyConflicts, 1);
      assert.equal(report.summary.skippedSubscriptions, 2);
      assert.ok(!JSON.stringify(report).includes('token-password'));
      const output = path.join(directory, 'report.json');
      const result = spawnSync(process.execPath, ['-r', '@swc-node/register', 'Build/audit-rule-coverage.ts', '--profile', profile, '--rules-dir', directory, '--output', output], {
        cwd: process.cwd(), env: { ...process.env, SWC_NODE_IGNORE_DYNAMIC: 'true' }, encoding: 'utf8',
      });
      assert.equal(result.status, 1, result.stderr);
      assert.ok(!result.stdout.includes('token-password'));
      assert.equal(JSON.parse(await fs.readFile(output, 'utf8')).subscriptions[1].differentPolicyConflicts, 1);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('skips pre-matching inline rules and subscriptions without indexing them', async () => {
    const subscriptions = await readProfileSubscriptions('[Rule]\nDOMAIN-SUFFIX,example.com,DIRECT,pre-matching\nRULE-SET,missing.list,DIRECT,pre-matching\nDOMAIN,api.example.com,Proxy\n', '.', '.');
    const report = auditRuleCoverage(subscriptions, { basis: 'profile-rule-section' });
    assert.equal(report.summary.skippedSubscriptions, 2);
    assert.equal(report.subscriptions[2].fullyCoveredDomainRules, 0);
  });

  it('retains outer extended-matching without falsely claiming full subscription shadow', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-extended-'));
    try {
      await fs.writeFile(path.join(directory, 'first.list'), 'DOMAIN,example.com\n');
      await fs.writeFile(path.join(directory, 'later.list'), 'DOMAIN,example.com\n');
      const subscriptions = await readProfileSubscriptions('[Rule]\nRULE-SET,first.list,AI\nRULE-SET,later.list,AI,extended-matching\n', directory, directory);
      const report = auditRuleCoverage(subscriptions);
      assert.equal(report.subscriptions[1].fullyShadowedDomains, true);
      assert.equal(report.subscriptions[1].fullyShadowedSubscription, false);
      assert.equal(report.subscriptions[1].extendedMatching, true);
      const profile = path.join(directory, 'profile.conf');
      await fs.writeFile(profile, '[Rule]\nRULE-SET,first.list,AI\nRULE-SET,later.list,AI,extended-matching\n');
      const result = spawnSync(process.execPath, ['-r', '@swc-node/register', 'Build/audit-rule-coverage.ts', '--profile', profile, '--rules-dir', directory, '--output', path.join(directory, 'report.json'), '--fail-on-full-shadow'], {
        cwd: process.cwd(), env: { ...process.env, SWC_NODE_IGNORE_DYNAMIC: 'true' }, encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('fails clearly on invalid CLI options', () => {
    const result = spawnSync(process.execPath, ['-r', '@swc-node/register', 'Build/audit-rule-coverage.ts', '--unknown'], {
      cwd: process.cwd(), env: { ...process.env, SWC_NODE_IGNORE_DYNAMIC: 'true' }, encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown option or missing option value/);
  });
});

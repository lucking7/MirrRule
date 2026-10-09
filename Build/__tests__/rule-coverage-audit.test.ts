import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { auditRuleCoverage } from '../lib/rule-coverage-audit';
import { createRuleCoverageReport, exampleRoutingOrder, readProfileSubscriptions } from '../audit-rule-coverage';

describe('cross-subscription domain coverage', () => {
  it('detects AppleAI fully shadowed by a previous aggregate AI subscription', () => {
    const report = auditRuleCoverage([
      { id: 'ai', policy: 'Proxy', lines: 'DOMAIN-SUFFIX,apple.com\nDOMAIN,chatgpt.com'.split('\n') },
      { id: 'apple_ai', policy: 'AppleAI', lines: 'DOMAIN,guzzoni.apple.com\nDOMAIN-SUFFIX,smoot.apple.com'.split('\n') },
    ]);
    assert.equal(report.subscriptions[1].fullyShadowedSubscription, true);
    assert.equal(report.subscriptions[1].differentPolicyConflicts, 2);
    assert.equal(report.subscriptions[1].examples[0].earlier[0].subscription, 'ai');
  });

  it('respects suffix label boundaries and normalizes case and a trailing root dot', () => {
    const report = auditRuleCoverage([
      { id: 'first', policy: 'DIRECT', lines: 'DOMAIN-SUFFIX,Example.COM'.split('\n') },
      { id: 'later', policy: 'DIRECT', lines: 'DOMAIN,EXAMPLE.COM.\nDOMAIN,a.example.com\nDOMAIN,badexample.com'.split('\n') },
    ]);
    assert.equal(report.subscriptions[1].samePolicyRedundancies, 2);
    assert.equal(report.subscriptions[1].fullyShadowedDomains, false);
  });

  it('uses the earliest matching subscription rather than the most specific suffix', () => {
    const report = auditRuleCoverage([
      { id: 'specific', policy: 'A', lines: 'DOMAIN,api.example.com'.split('\n') },
      { id: 'broad', policy: 'B', lines: 'DOMAIN-SUFFIX,example.com'.split('\n') },
      { id: 'later', policy: 'A', lines: 'DOMAIN,api.example.com\nDOMAIN,www.example.com'.split('\n') },
    ]);
    assert.equal(report.subscriptions[1].partlyOverlappingDomainRules, 1);
    assert.equal(report.subscriptions[2].samePolicyRedundancies, 1);
    assert.equal(report.subscriptions[2].differentPolicyConflicts, 1);
    assert.equal(report.subscriptions[2].examples[0].earlier[0].subscription, 'specific');
  });

  it('distinguishes an earlier exact exception inside a fully covered suffix from uniform redundancy', () => {
    const report = auditRuleCoverage([
      { id: 'exception', policy: 'A', lines: 'DOMAIN,api.example.com'.split('\n') },
      { id: 'broad', policy: 'B', lines: 'DOMAIN-SUFFIX,example.com'.split('\n') },
      { id: 'later', policy: 'B', lines: 'DOMAIN-SUFFIX,example.com'.split('\n') },
    ]);
    assert.equal(report.subscriptions[2].fullyShadowedSubscription, true);
    assert.equal(report.subscriptions[2].samePolicyRedundancies, 0);
    assert.equal(report.subscriptions[2].differentPolicyConflicts, 1);
    assert.equal(report.subscriptions[2].examples[0].relation, 'mixed-policy');
  });

  it('keeps unsupported conditions from claiming a whole subscription is shadowed', () => {
    const report = auditRuleCoverage([
      { id: 'first', policy: 'A', lines: 'DOMAIN-SUFFIX,example.com'.split('\n') },
      { id: 'mixed', policy: 'B', lines: 'DOMAIN,www.example.com\nIP-CIDR,1.2.3.0/24\nDOMAIN-KEYWORD,example'.split('\n') },
    ]);
    assert.equal(report.subscriptions[1].fullyShadowedDomains, true);
    assert.equal(report.subscriptions[1].fullyShadowedSubscription, false);
    assert.equal(report.subscriptions[1].unsupportedTypes['IP-CIDR'], 1);
  });

  it('warns on conditional UA/process rules without treating them as domain coverage', () => {
    const report = auditRuleCoverage([
      { id: 'wechat', policy: 'DIRECT', lines: 'USER-AGENT,WeChat*\nOR,((USER-AGENT,MicroMessenger*),(PROCESS-NAME,WeChat))'.split('\n') },
      { id: 'ai', policy: 'Proxy', lines: 'DOMAIN,chatgpt.com'.split('\n') },
    ]);
    assert.equal(report.summary.conditionalWarnings, 3);
    assert.equal(report.conditionalWarnings.length, 3);
    assert.equal(report.subscriptions[1].fullyCoveredDomainRules, 0);
  });

  it('ignores internal duplicates and bounds examples independently of counts', () => {
    const report = auditRuleCoverage([
      { id: 'first', policy: 'A', lines: 'DOMAIN-SUFFIX,example.com\nDOMAIN-SUFFIX,example.com'.split('\n') },
      { id: 'later', policy: 'A', lines: 'DOMAIN,a.example.com\nDOMAIN,b.example.com\nDOMAIN,c.example.com'.split('\n') },
    ], { exampleLimit: 1 });
    assert.equal(report.subscriptions[0].fullyCoveredDomainRules, 0);
    assert.equal(report.subscriptions[1].fullyCoveredDomainRules, 3);
    assert.equal(report.subscriptions[1].examples.length, 1);
  });

  it('does not index pre-matching conditions as ordinary first-match coverage', () => {
    const report = auditRuleCoverage([
      { id: 'first', policy: 'A', lines: 'DOMAIN-SUFFIX,example.com,pre-matching'.split('\n') },
      { id: 'later', policy: 'A', lines: 'DOMAIN,a.example.com'.split('\n') },
    ]);
    assert.equal(report.subscriptions[0].unsupportedTypes['DOMAIN-SUFFIX'], 1);
    assert.equal(report.subscriptions[1].fullyCoveredDomainRules, 0);
  });

  it('places AppleAI before AI and CDN before broad Google and Amazon subscriptions in the example', () => {
    const files = exampleRoutingOrder.map(([file]) => file);
    assert.ok(files.indexOf('apple_intelligence.list') < files.indexOf('ai.list'));
    assert.ok(files.indexOf('cdn.list') < files.indexOf('google.list'));
    assert.ok(files.indexOf('cdn.list') < files.indexOf('amazon.list'));
  });

  it('recognizes real AppleAI conditions when the earlier aggregate uses extended matching', () => {
    const domains = ['apple-relay.fastly-edge.com', 'apple-relay.cloudflare.com', 'cp4.cloudflare.com', 'apple-relay.apple.com', 'gspe1-ssl.ls.apple.com'];
    const report = auditRuleCoverage([
      { id: 'ai', policy: 'AI', lines: domains.map(domain => `DOMAIN-SUFFIX,${domain},extended-matching`) },
      { id: 'apple', policy: 'AppleAI', lines: domains.map(domain => `DOMAIN-SUFFIX,${domain}`) }
    ]);
    assert.equal(report.subscriptions[0].domainRules, 5);
    assert.equal(report.subscriptions[0].unsupportedRules, 0);
    assert.equal(report.subscriptions[1].fullyCoveredDomainRules, 5);
    assert.equal(report.subscriptions[1].fullyShadowedSubscription, true);
  });

  it('does not claim plain conditions fully shadow an extended subscription', () => {
    const report = auditRuleCoverage([
      { id: 'plain', policy: 'AI', lines: ['DOMAIN-SUFFIX,example.com'] },
      { id: 'extended', policy: 'AppleAI', lines: ['DOMAIN,a.example.com', 'DOMAIN,b.example.com,extended-matching'] }
    ]);
    assert.equal(report.subscriptions[1].domainRules, 2);
    assert.equal(report.subscriptions[1].fullyCoveredDomainRules, 0);
    assert.equal(report.subscriptions[1].partlyOverlappingDomainRules, 2);
    assert.equal(report.subscriptions[1].fullyShadowedSubscription, false);
  });

  it('indexes the uncovered extended region even when its plain region is covered', () => {
    const report = auditRuleCoverage([
      { id: 'plain', policy: 'A', lines: ['DOMAIN,a.example.com'] },
      { id: 'extended', policy: 'B', lines: ['DOMAIN,a.example.com,extended-matching'] },
      { id: 'later', policy: 'B', extendedMatching: true, lines: ['DOMAIN,a.example.com'] }
    ]);
    assert.equal(report.subscriptions[2].fullyCoveredDomainRules, 1);
    assert.equal(report.subscriptions[2].samePolicyRedundancies, 0);
    assert.equal(report.subscriptions[2].examples[0].relation, 'mixed-policy');
  });

  it('honors keyword and wildcard extended flags across the entire subscription', () => {
    for (const type of ['DOMAIN-KEYWORD', 'DOMAIN-WILDCARD']) {
      const report = auditRuleCoverage([
        { id: 'plain', policy: 'A', lines: ['DOMAIN,api.example.com'] },
        { id: 'expanded', policy: 'B', lines: ['DOMAIN,api.example.com', `${type},other,extended-matching`] }
      ]);
      assert.equal(report.subscriptions[1].domainRules, 1);
      assert.equal(report.subscriptions[1].unsupportedRules, 1);
      assert.equal(report.subscriptions[1].fullyCoveredDomainRules, 0);
      assert.equal(report.subscriptions[1].partlyOverlappingDomainRules, 1);
    }
  });
});

describe('coverage CLI and profile input', () => {
  it('loads only [Rule], resolves local files and reports missing subscriptions without exposing secrets', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-audit-'));
    try {
      const profile = path.join(directory, 'profile.conf');
      await fs.writeFile(path.join(directory, 'ai.list'), 'DOMAIN,chatgpt.com\n');
      await fs.writeFile(path.join(directory, 'local.list'), 'DOMAIN,chatgpt.com\n');
      await fs.writeFile(profile, '[Proxy]\nsecret=token-password\n[Rule]\nRULE-SET,https://nrrule.pages.dev/List/ai.list,AI\nRULE-SET,local.list,DIRECT\nRULE-SET,https://example.com/private?secret=token-password,DIRECT\nRULE-SET,missing.list,DIRECT\n[Host]\nsecret=token-password\n');
      const report = await createRuleCoverageReport({ profilePath: profile, rulesDir: directory });
      assert.equal(report.subscriptions.length, 4);
      assert.equal(report.subscriptions[1].differentPolicyConflicts, 1);
      assert.equal(report.summary.skippedSubscriptions, 2);
      assert.equal(report.summary.missingLocalSubscriptions, 1);
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

  it('fails clearly on invalid CLI options', () => {
    const result = spawnSync(process.execPath, ['-r', '@swc-node/register', 'Build/audit-rule-coverage.ts', '--unknown'], {
      cwd: process.cwd(), env: { ...process.env, SWC_NODE_IGNORE_DYNAMIC: 'true' }, encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown option or missing option value/);
  });

  it('parses quoted local paths and compound commas, and respects outer extended matching', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-path-'));
    try {
      await fs.writeFile(path.join(directory, 'with spaces,list.list'), 'DOMAIN-SUFFIX,example.com\n');
      const subscriptions = await readProfileSubscriptions('[Rule]\nRULE-SET,"with spaces,list.list",A,extended-matching\nOR,((USER-AGENT,WeChat*),(PROCESS-NAME,WeChat)),DIRECT\nDOMAIN,www.example.com,B\n', directory, directory);
      assert.equal(subscriptions.length, 3);
      assert.equal(subscriptions[0].extendedMatching, true);
      const report = auditRuleCoverage(subscriptions, { basis: 'profile-rule-section' });
      assert.equal(report.subscriptions[2].fullyCoveredDomainRules, 1);
      assert.equal(report.subscriptions[2].differentPolicyConflicts, 1);
      assert.equal(report.summary.conditionalWarnings, 2);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('exits 2 for strict full shadow while default mode produces a report', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-strict-'));
    try {
      const profile = path.join(directory, 'profile.conf');
      const output = path.join(directory, 'report.json');
      await fs.writeFile(path.join(directory, 'a.list'), 'DOMAIN-SUFFIX,example.com\n');
      await fs.writeFile(path.join(directory, 'b.list'), 'DOMAIN,a.example.com\n');
      await fs.writeFile(profile, '[Rule]\nRULE-SET,a.list,A\nRULE-SET,b.list,B\n');
      const args = ['-r', '@swc-node/register', 'Build/audit-rule-coverage.ts', '--profile', profile, '--rules-dir', directory, '--output', output];
      const environment = { cwd: process.cwd(), env: { ...process.env, SWC_NODE_IGNORE_DYNAMIC: 'true' }, encoding: 'utf8' as const };
      assert.equal(spawnSync(process.execPath, args, environment).status, 0);
      const separatorArgs = [...args.slice(0, 3), '--', ...args.slice(3)];
      assert.equal(spawnSync(process.execPath, separatorArgs, environment).status, 0);
      assert.equal(spawnSync(process.execPath, [...args, '--fail-on-full-shadow'], environment).status, 2);
      assert.equal(JSON.parse(await fs.readFile(output, 'utf8')).summary.fullyShadowedSubscriptions, 1);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a profile without a [Rule] section instead of implying a clean audit', async () => {
    await assert.rejects(readProfileSubscriptions('[Proxy]\nsecret=private\n', '/tmp', '/tmp'), /no \[Rule\] section/);
  });

  it('keeps inline extended matching flags when removing outer policies', async () => {
    const subscriptions = await readProfileSubscriptions('[Rule]\nDOMAIN,api.example.com,A\nDOMAIN,api.example.com,B,extended-matching\n', '/tmp', '/tmp');
    const report = auditRuleCoverage(subscriptions, { basis: 'profile-rule-section' });
    assert.equal(subscriptions[1].extendedMatching, true);
    assert.equal(report.subscriptions[1].fullyCoveredDomainRules, 0);
    assert.equal(report.subscriptions[1].partlyOverlappingDomainRules, 1);
    assert.equal(report.subscriptions[1].fullyShadowedSubscription, false);
  });

  it('keeps unrecognized outer options as gaps and honors case-insensitive matching modifiers', async () => {
    const subscriptions = await readProfileSubscriptions('[Rule]\nDOMAIN-SUFFIX,example.com,A,unknown-condition\nDOMAIN,api.example.com,B,Extended-Matching\n', '/tmp', '/tmp');
    assert.equal(subscriptions[0].skipped, 'unsupported-options');
    assert.equal(subscriptions[1].extendedMatching, true);
    const report = auditRuleCoverage(subscriptions);
    assert.equal(report.summary.skippedSubscriptions, 1);
    assert.equal(report.subscriptions[1].fullyShadowedSubscription, false);
    const caseReport = auditRuleCoverage([
      { id: 'first', policy: 'A', lines: ['domain-suffix,example.com,Extended-Matching'] },
      { id: 'later', policy: 'B', extendedMatching: true, lines: ['DOMAIN,api.example.com'] }
    ]);
    assert.equal(caseReport.subscriptions[1].fullyShadowedSubscription, true);
  });
});

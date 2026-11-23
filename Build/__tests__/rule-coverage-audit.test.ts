import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { auditRuleCoverage, domainSetLineToRule } from '../lib/rule-coverage-audit';
import { createRuleCoverageReport, exampleRoutingOrder, loadVariantAvailability, readProfileSubscriptions, resolveNrruleSurgeReference, runCoverageAuditCli } from '../audit-rule-coverage';

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
    assert.ok(files.indexOf('apple_intelligence') < files.indexOf('ai'));
    assert.ok(files.indexOf('cdn') < files.indexOf('google'));
    assert.ok(files.indexOf('cdn') < files.indexOf('amazon'));
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
      await fs.mkdir(path.join(directory, 'non_ip'));
      await fs.writeFile(path.join(directory, 'non_ip', 'ai.conf'), 'DOMAIN,chatgpt.com\n');
      await fs.writeFile(path.join(directory, 'local.list'), 'DOMAIN,chatgpt.com\n');
      await fs.writeFile(profile, '[Proxy]\nsecret=token-password\n[Rule]\nRULE-SET,https://nrrule.pages.dev/List/non_ip/ai.conf,AI\nRULE-SET,local.list,DIRECT\nRULE-SET,https://example.com/private?secret=token-password,DIRECT\nRULE-SET,missing.list,DIRECT\n[Host]\nsecret=token-password\n');
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

  it('rejects flat NRRule paths and maps split paths to the matching local files and formats', () => {
    const rulesDir = '/tmp/public/List';
    const merged = resolveNrruleSurgeReference('/List/apple_cdn.list', 'rule-set', rulesDir);
    assert.equal(merged.label, 'apple_cdn.list');
    assert.equal(merged.skipped, 'retired-subscription');
    assert.match(merged.notCoveredReason ?? '', /List\/non_ip\/ and List\/ip\//);
    assert.equal(resolveNrruleSurgeReference('/List/non_ip/microsoft_cdn.list', 'rule-set', rulesDir).filename, path.join(rulesDir, 'non_ip', 'microsoft_cdn.list'));
    assert.equal(resolveNrruleSurgeReference('/List/ip/telegram.list', 'rule-set', rulesDir).variant, 'ip');
    assert.equal(resolveNrruleSurgeReference('/List/non_ip/apple_cdn.list', 'domain-set', rulesDir).skipped, 'format-mismatch');
    assert.equal(resolveNrruleSurgeReference('/List/apple_cdn.list', 'domain-set', rulesDir).skipped, 'retired-subscription');
    assert.equal(resolveNrruleSurgeReference('/List/ip/telegram.conf', 'rule-set', rulesDir).filename, path.join(rulesDir, 'ip', 'telegram.conf'));
    assert.equal(resolveNrruleSurgeReference('/List/domainset/apple_cdn.conf', 'rule-set', rulesDir).skipped, 'format-mismatch');
    for (const unresolved of ['/List/apple.conf', '/List/other/apple_cdn.list', '/List/a/b/c.list', '/Clash/apple_cdn.txt']) {
      const resolved = resolveNrruleSurgeReference(unresolved, 'rule-set', rulesDir);
      assert.equal(resolved.skipped, 'unavailable-remote');
      assert.equal(resolved.filename, undefined);
    }
  });

  it('reports retired split rulesets and recommends their registry replacements', async () => {
    const profile = [
      '[Rule]',
      'RULE-SET,https://nrrule.pages.dev/List/non_ip/streaming_%21cn.conf,DIRECT',
      'OR,((RULE-SET,https://nrrule.pages.dev/List/ip/streaming_!cn.list),(DOMAIN,example.com)),DIRECT',
      'RULE-SET,https://nrrule.pages.dev/List/streaming_!cn.list,DIRECT',
      'RULE-SET,https://nrrule.pages.dev/List/non_ip/container.conf,DIRECT',
    ].join('\n');
    const report = auditRuleCoverage(await readProfileSubscriptions(profile, '/tmp', '/tmp'));
    assert.equal(report.summary.retiredSubscriptions, 4);
    assert.match(report.subscriptions[0].notCoveredReason ?? '', /<platform>\/stream/);
    assert.match(report.subscriptions[1].notCoveredReason ?? '', /<platform>\/stream/);
    assert.match(report.subscriptions[2].notCoveredReason ?? '', /<platform>\/stream/);
    assert.doesNotMatch(report.subscriptions[3].notCoveredReason ?? '', /replacement/);
    assert.equal(resolveNrruleSurgeReference('/List/non_ip/speedtest_china.list', 'rule-set', '/tmp').skipped, undefined);
  });

  it('fails on retired profile references even if old files and an old audit are present', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-retired-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const list = path.join(root, 'List');
    const auditPath = path.join(root, 'audit.json');
    const output = path.join(root, 'coverage.json');
    const profile = path.join(root, 'profile.conf');
    await fs.mkdir(list);
    await fs.writeFile(path.join(list, 'ai.list'), 'DOMAIN,chatgpt.com\n');
    await fs.writeFile(auditPath, JSON.stringify({ rulesets: [{ id: 'ai', outputs: [
      { platform: 'surge', variant: 'merged', status: 'published', path: 'List/ai.list' },
    ] }] }));
    await fs.writeFile(profile, [
      '[Rule]',
      'RULE-SET,https://nrrule.pages.dev/List/ai.list,AI,pre-matching',
      'OR,((RULE-SET,https://nrrule.pages.dev/List/old%2Elist)),AI',
      'RULE-SET,https://example.com/List/ai.list,AI',
    ].join('\n'));
    assert.equal(await runCoverageAuditCli(['--profile', profile, '--rules-dir', list, '--output-audit', auditPath, '--output', output]), 1);
    const report = JSON.parse(await fs.readFile(output, 'utf8'));
    assert.equal(report.summary.retiredSubscriptions, 2);
    assert.equal(report.summary.auditedSubscriptions, 0);
    assert.equal(report.summary.missingLocalSubscriptions, 0);
    assert.deepEqual(report.subscriptions.map((item: { skipped: string }) => item.skipped), [
      'retired-subscription', 'retired-subscription', 'unavailable-remote'
    ]);
  });

  it('reports each retired subscription once per compound rule line', async () => {
    const profile = [
      '[Rule]',
      'OR,((RULE-SET,https://nrrule.pages.dev/List/old%2Elist),(NOT,((RULE-SET,https://nrrule.pages.dev/List/%6Fld.list))),(RULE-SET,https://nrrule.pages.dev/List/another.list)),AI',
      'RULE-SET,https://nrrule.pages.dev/List/old.list,AI',
    ].join('\n');
    const report = auditRuleCoverage(await readProfileSubscriptions(profile, '/tmp', '/tmp'));
    assert.equal(report.summary.retiredSubscriptions, 3);
    assert.deepEqual(report.subscriptions.map(item => item.id), [
      'nrrule.pages.dev/List/old.list:2',
      'nrrule.pages.dev/List/another.list:2',
      'nrrule.pages.dev/List/old.list:3',
    ]);
  });

  it('audits encoded split URLs and ignores the retired URL in a URL-REGEX predicate', async t => {
    const rulesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-encoded-split-'));
    t.after(() => fs.rm(rulesDir, { recursive: true, force: true }));
    await fs.mkdir(path.join(rulesDir, 'non_ip'));
    await fs.writeFile(path.join(rulesDir, 'non_ip', 'ai.conf'), 'DOMAIN,chatgpt.com\n');
    const profile = [
      '[Rule]',
      'RULE-SET,"https://NRRULE.PAGES.DEV:443/%4Cist/non_ip/%61i.conf?revision=2",AI',
      'URL-REGEX,"(RULE-SET,https://nrrule.pages.dev/List/ai.list)",AI',
    ].join('\n');
    const subscriptions = await readProfileSubscriptions(profile, rulesDir, rulesDir);
    assert.equal(subscriptions[0].variant, 'non_ip');
    assert.equal(subscriptions[0].skipped, undefined);
    assert.equal(subscriptions[0].lines[0], 'DOMAIN,chatgpt.com');
    assert.equal(subscriptions[1].kind, 'inline');
    assert.equal(subscriptions[1].skipped, undefined);
  });

  it('reports decoded control characters as unavailable subscriptions and continues the audit', async () => {
    const profile = [
      '[Rule]',
      'RULE-SET,https://nrrule.pages.dev/List/non_ip/a%00i.conf,AI',
      'RULE-SET,https://nrrule.pages.dev/List/non_ip/a%0Ai.conf,AI',
      'DOMAIN,chatgpt.com,AI',
    ].join('\n');
    const subscriptions = await readProfileSubscriptions(profile, '/tmp', '/tmp');
    assert.deepEqual(subscriptions.map(item => item.skipped), ['unavailable-remote', 'unavailable-remote', undefined]);
    assert.deepEqual(subscriptions[2].lines, ['DOMAIN,chatgpt.com']);
  });

  it('selects audited classical split files for the example in ruleset order', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-example-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const list = path.join(root, 'List');
    const auditPath = path.join(root, 'audit.json');
    await fs.mkdir(path.join(list, 'non_ip'), { recursive: true });
    await fs.mkdir(path.join(list, 'ip'));
    await assert.rejects(createRuleCoverageReport({ rulesDir: list, outputAuditPath: auditPath }), /Unable to read rule output audit/);
    await fs.writeFile(path.join(list, 'non_ip', 'reject.conf'), 'DOMAIN,ads.example\n');
    await fs.writeFile(path.join(list, 'non_ip', 'reject.list'), 'DOMAIN,alias.example\n');
    await fs.writeFile(path.join(list, 'ip', 'reject.list'), 'IP-CIDR,192.0.2.0/24,no-resolve\n');
    await fs.writeFile(path.join(list, 'non_ip', 'wechat.list'), 'DOMAIN,wechat.example\n');
    await fs.writeFile(auditPath, JSON.stringify({ rulesets: [
      { id: 'reject', outputs: [
        { platform: 'surge', variant: 'merged', status: 'published', path: 'List/reject.list' },
        { platform: 'surge', variant: 'non_ip', status: 'published', path: 'List/non_ip/reject.list' },
        { platform: 'surge', variant: 'non_ip', status: 'published', path: 'List/non_ip/reject.conf' },
        { platform: 'surge', variant: 'ip', status: 'published', path: 'List/ip/reject.list' },
      ] },
      { id: 'wechat', outputs: [
        { platform: 'surge', variant: 'non_ip', status: 'published', path: 'List/non_ip/wechat.list' },
        { platform: 'surge', variant: 'ip', status: 'absent-empty', path: 'List/ip/wechat.conf' },
        { platform: 'clash', variant: 'ip', status: 'published', path: 'Clash/ip/wechat.txt' },
      ] }
    ] }));
    const report = await createRuleCoverageReport({ rulesDir: list, outputAuditPath: auditPath });
    assert.deepEqual(report.subscriptions.slice(0, 3).map(({ id, variant, status }) => [id, variant, status]), [
      ['non_ip/reject.conf', 'non_ip', 'audited'],
      ['ip/reject.list', 'ip', 'audited'],
      ['non_ip/wechat.list', 'non_ip', 'audited'],
    ]);
    assert.equal(report.summary.auditedSubscriptions, 3);
    await fs.unlink(path.join(list, 'non_ip', 'reject.conf'));
    const missing = await createRuleCoverageReport({ rulesDir: list, outputAuditPath: auditPath });
    assert.equal(missing.subscriptions[0].skipped, 'missing-local-file');
  });

  it('audits published Surge domain sets and reports absent .conf files from the output audit', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-conf-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const list = path.join(root, 'List');
    await fs.mkdir(path.join(list, 'domainset'), { recursive: true });
    await fs.writeFile(path.join(list, 'domainset', 'cdn.conf'), '.example.com\nexact.test\n');
    const auditPath = path.join(root, 'audit.json');
    await fs.writeFile(auditPath, JSON.stringify({ rulesets: [{ id: 'cdn', outputs: [
      { platform: 'surge', variant: 'ip', status: 'absent-empty', path: 'List/ip/cdn.conf' },
    ] }] }));
    const profile = [
      '[Rule]', 'DOMAIN-SET,https://nrrule.pages.dev/List/domainset/cdn.conf,DIRECT',
      'DOMAIN,a.example.com,PROXY', 'RULE-SET,https://nrrule.pages.dev/List/ip/cdn.conf,DIRECT',
    ].join('\n');
    const report = auditRuleCoverage(await readProfileSubscriptions(profile, root, list, { outputAuditPath: auditPath }));
    assert.equal(report.subscriptions[0].variant, 'domainset');
    assert.equal(report.subscriptions[0].domainRules, 2);
    assert.equal(report.subscriptions[1].fullyCoveredDomainRules, 1);
    assert.equal(report.subscriptions[2].skipped, 'absent-variant');
  });

  it('parses native DOMAIN-SET lines with apex, subdomain and look-alike boundaries', () => {
    assert.equal(domainSetLineToRule('example.com'), 'DOMAIN,example.com');
    assert.equal(domainSetLineToRule('.example.com'), 'DOMAIN-SUFFIX,example.com');
    assert.equal(domainSetLineToRule('DOMAIN,example.com'), 'DOMAIN-SET-INVALID,DOMAIN,example.com');
    assert.equal(domainSetLineToRule('# comment'), '# comment');
    const report = auditRuleCoverage([
      { id: 'cdn', policy: 'DIRECT', format: 'domain-set', lines: ['.mzstatic.com', 'exact.apple.com', 'DOMAIN-SUFFIX,bad.example'] },
      { id: 'later', policy: 'Proxy', lines: ['DOMAIN,mzstatic.com', 'DOMAIN,a.b.mzstatic.com', 'DOMAIN,badmzstatic.com', 'DOMAIN,exact.apple.com', 'DOMAIN,sub.exact.apple.com'] }
    ]);
    assert.equal(report.subscriptions[0].format, 'domain-set');
    assert.equal(report.subscriptions[0].reviewStatus, 'reviewed');
    assert.equal(report.subscriptions[0].domainRules, 2);
    assert.equal(report.subscriptions[0].unsupportedTypes['DOMAIN-SET-INVALID'], 1);
    assert.equal(report.subscriptions[1].format, 'rule-set');
    // Apex and subdomain covered by the suffix; look-alike and exact-only boundaries are not.
    assert.equal(report.subscriptions[1].fullyCoveredDomainRules, 3);
    assert.equal(report.subscriptions[1].differentPolicyConflicts, 3);
  });

  it('resolves local DOMAIN-SET and nested RULE-SET variant references to local files', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-variants-'));
    try {
      const rulesDir = path.join(directory, 'List');
      await fs.mkdir(path.join(rulesDir, 'non_ip'), { recursive: true });
      await fs.writeFile(path.join(directory, 'apple_cdn.list'), '.mzstatic.com\nupdate.apple.com\n');
      await fs.writeFile(path.join(rulesDir, 'non_ip', 'microsoft_cdn.list'), 'URL-REGEX,^http://example\\.com/\nDOMAIN,mzstatic.com\n');
      const profile = [
        '[Rule]',
        'DOMAIN-SET,apple_cdn.list,DIRECT',
        'RULE-SET,https://nrrule.pages.dev/List/non_ip/microsoft_cdn.list,DIRECT',
        'DOMAIN,a.mzstatic.com,Proxy'
      ].join('\n');
      const subscriptions = await readProfileSubscriptions(profile, directory, rulesDir);
      assert.equal(subscriptions[0].id, 'local/apple_cdn.list:2');
      assert.equal(subscriptions[0].format, 'domain-set');
      assert.equal(subscriptions[1].id, 'nrrule.pages.dev/non_ip/microsoft_cdn.list:3');
      assert.equal(subscriptions[1].format, 'rule-set');
      const report = auditRuleCoverage(subscriptions, { basis: 'profile-rule-section' });
      assert.equal(report.summary.notCoveredSubscriptions, 0);
      assert.equal(report.subscriptions[0].domainRules, 2);
      assert.equal(report.subscriptions[1].fullyCoveredDomainRules, 1);
      assert.equal(report.subscriptions[1].unsupportedTypes['URL-REGEX'], 1);
      assert.equal(report.subscriptions[2].fullyCoveredDomainRules, 1);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('reports absent variants, format mismatches and unresolved references as not covered', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-absent-'));
    try {
      const rulesDir = path.join(directory, 'List');
      await fs.mkdir(rulesDir, { recursive: true });
      await fs.mkdir(path.join(directory, 'Internal'), { recursive: true });
      await fs.writeFile(path.join(directory, 'Internal', 'rule-output-audit.json'), JSON.stringify({
        rulesets: [{ id: 'apple_cdn', outputs: [
          { platform: 'surge', variant: 'ip', status: 'absent-empty', reason: 'no-conditions', path: 'List/ip/apple_cdn.list' },
          { platform: 'clash', variant: 'non_ip', status: 'absent-empty', path: 'Clash/non_ip/apple_cdn.txt' }
        ] }]
      }));
      const profile = [
        '[Rule]',
        'RULE-SET,https://nrrule.pages.dev/List/ip/apple_cdn.list,DIRECT',
        'RULE-SET,https://nrrule.pages.dev/List/non_ip/apple_cdn.list,DIRECT',
        'DOMAIN-SET,https://nrrule.pages.dev/List/non_ip/apple_cdn.list,DIRECT',
        'DOMAIN-SET,https://nrrule.pages.dev/List/domainset/apple_cdn.list,DIRECT',
        'DOMAIN-SET,https://example.com/set.txt,DIRECT'
      ].join('\n');
      const report = auditRuleCoverage(await readProfileSubscriptions(profile, directory, rulesDir), { basis: 'profile-rule-section' });
      const [absent, missing, mismatch, retired, remote] = report.subscriptions;
      assert.equal(absent.skipped, 'absent-variant');
      assert.equal(absent.reviewStatus, 'not-covered');
      assert.match(absent.notCoveredReason ?? '', /absent-empty/);
      assert.equal(missing.skipped, 'missing-local-file');
      // Only the Surge output status applies; an absent Clash variant does not explain a missing Surge file.
      assert.match(missing.notCoveredReason ?? '', /no absent status/);
      assert.equal(mismatch.skipped, 'format-mismatch');
      assert.match(mismatch.notCoveredReason ?? '', /DOMAIN-SET/);
      assert.equal(retired.skipped, 'retired-subscription');
      assert.equal(retired.format, 'domain-set');
      assert.match(retired.notCoveredReason ?? '', /List\/domainset\/<id>\.conf/);
      assert.equal(remote.skipped, 'unavailable-remote');
      assert.ok(report.subscriptions.every(item => item.reviewStatus === 'not-covered' && item.notCoveredReason));
      assert.equal(report.summary.auditedSubscriptions, 0);
      assert.equal(report.summary.notCoveredSubscriptions, 5);
      assert.equal(report.summary.absentVariantSubscriptions, 1);
      assert.equal(report.summary.formatMismatchSubscriptions, 1);
      assert.equal(report.summary.missingLocalSubscriptions, 1);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('ignores non-Surge absent statuses and rejects an unreadable output audit', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-availability-'));
    try {
      const auditPath = path.join(directory, 'audit.json');
      await fs.writeFile(auditPath, JSON.stringify({ rulesets: [
        { id: 'a', outputs: [{ platform: 'singbox', variant: 'ip', status: 'absent-unsupported' }] },
        { id: 'b', outputs: [{ platform: 'surge', variant: 'non_ip', status: 'absent-unsupported', reason: 'platform-unsupported' }] },
        { id: 'c', outputs: [{ platform: 'surge', variant: 'ip', status: 'published' }] }
      ] }));
      assert.deepEqual([...await loadVariantAvailability(auditPath)], [['b/non_ip', 'absent-unsupported (platform-unsupported)']]);
      assert.equal((await loadVariantAvailability(path.join(directory, 'missing.json'))).size, 0);
      await fs.writeFile(auditPath, '{');
      await assert.rejects(loadVariantAvailability(auditPath), /Unable to read rule output audit/);
      await fs.writeFile(auditPath, '{}');
      await assert.rejects(loadVariantAvailability(auditPath), /no rulesets list/);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
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

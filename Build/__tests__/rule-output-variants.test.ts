import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createSpan } from '../trace';
import { EnhancedFileOutput } from '../lib/enhanced-file-output';
import { normalizeTargets } from '../lib/platform-config';
import type { SupportedPlatform } from '../lib/platform-config';
import { RuleSourceProcessor } from '../lib/rule-source-processor';
import { ruleGroups, specialRules } from '../lib/rule-sources';
import type { RuleProcessingOptions } from '../lib/rule-source-types';
import {
  classifyRuleLine,
  resolveRuleOutputTarget,
  RULE_OUTPUT_VARIANTS,
  rulesetIdFromConfigPath,
} from '../lib/rule-output-variants';
import type { RuleOutputVariant } from '../lib/rule-output-variants';
import type { RuleOutputFileAudit } from '../lib/output-audit';

const ALL_PLATFORMS: SupportedPlatform[] = ['surge', 'clash', 'singbox', 'loon'];

function makeOutput(
  id: string,
  rules: string[],
  options: { platforms?: SupportedPlatform[]; directory?: string; config?: RuleProcessingOptions; policy?: string | null } = {}
) {
  const output = new EnhancedFileOutput(
    createSpan(id), id, options.platforms ?? ALL_PLATFORMS, options.policy ?? null, options.config, options.directory ?? 'out'
  ).withTitle(id).withDescription(['fixture']);
  output.addRules(rules);
  return output;
}

interface SingboxJson { rules: Array<Record<string, string[]>> }

function stripBanner(content: string): string {
  return content.split('\n').filter(line => !line.startsWith('#')).join('\n');
}

function textConditions(lines: readonly string[]): string[] {
  return lines.filter(line => line.trim() && !line.startsWith('#'));
}

/** Rebuild classical conditions from a native Surge DOMAIN-SET body. */
function fromDomainSet(lines: readonly string[]): string[] {
  return textConditions(lines).map(line => (line.startsWith('.') ? `DOMAIN-SUFFIX,${line.slice(1)}` : `DOMAIN,${line}`));
}

function singboxEntries(lines: readonly string[]): string[] {
  const json = JSON.parse(lines.join('\n')) as SingboxJson;
  return json.rules.flatMap(rule => Object.entries(rule).flatMap(([key, values]) => values.map(value => `${key}:${value}`)));
}

/** Conditions of one platform output, in the merged writer's syntax. */
function variantConditions(platform: SupportedPlatform, variant: RuleOutputVariant, lines: readonly string[]): string[] {
  if (platform === 'singbox') return singboxEntries(lines);
  if (platform === 'surge' && variant === 'domainset') return fromDomainSet(lines);
  return textConditions(lines);
}

function mergedConditions(platform: SupportedPlatform, lines: readonly string[]): string[] {
  return platform === 'singbox' ? singboxEntries(lines) : textConditions(lines);
}

async function assertUnionEqualsMerged(output: EnhancedFileOutput, platforms: SupportedPlatform[]) {
  const merged = await output.compile();
  for (const [index, platform] of platforms.entries()) {
    const union = RULE_OUTPUT_VARIANTS.flatMap(variant => variantConditions(platform, variant, output.getVariantContent(platform, variant)));
    assert.deepEqual([...union].sort(), [...mergedConditions(platform, merged[index])].sort(), `${platform} variant union`);
    const sets = RULE_OUTPUT_VARIANTS.map(variant => new Set(variantConditions(platform, variant, output.getVariantContent(platform, variant))));
    for (const [left, set] of sets.entries()) {
      for (const other of sets.slice(left + 1)) {
        assert.equal([...set].some(condition => other.has(condition)), false, `${platform} variants overlap`);
      }
    }
  }
}

const SURGE_DOMAIN_MATCHERS = new Set(['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-WILDCARD', 'URL-REGEX']);

/**
 * Model Surge RULE-SET extended matching: a flagged top-level domain rule enables it for
 * every domain matcher in the file, including logical sub-rules. Returns each condition
 * that has a domain matcher (flag removed) and whether extended matching applies to it.
 */
function surgeExtendedContext(lines: readonly string[]): Map<string, boolean> {
  const conditions = textConditions(lines);
  const typeOf = (line: string) => line.slice(0, line.indexOf(',')).toUpperCase();
  const fileFlag = conditions.some(line => SURGE_DOMAIN_MATCHERS.has(typeOf(line)) && line.split(',').includes('extended-matching'));
  const context = new Map<string, boolean>();
  for (const line of conditions) {
    const type = typeOf(line);
    const hasMatcher = SURGE_DOMAIN_MATCHERS.has(type)
      || ([...line.matchAll(/\(\s*([A-Z][A-Z\d-]*)\s*,/gi)].some(child => SURGE_DOMAIN_MATCHERS.has(child[1].toUpperCase())));
    if (!hasMatcher) continue;
    const explicit = line.includes(',extended-matching');
    context.set(line.replaceAll(',extended-matching', ''), fileFlag || explicit);
  }
  return context;
}

/** Evaluate AND,((DOMAIN-SUFFIX,stream.example),(IP-CIDR,203.0.113.0/24)) for one request. */
function surgeMatchesStreamRule(request: { hostname: string; sni: string; ip: string }, extended: boolean): boolean {
  const suffix = (host: string) => host === 'stream.example' || host.endsWith('.stream.example');
  const domain = suffix(request.hostname) || (extended && suffix(request.sni));
  return domain && request.ip.startsWith('203.0.113.');
}

function findOutput(outputs: RuleOutputFileAudit[], platform: SupportedPlatform, variant: RuleOutputFileAudit['variant']) {
  const entry = outputs.find(candidate => candidate.platform === platform && candidate.variant === variant);
  assert.ok(entry, `${platform}/${variant}`);
  return entry;
}

const MIXED_RULES = [
  'DOMAIN-SUFFIX,openai.com',
  'DOMAIN,chat.example',
  'DOMAIN-KEYWORD,telegram',
  'DOMAIN-WILDCARD,*.wild.example',
  String.raw`URL-REGEX,^https?://ads\.example/`,
  'USER-AGENT,Telegram*',
  'PROCESS-NAME,Telegram',
  'SRC-IP,192.168.1.10',
  'DEST-PORT,443',
  'PROTOCOL,QUIC',
  'IP-CIDR,91.108.4.0/22,no-resolve',
  'IP-CIDR,149.154.160.0/20',
  'IP-CIDR6,2001:b28:f23d::/48,no-resolve',
  'IP-CIDR6,2001:67c:4e8::/48',
  'IP-ASN,62041,no-resolve',
  'IP-ASN,44907',
  'GEOIP,US',
  'GEOIP,TG,no-resolve',
  'AND,((DOMAIN-SUFFIX,stream.example),(IP-CIDR,203.0.113.0/24))',
  'OR,((DOMAIN,a.or.example),(DOMAIN,b.or.example))',
  'NOT,((OR,((GEOIP,CN),(DOMAIN,c.example))))',
  'AND,((SRC-IP,10.0.0.1),(DOMAIN,d.example))',
];

describe('rule output variant contract', () => {
  it('keeps the flat id and places variants under the platform directory', () => {
    assert.equal(rulesetIdFromConfigPath('List/streaming_!cn.list'), 'streaming_!cn');
    assert.equal(rulesetIdFromConfigPath('List/Apple_CDN.list'), 'apple_cdn');
    assert.deepEqual(resolveRuleOutputTarget('surge', 'merged', 'apple_cdn'), {
      platform: 'surge', slot: 'merged', format: 'surge-classical', relativePath: 'List/apple_cdn.list',
    });
    assert.deepEqual(resolveRuleOutputTarget('surge', 'domainset', 'apple_cdn'), {
      platform: 'surge', slot: 'domainset', format: 'surge-domainset', relativePath: 'List/domainset/apple_cdn.list',
    });
    assert.equal(resolveRuleOutputTarget('clash', 'domainset', 'x').format, 'clash-classical');
    assert.equal(resolveRuleOutputTarget('clash', 'non_ip', 'x').relativePath, 'Clash/non_ip/x.txt');
    assert.equal(resolveRuleOutputTarget('loon', 'ip', 'x').relativePath, 'Loon/ip/x.list');
    assert.equal(resolveRuleOutputTarget('singbox', 'ip', 'x').relativePath, 'sing-box/ip/x.json');
  });

  it('classifies destination IP and logical rules whole, and keeps source IP outside ip', () => {
    assert.equal(classifyRuleLine('AND,((DOMAIN,a.example),(IP-CIDR,1.0.0.0/8))'), 'ip');
    assert.equal(classifyRuleLine('NOT,((AND,((DOMAIN,a.example),(OR,((IP-ASN,1),(DOMAIN,b.example))))))'), 'ip');
    assert.equal(classifyRuleLine('AND,((SRC-IP,10.0.0.1),(DOMAIN,a.example))'), 'non_ip');
    assert.equal(classifyRuleLine('SRC-IP-CIDR,10.0.0.0/8'), 'non_ip');
    assert.equal(classifyRuleLine('GEOIP,CN,no-resolve'), 'ip');
    assert.equal(classifyRuleLine('# comment'), null);
    assert.equal(classifyRuleLine(''), null);
  });

  it('applies to every enabled ruleset with unique ids and non-conflicting paths', () => {
    const configs = [
      ...ruleGroups.flatMap(group => group.files.map(file => ({ path: file.path, targets: group.targets }))),
      ...specialRules.map(rule => ({ path: rule.targetFile, targets: rule.targets })),
    ];
    const ids = configs.map(config => rulesetIdFromConfigPath(config.path));
    assert.equal(new Set(ids).size, ids.length);
    const paths = new Set<string>();
    for (const [index, config] of configs.entries()) {
      for (const platform of normalizeTargets(config.targets)) {
        for (const slot of ['merged', ...RULE_OUTPUT_VARIANTS] as const) {
          const { relativePath } = resolveRuleOutputTarget(platform, slot, ids[index]);
          assert.equal(paths.has(relativePath), false, relativePath);
          paths.add(relativePath);
        }
      }
    }
  });
});

describe('rule output variants', () => {
  it('publishes Apple CDN-like suffix rules only as domainset with the merged boundaries', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-variants-apple-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const output = makeOutput('apple_cdn', [
      'DOMAIN-SUFFIX,cdn-apple.com',
      '.aaplimg.com',
      'DOMAIN,sub.cdn-apple.com',
      'DOMAIN,notcdn-apple.com',
      'DOMAIN,mzstatic.com',
    ], { directory });
    const audit = await output.write();

    const surge = await fs.readFile(path.join(directory, 'List/domainset/apple_cdn.list'), 'utf8');
    assert.deepEqual(
      textConditions(surge.split('\n')).sort(),
      ['.aaplimg.com', '.cdn-apple.com', 'mzstatic.com', 'notcdn-apple.com']
    );
    const merged = await fs.readFile(path.join(directory, 'List/apple_cdn.list'), 'utf8');
    // Same order and boundaries: suffix covers apex and subdomains, the look-alike stays exact.
    assert.deepEqual(fromDomainSet(surge.split('\n')), textConditions(merged.split('\n')));
    assert.equal(merged.includes('sub.cdn-apple.com'), false);
    for (const [directoryName, extension] of [['Clash', 'txt'], ['Loon', 'list'], ['sing-box', 'json']]) {
      // eslint-disable-next-line no-await-in-loop -- compare each platform pair
      const flat = await fs.readFile(path.join(directory, directoryName, `apple_cdn.${extension}`), 'utf8');
      // eslint-disable-next-line no-await-in-loop -- compare each platform pair
      const domainset = await fs.readFile(path.join(directory, directoryName, 'domainset', `apple_cdn.${extension}`), 'utf8');
      assert.equal(stripBanner(domainset), stripBanner(flat), directoryName);
    }
    for (const platform of ALL_PLATFORMS) {
      assert.equal(findOutput(audit.outputs, platform, 'domainset').status, 'published');
      for (const variant of ['non_ip', 'ip'] as const) {
        const entry = findOutput(audit.outputs, platform, variant);
        assert.equal(entry.status, 'absent-empty');
        assert.equal(entry.reason, 'no-conditions');
        assert.equal(entry.sha256, null);
      }
    }
    await assert.rejects(fs.access(path.join(directory, 'List/non_ip/apple_cdn.list')), { code: 'ENOENT' });
    const surgeDomainset = findOutput(audit.outputs, 'surge', 'domainset');
    assert.equal(surgeDomainset.format, 'surge-domainset');
    assert.equal(surgeDomainset.effectiveConditionCount, 4);
    assert.equal(surgeDomainset.bytes, new TextEncoder().encode(surge).length);
    await assertUnionEqualsMerged(makeOutput('apple_cdn', ['DOMAIN-SUFFIX,cdn-apple.com', 'DOMAIN,notcdn-apple.com']), ALL_PLATFORMS);
  });

  it('keeps Microsoft CDN-like URL-REGEX in non_ip and reports platforms that cannot express it', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-variants-ms-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const rules = ['DOMAIN-SUFFIX,msecnd.net', String.raw`URL-REGEX,^https?://download\.windowsupdate\.com/`];
    const audit = await makeOutput('microsoft_cdn', rules, { directory }).write();
    const nonIp = await fs.readFile(path.join(directory, 'List/non_ip/microsoft_cdn.list'), 'utf8');
    assert.ok(nonIp.includes(String.raw`URL-REGEX,^https?://download\.windowsupdate\.com/`));
    assert.equal(nonIp.includes('msecnd.net'), false);
    assert.equal(findOutput(audit.outputs, 'loon', 'non_ip').status, 'published');
    for (const platform of ['clash', 'singbox'] as const) {
      const entry = findOutput(audit.outputs, platform, 'non_ip');
      assert.equal(entry.status, 'absent-unsupported');
      assert.equal(entry.routedConditionCount, 1);
      assert.deepEqual(entry.drops.unsupported, { 'URL-REGEX': 1 });
    }
    await assert.rejects(fs.access(path.join(directory, 'Clash/non_ip/microsoft_cdn.txt')), { code: 'ENOENT' });
    await assertUnionEqualsMerged(makeOutput('microsoft_cdn', rules), ALL_PLATFORMS);
  });

  it('splits AI, Telegram and stream-like mixed rules into exclusive variants on every platform', async t => {
    await assertUnionEqualsMerged(makeOutput('mixed', MIXED_RULES), ALL_PLATFORMS);

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-variants-mixed-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    await makeOutput('mixed', MIXED_RULES, { directory }).write();
    const read = (relative: string) => fs.readFile(path.join(directory, relative), 'utf8').then(content => textConditions(content.split('\n')));
    const surgeIp = await read('List/ip/mixed.list');
    assert.deepEqual(surgeIp, [
      'AND,((DOMAIN-SUFFIX,stream.example),(IP-CIDR,203.0.113.0/24))',
      'NOT,((OR,((GEOIP,CN),(DOMAIN,c.example))))',
      'GEOIP,US',
      'IP-CIDR,91.108.4.0/22,no-resolve',
      'IP-CIDR6,2001:b28:f23d::/48,no-resolve',
      'IP-ASN,62041,no-resolve',
      'GEOIP,TG,no-resolve',
      'IP-CIDR,149.154.160.0/20',
      'IP-CIDR6,2001:67c:4e8::/48',
      'IP-ASN,44907',
    ]);
    const surgeNonIp = await read('List/non_ip/mixed.list');
    assert.ok(surgeNonIp.includes('SRC-IP,192.168.1.10'));
    assert.ok(surgeNonIp.includes('AND,((SRC-IP,10.0.0.1),(DOMAIN,d.example))'));
    assert.ok(surgeNonIp.includes('OR,((DOMAIN,a.or.example),(DOMAIN,b.or.example))'));
    assert.equal(surgeNonIp.some(line => line.startsWith('IP-') || line.startsWith('GEOIP')), false);
    assert.deepEqual(await read('List/domainset/mixed.list'), ['chat.example', '.openai.com']);
    const clashIp = await read('Clash/ip/mixed.txt');
    assert.ok(clashIp.includes('AND,((DOMAIN-SUFFIX,stream.example),(IP-CIDR,203.0.113.0/24))'));
    const clashNonIp = await read('Clash/non_ip/mixed.txt');
    assert.ok(clashNonIp.includes('SRC-IP-CIDR,192.168.1.10/32'));
    const singboxIp = JSON.parse((await fs.readFile(path.join(directory, 'sing-box/ip/mixed.json'), 'utf8'))) as SingboxJson;
    assert.deepEqual(singboxIp.rules[0].ip_cidr, ['91.108.4.0/22', '2001:b28:f23d::/48', '149.154.160.0/20', '2001:67c:4e8::/48']);
  });

  it('writes no file for a platform that supports none of a variant and still gates merged sing-box output', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-variants-unsupported-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const audit = await makeOutput('asn_geoip', ['DOMAIN,x.example', 'IP-ASN,4134', 'GEOIP,CN'], { directory }).write();
    const singboxIp = findOutput(audit.outputs, 'singbox', 'ip');
    assert.equal(singboxIp.status, 'absent-unsupported');
    assert.deepEqual(singboxIp.drops.unsupported, { 'IP-ASN': 1, GEOIP: 1 });
    assert.equal(findOutput(audit.outputs, 'singbox', 'merged').status, 'published');
    assert.equal(findOutput(audit.outputs, 'clash', 'ip').status, 'published');

    const uaAudit = await makeOutput('ua_only', ['USER-AGENT,Example*'], { directory, platforms: ['surge', 'clash'] }).write();
    assert.equal(findOutput(uaAudit.outputs, 'clash', 'merged').effectiveConditionCount, 0);
    assert.equal(findOutput(uaAudit.outputs, 'clash', 'non_ip').status, 'absent-unsupported');
    assert.equal(findOutput(uaAudit.outputs, 'surge', 'non_ip').status, 'published');

    await assert.rejects(
      makeOutput('asn_only', ['IP-ASN,4134'], { directory }).write(),
      /singbox: refusing to publish a ruleset without matching conditions/
    );
    await assert.rejects(fs.access(path.join(directory, 'List/asn_only.list')), { code: 'ENOENT' });
    await assert.rejects(fs.access(path.join(directory, 'List/ip/asn_only.list')), { code: 'ENOENT' });
  });

  it('keeps extended-matching domains out of Surge DOMAIN-SET only', async () => {
    const output = makeOutput('extended', ['DOMAIN-SUFFIX,example.com,extended-matching', 'DOMAIN,other.test']);
    await assertUnionEqualsMerged(output, ALL_PLATFORMS);
    assert.deepEqual(output.getVariantContent('surge', 'domainset'), []);
    assert.deepEqual([...output.getVariantContent('surge', 'non_ip')].sort(), [
      'DOMAIN,other.test,extended-matching', 'DOMAIN-SUFFIX,example.com,extended-matching',
    ]);
    assert.deepEqual([...output.getVariantContent('clash', 'domainset')].sort(), ['DOMAIN,other.test', 'DOMAIN-SUFFIX,example.com']);

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-variants-extended-'));
    try {
      const audit = await makeOutput('extended', ['DOMAIN-SUFFIX,example.com,extended-matching'], { directory }).write();
      const entry = findOutput(audit.outputs, 'surge', 'domainset');
      assert.equal(entry.status, 'absent-empty');
      assert.equal(entry.reason, 'extended-matching');
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves Surge set-wide extended matching for logical domain+IP rules after splitting', async t => {
    const rules = [
      'DOMAIN-SUFFIX,example.com,extended-matching',
      'AND,((DOMAIN-SUFFIX,stream.example),(IP-CIDR,203.0.113.0/24))',
      'OR,((DOMAIN,a.or.example),(DEST-PORT,8443))',
      'IP-CIDR,198.51.100.0/24',
      'NOT,((IP-ASN,64512))',
    ];
    const output = makeOutput('extended_logical', rules);
    const [merged] = await output.compile();
    const files = RULE_OUTPUT_VARIANTS.map(variant => output.getVariantContent('surge', variant));
    // Each condition must see the same effective extended matching as in the merged file.
    const expected = surgeExtendedContext(merged);
    const actual = new Map(files.flatMap(lines => [...surgeExtendedContext(lines)]));
    assert.deepEqual(actual, expected);
    assert.equal(expected.get('AND,((DOMAIN-SUFFIX,stream.example),(IP-CIDR,203.0.113.0/24))'), true);
    // A request to a literal IP with SNI stream.example matches only with extended matching.
    const request = { hostname: '203.0.113.7', sni: 'stream.example', ip: '203.0.113.7' };
    const matchesIn = (lines: string[]) => lines.some(line => line.startsWith('AND,') && surgeMatchesStreamRule(request, surgeExtendedContext(lines).get(line) ?? false));
    assert.equal(matchesIn(merged), true);
    assert.equal(files.some(matchesIn), true);
    // The expression stays whole: Surge keeps it with the flagged domain rules, other platforms in ip.
    assert.ok(output.getVariantContent('surge', 'non_ip').includes('AND,((DOMAIN-SUFFIX,stream.example),(IP-CIDR,203.0.113.0/24))'));
    assert.ok(output.getVariantContent('surge', 'ip').includes('NOT,((IP-ASN,64512))'));
    assert.ok(output.getVariantContent('clash', 'ip').includes('AND,((DOMAIN-SUFFIX,stream.example),(IP-CIDR,203.0.113.0/24))'));
    await assertUnionEqualsMerged(makeOutput('extended_logical', rules), ALL_PLATFORMS);

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-variants-extended-logical-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const flatBefore = merged.join('\n');
    const audit = await makeOutput('extended_logical', rules, { directory }).write();
    assert.deepEqual(findOutput(audit.outputs, 'surge', 'non_ip').reroutedFromIp, { reason: 'extended-matching', count: 1 });
    assert.equal(findOutput(audit.outputs, 'clash', 'non_ip').reroutedFromIp, undefined);
    const flat = await fs.readFile(path.join(directory, 'List/extended_logical.list'), 'utf8');
    assert.equal(textConditions(flat.split('\n')).join('\n'), flatBefore);
  });

  it('records dropped values and ignored modifiers per output without changing flat payloads', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-variants-losses-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const audit = await makeOutput('losses', [
      'DOMAIN,a.example,extended-matching',
      'DOMAIN-KEYWORD,kw',
      'PROTOCOL,QUIC',
      'PROTOCOL,UDP',
      'IP-CIDR,192.0.2.0/24,no-resolve',
      'IP-CIDR6,2001:db8::/32,no-resolve',
      'IP-CIDR,198.51.100.0/24',
    ], { directory }).write();
    assert.deepEqual(findOutput(audit.outputs, 'clash', 'merged').losses, {
      droppedValues: { 'PROTOCOL:QUIC': 1 },
      ignoredModifiers: { 'extended-matching': 2 },
    });
    assert.deepEqual(findOutput(audit.outputs, 'clash', 'non_ip').losses.droppedValues, { 'PROTOCOL:QUIC': 1 });
    assert.deepEqual(findOutput(audit.outputs, 'singbox', 'merged').losses.ignoredModifiers, { 'no-resolve': 2, 'extended-matching': 2 });
    assert.deepEqual(findOutput(audit.outputs, 'singbox', 'ip').losses.ignoredModifiers, { 'no-resolve': 2 });
    assert.deepEqual(findOutput(audit.outputs, 'loon', 'domainset').losses.ignoredModifiers, { 'extended-matching': 1 });
    assert.deepEqual(findOutput(audit.outputs, 'surge', 'merged').losses, { droppedValues: {}, ignoredModifiers: {} });
    const clash = await fs.readFile(path.join(directory, 'Clash/losses.txt'), 'utf8');
    assert.equal(clash.includes('QUIC'), false);
    assert.ok(clash.includes('NETWORK,UDP'));
  });

  it('removes a variant that becomes legitimately absent and leaves files untouched on failure', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-variants-lifecycle-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    await makeOutput('cycle', ['DOMAIN,a.example', 'IP-CIDR,192.0.2.0/24'], { directory }).write();
    const ipPath = path.join(directory, 'List/ip/cycle.list');
    const ipContent = await fs.readFile(ipPath, 'utf8');

    // A failing ruleset (sing-box merged gate) must not delete or rewrite anything.
    await assert.rejects(makeOutput('cycle', ['USER-AGENT,Only*'], { directory }).write());
    assert.equal(await fs.readFile(ipPath, 'utf8'), ipContent);
    await fs.access(path.join(directory, 'List/domainset/cycle.list'));

    const audit = await makeOutput('cycle', ['DOMAIN,a.example'], { directory }).write();
    assert.equal(findOutput(audit.outputs, 'surge', 'ip').status, 'absent-empty');
    for (const relative of ['List/ip/cycle.list', 'Clash/ip/cycle.txt', 'Loon/ip/cycle.list', 'sing-box/ip/cycle.json']) {
      // eslint-disable-next-line no-await-in-loop -- check each platform cleanup
      await assert.rejects(fs.access(path.join(directory, relative)), { code: 'ENOENT' }, relative);
    }
    await fs.access(path.join(directory, 'List/domainset/cycle.list'));
  });

  it('leaves previous files untouched and records no audit when a source download fails', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-variants-download-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    await makeOutput('failing', ['DOMAIN,a.example', 'IP-CIDR,192.0.2.0/24'], { directory }).write();
    const before = await fs.readFile(path.join(directory, 'List/ip/failing.list'), 'utf8');
    const processor = new RuleSourceProcessor(createSpan('download-failure'), directory);
    const stats = await processor.processSpecialRules([{
      name: 'Failing',
      targetFile: 'List/failing.list',
      sourceFiles: [path.join(directory, 'missing-module.ts')],
      targets: ALL_PLATFORMS,
    }]);
    assert.equal(stats.errors.length, 1);
    assert.deepEqual(stats.audits, []);
    assert.equal(await fs.readFile(path.join(directory, 'List/ip/failing.list'), 'utf8'), before);
  });

  it('builds variants for every enabled ruleset configuration with its own targets and options', async () => {
    const configs = [
      ...ruleGroups.flatMap(group => group.files.map(file => ({
        id: rulesetIdFromConfigPath(file.path), targets: group.targets, options: file, policy: group.defaultPolicy ?? null,
      }))),
      ...specialRules.map(rule => ({
        id: rulesetIdFromConfigPath(rule.targetFile), targets: rule.targets, options: rule, policy: rule.defaultPolicy ?? null,
      })),
    ];
    for (const config of configs) {
      const platforms = normalizeTargets(config.targets);
      const policies = config.options.sourcePolicies;
      const rules = policies?.length ? MIXED_RULES.map(rule => `${rule},${policies[0]}`) : MIXED_RULES;
      const output = new EnhancedFileOutput(createSpan(config.id), config.id, platforms, config.policy, config.options, 'out')
        .withTitle(config.id)
        .withDescription([]);
      output.addRules(rules);
      // eslint-disable-next-line no-await-in-loop -- compile one ruleset configuration at a time
      await assertUnionEqualsMerged(output, platforms);
    }
  });
});

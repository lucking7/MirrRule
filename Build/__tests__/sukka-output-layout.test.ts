import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import type { TestContext } from 'node:test';
import { EnhancedFileOutput } from '../lib/enhanced-file-output';
import { sha256Hex } from '../lib/output-audit';
import { resolveRuleOutputTargets } from '../lib/rule-output-variants';
import { createSpan } from '../trace';

async function makeDirectory(t: TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-sukka-layout-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function makeOutput(directory: string, rules: string[]) {
  return new EnhancedFileOutput(createSpan('sukka-layout'), 'sample', ['surge', 'clash', 'singbox', 'loon'], null, {}, directory)
    .withTitle('Sample')
    .withDescription([])
    .addRules(rules);
}

function textConditions(body: string) {
  return body.split('\n').filter(line => line && !line.startsWith('#')).sort();
}

it('renders native domainset formats alongside complete classical and JSON outputs', async t => {
  const directory = await makeDirectory(t);
  const audit = await makeOutput(directory, [
    'DOMAIN,exact.example',
    'DOMAIN-SUFFIX,suffix.example',
    'DOMAIN-SUFFIX,*.not-native.example',
    'DOMAIN-WILDCARD,*.wild.example',
    'DOMAIN-KEYWORD,tracking',
    'DOMAIN,tracking.example',
    'AND,((DOMAIN,logical.example),(IP-CIDR,192.0.2.0/24))',
    'IP-CIDR,198.51.100.0/24,no-resolve',
  ]).write();

  const read = (relative: string) => fs.readFile(path.join(directory, relative), 'utf8');
  assert.deepEqual(textConditions(await read('List/domainset/sample.conf')), ['.suffix.example', 'exact.example']);
  assert.deepEqual(textConditions(await read('Clash/domainset/sample.txt')), ['+.suffix.example', 'exact.example']);
  assert.deepEqual(JSON.parse(await read('sing-box/domainset/sample.json')), {
    version: 2, rules: [{ domain: ['exact.example'], domain_suffix: ['suffix.example'] }],
  });
  assert.ok(textConditions(await read('List/non_ip/sample.conf')).includes('DOMAIN-SUFFIX,suffix.example'));
  assert.ok(textConditions(await read('List/non_ip/sample.conf')).includes('DOMAIN-KEYWORD,tracking'));
  assert.ok(textConditions(await read('List/ip/sample.conf')).includes('IP-CIDR,198.51.100.0/24,no-resolve'));
  const publishedDomainsets = audit.outputs.filter(output => output.variant === 'domainset' && output.status === 'published');
  assert.deepEqual(publishedDomainsets.map(({ format, effectiveConditionCount }) => [format, effectiveConditionCount]), [
    ['surge-domainset', 2], ['clash-domain', 2], ['singbox-json-v2', 2],
  ]);
  assert.equal(audit.effectiveOutputs.length, 4);
  const paths = resolveRuleOutputTargets('surge', 'sample', { legacyOnly: true }).map(target => target.relativePath);
  assert.deepEqual(paths, ['List/non_ip/sample.list', 'List/ip/sample.list']);
});

it('mirrors the exact legacy Surge bytes, including a retained timestamp, and cleans absent variants', async t => {
  const directory = await makeDirectory(t);
  const rules = ['DOMAIN,a.example', 'IP-CIDR,192.0.2.0/24,no-resolve'];
  await makeOutput(directory, rules).write();
  const legacy = path.join(directory, 'List/non_ip/sample.list');
  const alias = path.join(directory, 'List/non_ip/sample.conf');
  const retained = (await fs.readFile(legacy, 'utf8')).replace(/^# Last Updated: .+$/m, '# Last Updated: 2026-01-01T00:00:00.000Z');
  await fs.writeFile(legacy, retained);
  const refreshed = await makeOutput(directory, rules).write();
  assert.equal(await fs.readFile(alias, 'utf8'), retained);
  assert.equal(refreshed.outputs.find(output => output.path === 'List/non_ip/sample.conf')?.sha256, sha256Hex(retained));

  const ipOnly = await makeOutput(directory, ['IP-CIDR,192.0.2.0/24,no-resolve']).write();
  const absent = ['List/domainset/sample.conf', 'Clash/domainset/sample.txt', 'sing-box/domainset/sample.json',
    'List/non_ip/sample.list', 'List/non_ip/sample.conf'];
  await Promise.all(absent.map(async relative => {
    await assert.rejects(fs.access(path.join(directory, relative)), { code: 'ENOENT' });
    assert.equal(ipOnly.outputs.find(output => output.path === relative)?.status, 'absent-empty');
  }));
});

it('projects only the assigned non_ip source and omits Surge sets requiring extended matching', async t => {
  const directory = await makeDirectory(t);
  const nonIp = ['DOMAIN,a.example,extended-matching', 'DOMAIN-SUFFIX,b.example'];
  const ip = ['DOMAIN,ip-source.example', 'IP-CIDR,192.0.2.0/24'];
  const output = makeOutput(directory, [...nonIp, ...ip]);
  const audit = await output.addVariantSource('non_ip', nonIp).addVariantSource('ip', ip).write();
  const surge = audit.outputs.find(entry => entry.path === 'List/domainset/sample.conf');
  assert.equal(surge?.status, 'absent-unsupported');
  assert.equal(surge.routedConditionCount, 2);
  await assert.rejects(fs.access(path.join(directory, 'List/domainset/sample.conf')), { code: 'ENOENT' });
  assert.deepEqual(textConditions(await fs.readFile(path.join(directory, 'Clash/domainset/sample.txt'), 'utf8')), ['+.b.example', 'a.example']);
  assert.deepEqual(audit.outputs.find(entry => entry.path === 'Clash/domainset/sample.txt')?.losses.ignoredModifiers, { 'extended-matching': 2 });
});

it('uses the same IDNA hostnames as the classical rulesets and skips malformed labels', async t => {
  const directory = await makeDirectory(t);
  await makeOutput(directory, [
    'DOMAIN,café.example',
    'DOMAIN-SUFFIX,münchen.example',
    'DOMAIN-SUFFIX,test',
    'DOMAIN,-invalid.example',
  ]).write();
  const read = (relative: string) => fs.readFile(path.join(directory, relative), 'utf8');
  assert.deepEqual(textConditions(await read('List/domainset/sample.conf')), [
    '.test', '.xn--mnchen-3ya.example', 'xn--caf-dma.example',
  ]);
  assert.deepEqual(textConditions(await read('Clash/domainset/sample.txt')), [
    '+.test', '+.xn--mnchen-3ya.example', 'xn--caf-dma.example',
  ]);
  assert.deepEqual(JSON.parse(await read('sing-box/domainset/sample.json')), {
    version: 2, rules: [{ domain: ['xn--caf-dma.example'], domain_suffix: ['xn--mnchen-3ya.example', 'test'] }],
  });
  const classical = await read('List/non_ip/sample.conf');
  assert.ok(classical.includes('DOMAIN,xn--caf-dma.example'));
  assert.ok(classical.includes('DOMAIN-SUFFIX,xn--mnchen-3ya.example'));
});

it('audits malformed native domain candidates and removes an unsupported domainset', async t => {
  const directory = await makeDirectory(t);
  const malformed = 'DOMAIN-SUFFIX,-invalid.example';
  const initial = await makeOutput(directory, ['DOMAIN,exact.example', malformed]).write();
  const initialDomainsets = initial.outputs.filter(output => output.variant === 'domainset');
  assert.equal(initialDomainsets.length, 3);
  for (const entry of initialDomainsets) {
    assert.equal(entry.status, 'published');
    assert.equal(entry.routedConditionCount, 2);
    assert.equal(entry.effectiveConditionCount, 1);
    assert.equal(entry.drops.malformed, 1);
  }

  const invalid = await makeOutput(directory, [malformed]).write();
  const invalidDomainsets = invalid.outputs.filter(output => output.variant === 'domainset');
  assert.equal(invalidDomainsets.length, 3);
  await Promise.all(invalidDomainsets.map(async entry => {
    assert.equal(entry.status, 'absent-unsupported');
    assert.equal(entry.routedConditionCount, 1);
    assert.equal(entry.effectiveConditionCount, 0);
    assert.equal(entry.drops.malformed, 1);
    await assert.rejects(fs.access(path.join(directory, entry.path)), { code: 'ENOENT' });
  }));
  const classical = await fs.readFile(path.join(directory, 'List/non_ip/sample.list'), 'utf8');
  assert.deepEqual(textConditions(classical), [malformed]);
});

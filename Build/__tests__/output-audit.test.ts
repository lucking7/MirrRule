import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createSpan } from '../trace';
import { EnhancedFileOutput } from '../lib/enhanced-file-output';
import {
  countEffectiveConditions,
  RULE_OUTPUT_CONVERTER_VERSION,
  SOURCE_DELTA_ALERT_POLICY,
  toPublicSourceUrl,
  toSourceId,
  writeRuleOutputReports,
} from '../lib/output-audit';
import type { RulesetAuditRecord, SourceProvenance } from '../lib/output-audit';

const source: SourceProvenance = {
  configuredUrl: 'https://rules.example/list.conf',
  fallbackUrls: [],
  selectedUrl: 'https://rules.example/list.conf',
  selection: 'primary',
  fallbackIndex: null,
  viaProxy: false,
  responseAgeSeconds: null,
  rawContentSha256: null,
  rawLineCount: null,
};

async function publish(directory: string, id: string, rules: string[], date = '2026-01-01T00:00:00.000Z'): Promise<RulesetAuditRecord> {
  const output = new EnhancedFileOutput(createSpan(id), id, ['surge', 'clash', 'singbox', 'loon'], null, undefined, directory)
    .withTitle(id)
    .withDescription([`Generated ${date}`]);
  output.addRules(rules);
  return { ...(await output.write()), sources: [source] };
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}

interface DeltaReport {
  baseline: { configured: boolean; receiptId: string | null };
  summary: Record<string, number>;
  sources: Array<{
    rulesetId: string;
    status: string;
    baselineConditionCount: number | null;
    reason?: string;
    added: number | null;
    removed: number | null;
    rawInputChanged: boolean | null;
    semanticChanged: boolean | null;
    addedByType: Record<string, number>;
    removedByType: Record<string, number>;
    samples: { added: string[]; removed: string[] };
    warnings: string[];
  }>;
}

describe('output audit', () => {
  it('counts text conditions without banners and sing-box objects separately from matchers', () => {
    assert.deepEqual(countEffectiveConditions('surge-classical', [
      '# banner', 'DOMAIN,a.example', 'AND,((DOMAIN,b.example),(IP-CIDR,10.0.0.0/8))', '', '// note',
    ]), { effectiveConditionCount: 2 });
    assert.deepEqual(countEffectiveConditions('surge-domainset', ['.a.example', 'b.example']), { effectiveConditionCount: 2 });
    assert.deepEqual(countEffectiveConditions('singbox-json-v2', JSON.stringify({
      version: 2,
      rules: [{ domain: ['a.example', 'b.example'], domain_suffix: [], ip_cidr: ['10.0.0.0/8', '2001:db8::/32'] }],
    }).split('\n')), { effectiveConditionCount: 4, ruleObjectCount: 1 });
  });

  it('publishes only safe source identities', () => {
    assert.equal(toPublicSourceUrl('https://user:pass@rules.example/a.list?token=secret#x'), 'https://rules.example/a.list?[REDACTED]');
    assert.equal(toPublicSourceUrl('/Users/someone/private/rules.ts'), 'local-module');
    assert.equal(toPublicSourceUrl('file:///etc/rules.list'), 'local-module');
    assert.equal(toSourceId('streaming_!cn'), 'streaming_!cn');
    assert.equal(toSourceId('a/b'), 'a%2Fb');
  });

  it('records per-platform effective counts, digests and stages that reconcile with the written files', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-audit-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const record = await publish(directory, 'mixed', [
      'DOMAIN,a.example', 'DOMAIN,a.example', 'USER-AGENT,App*', 'IP-CIDR,10.0.0.0/25', 'IP-CIDR,10.0.0.128/25', 'IP-ASN,1',
    ]);
    await writeRuleOutputReports({
      outputRoot: directory, records: [record], generatedAt: '2026-01-01T00:00:00.000Z', baselineDir: null, baselineReceiptId: null,
    });
    const report = await readJson<{
      schemaVersion: number;
      converterVersion: string;
      rulesets: Array<{ id: string; stages: { canonicalCount: number }; sources: SourceProvenance[]; outputs: RulesetAuditRecord['outputs'] }>;
    }>(path.join(directory, 'Internal/rule-output-audit.json'));
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.converterVersion, RULE_OUTPUT_CONVERTER_VERSION);
    const [ruleset] = report.rulesets;
    assert.equal(ruleset.stages.canonicalCount, 4);
    assert.deepEqual(ruleset.sources, [source]);
    const merged = Object.fromEntries(ruleset.outputs.flatMap(entry => (entry.variant === 'merged' ? [[entry.platform, entry]] : [])));
    assert.equal(merged.surge.effectiveConditionCount, 4);
    assert.equal(merged.clash.effectiveConditionCount, 3);
    assert.equal(merged.loon.effectiveConditionCount, 4);
    assert.equal(merged.singbox.effectiveConditionCount, 2);
    assert.equal(merged.singbox.ruleObjectCount, 1);
    assert.deepEqual(merged.singbox.drops.unsupported, { 'USER-AGENT': 1, 'IP-ASN': 1 });
    for (const entry of ruleset.outputs.filter(candidate => candidate.status === 'published')) {
      assert.ok(!entry.path.includes('\\'));
      // eslint-disable-next-line no-await-in-loop -- verify each recorded digest against its file
      const data = await fs.readFile(path.join(directory, entry.path));
      assert.equal(entry.bytes, data.length);
      assert.match(entry.sha256 ?? '', /^[\da-f]{64}$/);
    }
    const snapshot = await readJson<{ conditions: string[]; schemaVersion: number }>(path.join(directory, 'Internal/source-snapshots/mixed.json'));
    assert.deepEqual(snapshot.conditions, ['DOMAIN,a.example', 'IP-ASN,1', 'IP-CIDR,10.0.0.0/24', 'USER-AGENT,App*']);
    const delta = await readJson<DeltaReport>(path.join(directory, 'Internal/source-delta.json'));
    assert.equal(delta.sources[0].status, 'baseline-unavailable');
    assert.equal(delta.sources[0].reason, 'baseline-not-configured');
    assert.deepEqual(delta.baseline, { configured: false, receiptId: null });
  });

  it('compares against an accepted baseline: banner-only is not semantic, modifiers and logic are', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-delta-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const baseline = path.join(root, 'baseline');
    const candidate = path.join(root, 'candidate');
    const baseRules = ['DOMAIN,a.example', 'IP-CIDR,192.0.2.0/24', 'AND,((DOMAIN,b.example),(DEST-PORT,443))'];
    await writeRuleOutputReports({
      outputRoot: baseline,
      records: [
        await publish(baseline, 'banner', ['# Updated yesterday', ...baseRules], '2026-01-01T00:00:00.000Z'),
        await publish(baseline, 'modifiers', baseRules),
        await publish(baseline, 'stale', ['DOMAIN,stale.example']),
      ],
      generatedAt: '2026-01-01T00:00:00.000Z',
      baselineDir: null,
      baselineReceiptId: null,
    });

    await writeRuleOutputReports({
      outputRoot: candidate,
      records: [
        await publish(candidate, 'banner', ['# Updated today', ...baseRules], '2026-01-02T00:00:00.000Z'),
        await publish(candidate, 'modifiers', ['DOMAIN,a.example', 'IP-CIDR,192.0.2.0/24,no-resolve', 'OR,((DOMAIN,b.example),(DEST-PORT,443))']),
        await publish(candidate, 'fresh', ['DOMAIN,fresh.example']),
      ],
      generatedAt: '2026-01-02T00:00:00.000Z',
      baselineDir: baseline,
      baselineReceiptId: 'receipt-1',
    });
    const delta = await readJson<DeltaReport>(path.join(candidate, 'Internal/source-delta.json'));
    assert.deepEqual(delta.baseline, { configured: true, receiptId: 'receipt-1' });
    const byId = Object.fromEntries(delta.sources.map(entry => [entry.rulesetId, entry]));
    assert.equal(byId.banner.status, 'compared');
    assert.equal(byId.banner.rawInputChanged, true);
    assert.equal(byId.banner.semanticChanged, false);
    assert.equal(byId.banner.added, 0);
    assert.equal(byId.banner.removed, 0);
    assert.equal(byId.modifiers.semanticChanged, true);
    assert.deepEqual(byId.modifiers.samples, {
      added: ['IP-CIDR,192.0.2.0/24,no-resolve', 'OR,((DOMAIN,b.example),(DEST-PORT,443))'],
      removed: ['AND,((DOMAIN,b.example),(DEST-PORT,443))', 'IP-CIDR,192.0.2.0/24'],
    });
    assert.deepEqual(byId.modifiers.addedByType, { 'IP-CIDR': 1, OR: 1 });
    assert.deepEqual(byId.modifiers.removedByType, { AND: 1, 'IP-CIDR': 1 });
    assert.equal(byId.stale.status, 'removed');
    assert.equal(byId.stale.baselineConditionCount, 1);
    assert.equal(byId.stale.removed, 1);
    assert.deepEqual(byId.stale.removedByType, { DOMAIN: 1 });
    assert.deepEqual(byId.stale.samples.removed, ['DOMAIN,stale.example']);
    assert.deepEqual(byId.stale.warnings, ['ruleset-removed']);
    assert.equal(delta.summary.removed, 1);
    assert.equal(delta.sources.at(-1)?.rulesetId, 'stale');
    assert.equal(byId.fresh.status, 'baseline-unavailable');
    assert.equal(byId.fresh.reason, 'snapshot-missing');
    assert.deepEqual((await fs.readdir(path.join(candidate, 'Internal/source-snapshots'))).sort(), ['banner.json', 'fresh.json', 'modifiers.json']);

    // Rebuilding the candidate from the old snapshot plus the delta recovers the new condition set.
    const oldSnapshot = await readJson<{ conditions: string[] }>(path.join(baseline, 'Internal/source-snapshots/modifiers.json'));
    const newSnapshot = await readJson<{ conditions: string[] }>(path.join(candidate, 'Internal/source-snapshots/modifiers.json'));
    const rebuilt = oldSnapshot.conditions
      .filter(condition => !byId.modifiers.samples.removed.includes(condition))
      .concat(byId.modifiers.samples.added)
      .sort();
    assert.deepEqual(rebuilt, newSnapshot.conditions);
  });

  it('marks schema and converter mismatches as not comparable and warns on large changes without failing', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-delta-mismatch-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const snapshots = path.join(root, 'baseline', 'Internal', 'source-snapshots');
    await fs.mkdir(snapshots, { recursive: true });
    const candidate = path.join(root, 'candidate');
    const many = Array.from({ length: 60 }, (_, index) => `DOMAIN,host${index}.example`);
    const records = [
      await publish(candidate, 'schema', ['DOMAIN,a.example']),
      await publish(candidate, 'converter', ['DOMAIN,a.example']),
      await publish(candidate, 'large', many),
      await publish(candidate, 'broken', ['DOMAIN,a.example']),
    ];
    const base = { sources: [], contextSha256: records[0].contextSha256, rawInputSha256: '', semanticSha256: '' };
    await fs.writeFile(path.join(snapshots, 'schema.json'), JSON.stringify({ ...base, schemaVersion: 99, converterVersion: RULE_OUTPUT_CONVERTER_VERSION, conditions: [] }));
    await fs.writeFile(path.join(snapshots, 'converter.json'), JSON.stringify({ ...base, schemaVersion: 1, converterVersion: 'old', conditions: [] }));
    await fs.writeFile(path.join(snapshots, 'large.json'), JSON.stringify({ ...base, schemaVersion: 1, converterVersion: RULE_OUTPUT_CONVERTER_VERSION, conditions: ['DOMAIN,old.example'] }));
    await fs.writeFile(path.join(snapshots, 'broken.json'), '{');
    const { warnings } = await writeRuleOutputReports({
      outputRoot: candidate, records, generatedAt: '2026-01-02T00:00:00.000Z', baselineDir: path.join(root, 'baseline'), baselineReceiptId: null,
    });
    const delta = await readJson<DeltaReport>(path.join(candidate, 'Internal/source-delta.json'));
    const byId = Object.fromEntries(delta.sources.map(entry => [entry.rulesetId, entry]));
    assert.equal(byId.schema.status, 'not-comparable');
    assert.equal(byId.schema.reason, 'schema-version-mismatch');
    assert.equal(byId.converter.reason, 'converter-version-mismatch');
    assert.equal(byId.broken.reason, 'snapshot-unreadable');
    assert.equal(byId.large.status, 'compared');
    assert.equal(byId.large.added, 60);
    assert.equal(byId.large.samples.added.length, SOURCE_DELTA_ALERT_POLICY.sampleLimit);
    assert.deepEqual(byId.large.warnings, ['change-ratio-exceeded']);
    assert.deepEqual(warnings, ['large: change-ratio-exceeded']);
    assert.equal(delta.summary.notComparable, 3);
  });

  it('reads an in-place baseline before replacing its snapshots', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-delta-inplace-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const options = { outputRoot: directory, generatedAt: '2026-01-01T00:00:00.000Z', baselineDir: directory, baselineReceiptId: null };
    await writeRuleOutputReports({
      ...options,
      records: [await publish(directory, 'inplace', ['DOMAIN,a.example']), await publish(directory, 'gone', ['DOMAIN,gone.example'])],
    });
    await writeRuleOutputReports({ ...options, records: [await publish(directory, 'inplace', ['DOMAIN,b.example'])] });
    assert.deepEqual(await fs.readdir(path.join(directory, 'Internal/source-snapshots')), ['inplace.json']);
    const delta = await readJson<DeltaReport>(path.join(directory, 'Internal/source-delta.json'));
    assert.equal(delta.sources[0].added, 1);
    assert.equal(delta.sources[0].removed, 1);
  });
});

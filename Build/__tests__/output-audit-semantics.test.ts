import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createSpan } from '../trace';
import { EnhancedFileOutput } from '../lib/enhanced-file-output';
import { recomputeSourceDeltaFromSnapshots, writeRuleOutputReports } from '../lib/output-audit';
import type { RulesetAuditRecord, SourceSnapshot } from '../lib/output-audit';
import type { SupportedPlatform } from '../lib/platform-config';

const PLATFORMS: SupportedPlatform[] = ['surge', 'clash', 'singbox', 'loon'];

interface DeltaReport {
  baseline: { receiptId: string | number | null };
  sources: Array<{
    semanticScope: string;
    semanticChanged: boolean | null;
    rawInputChanged: boolean | null;
    added: number | null;
    removed: number | null;
    samples: { added: string[]; removed: string[] };
    effectiveOutputs: Array<{
      platform: SupportedPlatform;
      status: string;
      reason?: string;
      semanticChanged: boolean | null;
      added: number | null;
      removed: number | null;
    }>;
  }>;
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await fs.readFile(filename, 'utf8')) as T;
}

async function build(directory: string, rules: string[], baselineDir: string | null = null): Promise<RulesetAuditRecord> {
  const output = new EnhancedFileOutput(createSpan('audit'), 'fixture', PLATFORMS, null, undefined, directory)
    .withTitle('fixture')
    .withDescription(['fixture']);
  output.addRules(rules);
  const audit: RulesetAuditRecord = { ...(await output.write()), sources: [] };
  assert.equal(audit.stages.canonicalCount, output.getOutputSummary().ruleCount);
  await writeRuleOutputReports({
    outputRoot: directory, records: [audit], generatedAt: '2026-10-11T00:00:00.000Z', baselineDir,
    baselineReceiptId: baselineDir ? 'accepted-1' : null,
  });
  return audit;
}

describe('normalized source and effective output audits', () => {
  it('reports keyword coverage without calling redundant upstream removal an effective output change', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-audit-semantics-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const baselineDir = path.join(root, 'baseline');
    const candidateDir = path.join(root, 'candidate');
    const baseline = await build(baselineDir, [
      'DOMAIN-KEYWORD,foo', 'DOMAIN,foo.exact', 'DOMAIN-SUFFIX,foo.suffix', 'DOMAIN-WILDCARD,*.foo.wild', 'DOMAIN,other.example',
    ]);
    const candidate = await build(candidateDir, ['DOMAIN-KEYWORD,foo', 'DOMAIN,other.example'], baselineDir);
    assert.equal(baseline.stages.canonicalCount, 5);
    assert.deepEqual(baseline.optimizations, [{
      reason: 'keyword-coverage', conditionCount: 3,
      byType: { DOMAIN: 1, 'DOMAIN-SUFFIX': 1, 'DOMAIN-WILDCARD': 1 },
      samples: ['DOMAIN,foo.exact', 'DOMAIN-SUFFIX,foo.suffix', 'DOMAIN-WILDCARD,*.foo.wild'].sort(),
    }]);
    assert.deepEqual(candidate.optimizations, []);
    const delta = (await readJson<DeltaReport>(path.join(candidateDir, 'Internal/source-delta.json'))).sources[0];
    assert.equal(delta.semanticScope, 'normalized-source');
    assert.equal(delta.semanticChanged, true);
    assert.equal(delta.removed, 3);
    assert.equal(delta.added, 0);
    assert.equal(delta.effectiveOutputs.length, 4);
    for (const output of delta.effectiveOutputs) {
      assert.equal(output.status, 'compared', output.platform);
      assert.equal(output.semanticChanged, false, output.platform);
      assert.equal(output.added, 0);
      assert.equal(output.removed, 0);
    }
    const snapshot = await readJson<SourceSnapshot>(path.join(candidateDir, 'Internal/source-snapshots/fixture.json'));
    assert.equal(snapshot.semanticScope, 'normalized-source');
    assert.equal(snapshot.effectiveOutputVersion, 1);
    assert.equal(snapshot.effectiveOutputs?.length, 4);
  });

  it('records domain-covered wildcards and bounds optimization examples', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-audit-coverage-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const record = await build(root, [
      'DOMAIN-SUFFIX,example.com', 'DOMAIN-WILDCARD,*.example.com', 'DOMAIN-KEYWORD,foo',
      ...Array.from({ length: 30 }, (_, index) => `DOMAIN,foo${index}.example`),
    ]);
    const keyword = record.optimizations.find(optimization => optimization.reason === 'keyword-coverage');
    assert.equal(keyword?.conditionCount, 30);
    assert.equal(keyword.samples.length, 20);
    assert.deepEqual(record.optimizations.find(optimization => optimization.reason === 'domain-coverage'), {
      reason: 'domain-coverage', conditionCount: 1,
      byType: { 'DOMAIN-WILDCARD': 1 }, samples: ['DOMAIN-WILDCARD,*.example.com'],
    });
  });

  it('distinguishes no-resolve changes by actual platform semantics and ignores date banners', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-audit-modifiers-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const baselineDir = path.join(root, 'baseline');
    const candidateDir = path.join(root, 'candidate');
    await build(baselineDir, ['# Yesterday', 'DOMAIN,a.example', 'IP-CIDR,192.0.2.0/24,no-resolve']);
    await build(candidateDir, ['# Today', 'DOMAIN,a.example', 'IP-CIDR,192.0.2.0/24'], baselineDir);
    const changed = (await readJson<DeltaReport>(path.join(candidateDir, 'Internal/source-delta.json'))).sources[0];
    assert.equal(changed.semanticChanged, true);
    for (const output of changed.effectiveOutputs) {
      assert.equal(output.semanticChanged, output.platform !== 'singbox', output.platform);
    }
    const bannerDir = path.join(root, 'banner');
    await build(bannerDir, ['# Tomorrow', 'DOMAIN,a.example', 'IP-CIDR,192.0.2.0/24,no-resolve'], baselineDir);
    const banner = (await readJson<DeltaReport>(path.join(bannerDir, 'Internal/source-delta.json'))).sources[0];
    assert.equal(banner.rawInputChanged, true);
    assert.equal(banner.semanticChanged, false);
    assert.ok(banner.effectiveOutputs.every(output => output.semanticChanged === false));
  });

  it('keeps old normalized source comparisons but declares missing effective baseline data', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-audit-old-snapshot-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const baselineDir = path.join(root, 'baseline');
    const candidateDir = path.join(root, 'candidate');
    await build(baselineDir, ['DOMAIN,a.example']);
    const filename = path.join(baselineDir, 'Internal/source-snapshots/fixture.json');
    const old = await readJson<SourceSnapshot>(filename);
    delete old.effectiveOutputVersion;
    delete old.effectiveOutputs;
    delete old.semanticScope;
    await fs.writeFile(filename, JSON.stringify(old));
    await build(candidateDir, ['DOMAIN,b.example'], baselineDir);
    const delta = (await readJson<DeltaReport>(path.join(candidateDir, 'Internal/source-delta.json'))).sources[0];
    assert.equal(delta.semanticChanged, true);
    assert.equal(delta.added, 1);
    assert.equal(delta.removed, 1);
    assert.equal(delta.effectiveOutputs.length, 4);
    assert.ok(delta.effectiveOutputs.every(output => output.status === 'not-comparable'
      && output.reason === 'effective-output-snapshot-missing' && output.semanticChanged === null));
  });

  it('rebases from snapshots only and projects retired platforms without changing normalized conditions', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-audit-rebase-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const baselineDir = path.join(root, 'baseline');
    const newerDir = path.join(root, 'newer');
    const candidateDir = path.join(root, 'candidate');
    await build(baselineDir, ['DOMAIN,a.example']);
    await build(newerDir, ['DOMAIN,c.example']);
    await build(candidateDir, ['DOMAIN,b.example'], baselineDir);
    const filename = path.join(candidateDir, 'Internal/source-snapshots/fixture.json');
    const snapshotBefore = await fs.readFile(filename, 'utf8');
    const flatBefore = await fs.readFile(path.join(candidateDir, 'List/fixture.list'), 'utf8');
    await recomputeSourceDeltaFromSnapshots(candidateDir, {
      baselineDir: newerDir, baselineReceiptId: 42, generatedAt: '2026-10-11T01:00:00.000Z',
    });
    assert.equal(await fs.readFile(filename, 'utf8'), snapshotBefore);
    assert.equal(await fs.readFile(path.join(candidateDir, 'List/fixture.list'), 'utf8'), flatBefore);
    const report = await readJson<DeltaReport>(path.join(candidateDir, 'Internal/source-delta.json'));
    assert.equal(report.baseline.receiptId, 42);
    assert.deepEqual(report.sources[0].samples, { added: ['DOMAIN,b.example'], removed: ['DOMAIN,c.example'] });
    const auditPath = path.join(candidateDir, 'Internal/rule-output-audit.json');
    const audit = await readJson<{ rulesets: Array<{ outputs: RulesetAuditRecord['outputs']; effectiveOutputs: Array<{ platform: SupportedPlatform }> }> }>(auditPath);
    audit.rulesets[0].outputs = audit.rulesets[0].outputs.filter(output => output.platform !== 'loon');
    audit.rulesets[0].effectiveOutputs = audit.rulesets[0].effectiveOutputs.filter(output => output.platform !== 'loon');
    await fs.writeFile(auditPath, JSON.stringify(audit));
    await recomputeSourceDeltaFromSnapshots(candidateDir, {
      baselineDir: newerDir, baselineReceiptId: 42, retiredOutputPaths: ['Loon/fixture.list'],
    });
    const snapshot = await readJson<SourceSnapshot>(filename);
    assert.deepEqual(snapshot.conditions, ['DOMAIN,b.example']);
    assert.equal(snapshot.effectiveOutputs?.length, 3);
    assert.equal(snapshot.semanticSha256, (JSON.parse(snapshotBefore) as SourceSnapshot).semanticSha256);
    const projected = (await readJson<DeltaReport>(path.join(candidateDir, 'Internal/source-delta.json'))).sources[0];
    assert.deepEqual(projected.effectiveOutputs.find(output => output.platform === 'loon'), {
      platform: 'loon', format: 'loon-classical', status: 'removed', semanticChanged: true,
      currentConditionCount: 0, baselineConditionCount: 1, added: 0, removed: 1,
      samples: { added: [], removed: ['DOMAIN,c.example'] },
    });
  });

  it('rejects missing or invalid current snapshots without replacing delta evidence', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-audit-invalid-current-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await build(root, ['DOMAIN,a.example']);
    const snapshotPath = path.join(root, 'Internal/source-snapshots/fixture.json');
    const snapshotText = await fs.readFile(snapshotPath, 'utf8');
    const deltaPath = path.join(root, 'Internal/source-delta.json');
    const deltaText = await fs.readFile(deltaPath, 'utf8');
    await fs.rm(snapshotPath);
    await assert.rejects(recomputeSourceDeltaFromSnapshots(root, { baselineDir: null, baselineReceiptId: null }), /snapshot missing/);
    assert.equal(await fs.readFile(deltaPath, 'utf8'), deltaText);
    const invalid = JSON.parse(snapshotText) as SourceSnapshot;
    invalid.conditions = [7] as unknown as string[];
    await fs.writeFile(snapshotPath, JSON.stringify(invalid));
    await assert.rejects(recomputeSourceDeltaFromSnapshots(root, { baselineDir: null, baselineReceiptId: null }), /Invalid current source snapshot/);
    assert.equal(await fs.readFile(deltaPath, 'utf8'), deltaText);
  });

  it('binds condition digests, exact inventory and effective snapshots to audited staged files', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-audit-bindings-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await build(root, ['DOMAIN,a.example']);
    const snapshotPath = path.join(root, 'Internal/source-snapshots/fixture.json');
    const original = await readJson<SourceSnapshot>(snapshotPath);
    const options = { baselineDir: null, baselineReceiptId: null };
    await fs.writeFile(snapshotPath, JSON.stringify({ ...original, conditions: ['DOMAIN,incorrect.example'] }));
    await assert.rejects(recomputeSourceDeltaFromSnapshots(root, options), /Invalid current source snapshot/);
    await fs.writeFile(snapshotPath, JSON.stringify({ ...original, rawInputSha256: '0'.repeat(64) }));
    await assert.rejects(recomputeSourceDeltaFromSnapshots(root, options), /does not match output audit/);
    await fs.writeFile(snapshotPath, JSON.stringify(original));
    await fs.writeFile(path.join(root, 'Internal/source-snapshots/extra.json'), JSON.stringify({ ...original, sourceId: 'extra', rulesetId: 'extra' }));
    await assert.rejects(recomputeSourceDeltaFromSnapshots(root, options), /inventory does not match/);
    await fs.rm(path.join(root, 'Internal/source-snapshots/extra.json'));
    const bodyPath = path.join(root, 'List/fixture.list');
    const body = await fs.readFile(bodyPath, 'utf8');
    await fs.writeFile(bodyPath, body.replace('DOMAIN,a.example', 'DOMAIN,incorrect.example'));
    await assert.rejects(recomputeSourceDeltaFromSnapshots(root, options), /does not match file/);
  });

  it('compares historical rollback snapshots by their own converter without relabeling them', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-audit-legacy-converter-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const baselineDir = path.join(root, 'baseline');
    const candidateDir = path.join(root, 'candidate');
    await build(baselineDir, ['DOMAIN,a.example']);
    await build(candidateDir, ['DOMAIN,b.example']);
    for (const directory of [baselineDir, candidateDir]) {
      const snapshotPath = path.join(directory, 'Internal/source-snapshots/fixture.json');
      // eslint-disable-next-line no-await-in-loop -- simulate each historical accepted tree
      const snapshot = await readJson<SourceSnapshot>(snapshotPath);
      snapshot.converterVersion = 'mirrrule-rule-output/1';
      delete snapshot.effectiveOutputVersion;
      delete snapshot.effectiveOutputs;
      // eslint-disable-next-line no-await-in-loop -- fixture persistence is sequential
      await fs.writeFile(snapshotPath, JSON.stringify(snapshot));
      const auditPath = path.join(directory, 'Internal/rule-output-audit.json');
      // eslint-disable-next-line no-await-in-loop -- simulate each historical accepted tree
      const audit = await readJson<{ converterVersion: string; rulesets: Array<{ effectiveOutputs?: unknown }> }>(auditPath);
      audit.converterVersion = 'mirrrule-rule-output/1';
      delete audit.rulesets[0].effectiveOutputs;
      // eslint-disable-next-line no-await-in-loop -- fixture persistence is sequential
      await fs.writeFile(auditPath, JSON.stringify(audit));
    }
    await recomputeSourceDeltaFromSnapshots(candidateDir, { baselineDir, baselineReceiptId: 10 });
    const delta = await readJson<DeltaReport & { converterVersion: string; toolConverterVersion: string }>(path.join(candidateDir, 'Internal/source-delta.json'));
    assert.equal(delta.converterVersion, 'mirrrule-rule-output/1');
    assert.equal(delta.toolConverterVersion, 'mirrrule-rule-output/2');
    assert.equal(delta.sources[0].semanticChanged, true);
    assert.equal(delta.sources[0].added, 1);
    assert.equal(delta.sources[0].removed, 1);
  });
});

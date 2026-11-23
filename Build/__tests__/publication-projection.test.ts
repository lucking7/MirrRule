import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { EnhancedFileOutput } from '../lib/enhanced-file-output';
import { writeRuleOutputReports, readSourceSnapshotFile, snapshotEffectiveOutput, writeSourceSnapshotFile } from '../lib/output-audit';
import type { RulesetAuditRecord } from '../lib/output-audit';
import type { SupportedPlatform } from '../lib/platform-config';
import type { ResolvedBaseline } from '../lib/publication-baseline';
import { computeCandidateId, hashFile, scanTree, sha256Hex } from '../lib/publication-manifest';
import { StageError, renderPublicInChild, stagePublication } from '../lib/publication-stage';
import { projectRetiredRuleOutputs } from '../lib/publication-projection';
import { collectAbsentPaths } from '../lib/publication-verify';
import { purgeRetiredArtifacts, retiredPublicPaths } from '../lib/artifact-lifecycle';
import { pruneStaleNativeDomainsets, readPublishedDomainsetPaths } from '../lib/publication-outputs';
import { createSpan } from '../trace';

const SOURCE = 'a'.repeat(40);
const OLD_COMMIT = 'b'.repeat(40);
const NEW_COMMIT = 'c'.repeat(40);
const BUILT_AT = '2026-10-11T00:00:00.000Z';
const PLATFORMS: SupportedPlatform[] = ['surge', 'clash', 'singbox', 'loon'];

async function json<T>(file: string): Promise<T> {
  return (file.endsWith('.json.gz') ? await readSourceSnapshotFile(file) : JSON.parse(await fs.readFile(file, 'utf8'))) as T;
}

async function fixture(
  root: string,
  records: Array<[string, string[], SupportedPlatform[]?]>,
  receiptId: number,
  historicalSurgeMerged = false
): Promise<void> {
  const audits: RulesetAuditRecord[] = [];
  for (const [id, rules, platforms = PLATFORMS] of records) {
    const output = new EnhancedFileOutput(createSpan(id), id, platforms, null, undefined, root).withTitle(id).withDescription(['fixture']);
    output.addRules(rules);
    // eslint-disable-next-line no-await-in-loop -- fixture publication keeps its own audit with the written files
    const audit = await output.write();
    if (historicalSurgeMerged) {
      const parts = audit.outputs.filter(file => file.platform === 'surge' && /\/(?:non_ip|ip)\/[^/]+\.list$/.test(file.path));
      // eslint-disable-next-line no-await-in-loop -- each historical audit binds its own split parts
      const bodies = await Promise.all(parts.flatMap(file => (
        file.status === 'published' ? [fs.readFile(path.join(root, file.path), 'utf8')] : []
      )));
      const relative = `List/${id}.list`;
      const body = bodies.join('') || '# Empty historical merged ruleset\n';
      // eslint-disable-next-line no-await-in-loop -- the directory may have no published variants
      await fs.mkdir(path.join(root, 'List'), { recursive: true });
      // eslint-disable-next-line no-await-in-loop -- reproduce a receipt from before Surge merged URLs were retired
      await fs.writeFile(path.join(root, relative), body);
      const snapshot = snapshotEffectiveOutput('surge', parts[0].format, body.split('\n'));
      const count = snapshot.conditions.length;
      audit.outputs.push({ ...parts[0], variant: 'merged', path: relative, status: 'published', reason: undefined, routedConditionCount: count, effectiveConditionCount: count, bytes: Buffer.byteLength(body), sha256: sha256Hex(body) });
      audit.effectiveOutputs = [snapshot, ...audit.effectiveOutputs.filter(value => value.platform !== 'surge')];
    }
    audits.push({ ...audit, sources: [] });
  }
  await writeRuleOutputReports({ outputRoot: root, records: audits, generatedAt: BUILT_AT, baselineDir: null, baselineReceiptId: receiptId });
  await fs.mkdir(path.join(root, 'GeoIP'), { recursive: true });
  await fs.writeFile(path.join(root, 'GeoIP/fixture.mmdb'), 'fixture');
  await fs.writeFile(path.join(root, 'Internal/rule-coverage.json'), '{}\n');
  await fs.writeFile(path.join(root, 'status.json'), JSON.stringify({ buildTime: BUILT_AT, commit: SOURCE, rulesets: audits.map(record => ({ id: record.id, platforms: record.platforms, ruleCount: record.stages.canonicalCount, lastSuccess: BUILT_AT })) }));
}

async function baseline(tree: string, id: number): Promise<ResolvedBaseline> {
  const files = await scanTree(tree);
  return { receiptId: id, kind: 'manifest', deployCommit: NEW_COMMIT, sourceCommit: SOURCE, candidateId: computeCandidateId(files), generatedAt: '2026-10-10T00:00:00.000Z', originalCandidateId: null, files: files.map(file => ({ path: file.path, sha256: file.sha256 })) };
}

async function environment(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-projection-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { candidate: path.join(root, 'candidate'), tree: path.join(root, 'baseline'), out: path.join(root, 'staging') };
}

interface ProjectionAudit {
  rulesets: Array<{ id: string; platforms: string[]; outputs: Array<{ path: string }>; effectiveOutputs: Array<{ platform: string }> }>;
  retiredOutputs: Array<{ path: string; rulesetId: string; lifecycleId: string }>;
}
interface Snapshot { conditions: string[]; effectiveOutputs: Array<{ platform: string }> }
interface Delta { baseline: { receiptId: number }; sources: Array<{ rulesetId: string; status: string; added: number; removed: number; samples: { added: string[]; removed: string[] } }> }

describe('publication lifecycle projection and baseline rebase', () => {
  it('rolls back historical split subscriptions and other platforms without restoring retired Surge merged URLs', async t => {
    const env = await environment(t);
    await fixture(env.candidate, [['keep', ['DOMAIN,keep.example', 'IP-CIDR,192.0.2.0/24']], ['discord', ['DOMAIN,discord.example', 'IP-CIDR,203.0.113.0/24']]], 1, true);
    await fs.writeFile(path.join(env.candidate, '_worker.js'), 'stale worker');
    await fs.writeFile(path.join(env.candidate, '_routes.json'), '{}');
    await fs.cp(env.candidate, env.tree, { recursive: true });
    const result = await stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['rollback'], sourceCommit: SOURCE, baseline: await baseline(env.tree, 2), baselineTreeDir: env.tree, rollbackOf: { receiptId: 1, deployCommit: OLD_COMMIT, sourceCommit: SOURCE }, render: renderPublicInChild });
    const audit = await json<ProjectionAudit>(path.join(env.out, 'Internal/rule-output-audit.json'));
    assert.deepEqual(audit.rulesets.map(record => record.id), ['keep']);
    assert.equal(audit.retiredOutputs.length, 18);
    assert.deepEqual(audit.retiredOutputs.flatMap(output => (output.lifecycleId === 'variant:surge-merged' ? [output.path] : [])), ['List/discord.list', 'List/keep.list']);
    assert.ok(audit.retiredOutputs.filter(output => output.lifecycleId !== 'variant:surge-merged').every(output => output.lifecycleId === 'ruleset:discord'));
    assert.ok(audit.rulesets[0].effectiveOutputs.some(output => output.platform === 'surge'));
    assert.ok(result.manifest.retiredRemoved.includes('List/non_ip/discord.list'));
    assert.ok(result.manifest.retiredRemoved.includes('List/non_ip/discord.conf'));
    assert.ok(result.manifest.retiredRemoved.includes('Clash/domainset/discord.txt'));
    assert.ok(result.manifest.retiredRemoved.includes('sing-box/ip/discord.json'));
    await assert.rejects(fs.access(path.join(env.out, 'Internal/source-snapshots/discord.json.gz')));
    const delta = await json<Delta>(path.join(env.out, 'Internal/source-delta.json'));
    const removed = delta.sources.find(source => source.rulesetId === 'discord');
    assert.equal(removed?.status, 'removed');
    assert.equal(removed?.removed, 2);
    assert.equal(delta.baseline.receiptId, 2);
    const status = await json<{ rulesets: Array<{ id: string }> }>(path.join(env.out, 'status.json'));
    assert.deepEqual(status.rulesets.map(record => record.id), ['keep']);
    const absent = await collectAbsentPaths(env.out, result.manifest);
    assert.ok(absent.includes('List/non_ip/discord.list'));
    // Retired directories are probed on every run, not only when the baseline still listed files.
    assert.ok(absent.includes('Loon/domainset/nrrule-retired-probe'));
    assert.ok(absent.includes('List/domainset/nrrule-retired-probe.list'));
    assert.ok(absent.includes('List/nrrule-retired-probe.list'));
    assert.ok(absent.includes('List/domainset/nrrule-absent-probe.list'));
    assert.ok(absent.includes('List/domainset/discord.conf'));
    assert.ok(absent.includes('List/keep.list'));
    const manifestFiles = new Map(result.manifest.files.map(file => [file.path, file]));
    assert.ok(manifestFiles.has('List/domainset/keep.conf'));
    assert.ok(manifestFiles.has('Clash/domainset/keep.txt'));
    assert.ok(manifestFiles.has('sing-box/domainset/keep.json'));
    assert.ok(manifestFiles.has('Clash/keep.txt'));
    assert.ok(manifestFiles.has('List/ip/keep.conf'));
    assert.ok(!manifestFiles.has('List/keep.list'));
    assert.equal(manifestFiles.get('List/non_ip/keep.conf')?.sha256, manifestFiles.get('List/non_ip/keep.list')?.sha256);
    const index = await fs.readFile(path.join(env.out, 'index.html'), 'utf8');
    assert.match(index, /href="\/List\/domainset\/keep\.conf"/);
    assert.doesNotMatch(index, /href="\/List\/keep\.list"/);
    assert.equal(result.manifest.files.find(file => file.path === 'Internal/rule-output-audit.json')?.origin, 'generated');
    assert.equal(result.manifest.files.find(file => file.path === 'Internal/source-snapshots/keep.json.gz')?.origin, 'preserved');
    for (const relative of ['_worker.js', '_routes.json']) {
      assert.equal(result.manifest.files.find(file => file.path === relative)?.origin, 'generated');
    }
    const worker = await fs.readFile(path.join(env.out, '_worker.js'), 'utf8');
    assert.ok(worker.includes('keep.json.gz'));
    assert.equal(worker.includes('discord.json.gz'), false);
    const routes = await json<{ include: string[]; exclude: string[] }>(path.join(env.out, '_routes.json'));
    const routed = [
      'Clash/domainset/', 'Clash/ip/', 'Clash/non_ip/',
      'Loon/ip/', 'Loon/non_ip/', 'Mirror/', 'sing-box/domainset/', 'sing-box/ip/', 'sing-box/non_ip/',
      'Loon/domainset/', 'List/',
    ];
    assert.deepEqual(routes.include, [
      '/Internal/*',
      ...routed.map(prefix => `/${prefix}*`),
      ...[...new Set(retiredPublicPaths())].sort().flatMap(relative => (
        routed.some(prefix => relative.startsWith(prefix)) ? [] : ['/' + relative.split('/').map(encodeURIComponent).join('/')]
      )),
    ]);
    assert.deepEqual(routes.exclude, []);
    assert.ok((await json<ProjectionAudit>(path.join(env.candidate, 'Internal/rule-output-audit.json'))).rulesets.some(record => record.id === 'discord'));
  });

  it('projects empty historical Surge metadata when the only published output was retired', async t => {
    const env = await environment(t);
    await fixture(env.candidate, [['empty', [], ['surge']], ['keep', ['DOMAIN,keep.example']]], 1, true);
    const result = await stagePublication({
      candidateDir: env.candidate,
      outDir: env.out,
      tasks: ['rollback'],
      sourceCommit: SOURCE,
      baseline: null,
      baselineTreeDir: null,
      rollbackOf: { receiptId: 1, deployCommit: OLD_COMMIT, sourceCommit: SOURCE },
      render: renderPublicInChild,
    });
    const audit = await json<ProjectionAudit>(path.join(env.out, 'Internal/rule-output-audit.json'));
    assert.deepEqual(audit.rulesets.find(ruleset => ruleset.id === 'empty')?.effectiveOutputs, []);
    assert.ok(audit.retiredOutputs.some(output => output.path === 'List/empty.list'));
    const snapshot = await json<Snapshot>(path.join(env.out, 'Internal/source-snapshots/empty.json.gz'));
    assert.deepEqual(snapshot.effectiveOutputs, []);
    const absent = await collectAbsentPaths(env.out, result.manifest);
    for (const relative of ['List/empty.list', 'List/non_ip/empty.list', 'List/ip/empty.list']) assert.ok(absent.includes(relative), relative);
  });

  it('refuses to roll back a ruleset whose historical split used the retired domainset variant', async t => {
    const env = await environment(t);
    await fixture(env.candidate, [['keep', ['DOMAIN,keep.example', 'USER-AGENT,Keep*']]], 1);
    // Before 2026-10-17 plain domains lived only in domainset, so historical non_ip lacks them.
    const auditPath = path.join(env.candidate, 'Internal/rule-output-audit.json');
    const audit = await json<{ layoutVersion?: string, rulesets: Array<{ id: string, outputs: Array<Record<string, unknown>> }> }>(auditPath);
    delete audit.layoutVersion;
    const relative = 'Clash/domainset/keep.txt';
    const content = 'DOMAIN,keep.example\n';
    await fs.mkdir(path.join(env.candidate, 'Clash/domainset'), { recursive: true });
    await fs.writeFile(path.join(env.candidate, relative), content);
    audit.rulesets[0].outputs = audit.rulesets[0].outputs.filter(output => output.variant !== 'domainset');
    audit.rulesets[0].outputs.push({ platform: 'clash', variant: 'domainset', format: 'clash-classical', path: relative, status: 'published', bytes: new TextEncoder().encode(content).length, sha256: sha256Hex(content) });
    await fs.writeFile(auditPath, JSON.stringify(audit));
    await fs.cp(env.candidate, env.tree, { recursive: true });
    await assert.rejects(
      stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['rollback'], sourceCommit: SOURCE, baseline: await baseline(env.tree, 2), baselineTreeDir: env.tree, rollbackOf: { receiptId: 1, deployCommit: OLD_COMMIT, sourceCommit: SOURCE }, render: renderPublicInChild }),
      /retired domainset variant layout/
    );
  });

  it('rejects unaudited and obsolete paths under a current domainset directory', async t => {
    const env = await environment(t);
    await fixture(env.candidate, [['keep', ['DOMAIN,keep.example']]], 1);
    const auditPath = path.join(env.candidate, 'Internal/rule-output-audit.json');
    const audit = await json<{ rulesets: Array<{ outputs: Array<Record<string, unknown>> }> }>(auditPath);
    const obsolete = 'List/domainset/keep.list';
    await fs.copyFile(path.join(env.candidate, 'List/domainset/keep.conf'), path.join(env.candidate, obsolete));
    await fixture(env.tree, [['keep', ['DOMAIN,previous.example']]], 1);
    const stage = async () => stagePublication({
      candidateDir: env.candidate,
      outDir: env.out,
      tasks: ['build'],
      sourceCommit: SOURCE,
      baseline: await baseline(env.tree, 1),
      baselineTreeDir: env.tree,
      render: renderPublicInChild,
    });
    await assert.rejects(stage(), /List\/domainset\/keep\.list: variant file is not listed in the audit/);
    const native = audit.rulesets[0].outputs.find(output => output.path === 'List/domainset/keep.conf');
    assert.ok(native);
    audit.rulesets[0].outputs.push({ ...native, path: obsolete });
    await fs.writeFile(auditPath, JSON.stringify(audit));
    await assert.rejects(stage(), /invalid domainset subscription.*List\/domainset\/keep\.list/);
  });

  it('cleans obsolete managed domainsets after a fresh rules audit and leaves audited corruption detectable', async t => {
    const env = await environment(t);
    await fixture(env.candidate, [['keep', ['DOMAIN,keep.example']]], 1);
    const staleSurge = 'List/domainset/keep.list';
    const staleClash = 'Clash/domainset/old.txt';
    const staleSingBox = 'sing-box/domainset/old.json';
    const unrelated = 'Clash/domainset/notes.md';
    await Promise.all([staleSurge, staleClash, staleSingBox, unrelated].map(relative => (
      fs.writeFile(path.join(env.candidate, relative), 'old')
    )));
    const native = 'Clash/domainset/keep.txt';
    await fs.writeFile(path.join(env.candidate, native), 'DOMAIN-SUFFIX,keep.example');

    assert.deepEqual(await pruneStaleNativeDomainsets(env.candidate), [staleClash, staleSingBox]);
    assert.deepEqual(await purgeRetiredArtifacts(env.candidate), [staleSurge]);
    assert.deepEqual([...(await readPublishedDomainsetPaths(env.candidate))].sort(), [
      'List/domainset/keep.conf', 'sing-box/domainset/keep.json',
    ]);
    assert.equal(await fs.readFile(path.join(env.candidate, native), 'utf8'), 'DOMAIN-SUFFIX,keep.example');
    assert.equal(await fs.readFile(path.join(env.candidate, unrelated), 'utf8'), 'old');
  });

  it('projects partial platform retirement in the audit and snapshot while preserving normalized conditions and active platforms', async t => {
    const env = await environment(t);
    await fixture(env.candidate, [['keep', ['DOMAIN,keep.example']], ['china_asn', ['DOMAIN,asn.example', 'IP-ASN,1']]], 1);
    await fs.cp(env.candidate, env.tree, { recursive: true });
    const before = await json<Snapshot>(path.join(env.candidate, 'Internal/source-snapshots/china_asn.json.gz'));
    const result = await stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['rollback'], sourceCommit: SOURCE, baseline: await baseline(env.tree, 2), baselineTreeDir: env.tree, rollbackOf: { receiptId: 1, deployCommit: OLD_COMMIT, sourceCommit: SOURCE }, render: renderPublicInChild });
    const audit = await json<ProjectionAudit>(path.join(env.out, 'Internal/rule-output-audit.json'));
    const record = audit.rulesets.find(ruleset => ruleset.id === 'china_asn');
    assert.ok(record);
    assert.ok(record.outputs.every(output => !output.path.startsWith('sing-box/')));
    assert.ok(record.effectiveOutputs.every(output => output.platform !== 'singbox'));
    assert.ok(!record.platforms.includes('singbox'));
    const after = await json<Snapshot>(path.join(env.out, 'Internal/source-snapshots/china_asn.json.gz'));
    assert.deepEqual(after.conditions, before.conditions);
    assert.deepEqual(after.effectiveOutputs.map(output => output.platform).sort(), ['clash', 'loon', 'surge']);
    assert.equal(result.manifest.files.find(file => file.path === 'Internal/source-snapshots/china_asn.json.gz')?.origin, 'generated');
    await fs.access(path.join(env.out, 'List/ip/china_asn.list'));
    await assert.rejects(fs.access(path.join(env.out, 'sing-box/non_ip/china_asn.json')));
  });

  it('rebases downloaded snapshots and restored optional files to the current accepted tree, without mutating candidate rules', async t => {
    const env = await environment(t);
    await fixture(env.candidate, [['keep', ['DOMAIN,current.example']]], 1);
    await fixture(env.tree, [['keep', ['DOMAIN,latest.example']]], 2);
    for (const root of [env.candidate, env.tree]) {
      // eslint-disable-next-line no-await-in-loop -- optional directory fixture
      await fs.mkdir(path.join(root, 'Modules/Converted'), { recursive: true });
      // eslint-disable-next-line no-await-in-loop -- optional directory fixture
      await fs.mkdir(path.join(root, 'Scripts'), { recursive: true });
    }
    const modulePath = 'Modules/Converted/restored.sgmodule';
    await fs.writeFile(path.join(env.candidate, modulePath), '#!name=old restored\n');
    await fs.writeFile(path.join(env.tree, modulePath), '#!name=latest accepted\n');
    await fs.writeFile(path.join(env.candidate, 'Scripts/fresh.js'), 'fresh');
    const restored = await hashFile(path.join(env.candidate, modulePath));
    await fs.writeFile(path.join(env.candidate, 'Internal/preserved-artifacts.json'), JSON.stringify({ schemaVersion: 1, fromCommit: OLD_COMMIT, files: [{ path: modulePath, ...restored }] }));
    const before = await hashFile(path.join(env.candidate, 'List/non_ip/keep.list'));
    const result = await stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['build', 'deploy', 'convert-plugins'], sourceCommit: SOURCE, baseline: await baseline(env.tree, 2), baselineTreeDir: env.tree, render: renderPublicInChild });
    const delta = await json<Delta>(path.join(env.out, 'Internal/source-delta.json'));
    assert.equal(delta.baseline.receiptId, 2);
    const keep = delta.sources.find(source => source.rulesetId === 'keep');
    assert.deepEqual(keep?.samples, { added: ['DOMAIN,current.example'], removed: ['DOMAIN,latest.example'] });
    assert.equal(keep?.added, 1);
    assert.equal(keep?.removed, 1);
    assert.deepEqual(await hashFile(path.join(env.out, 'List/non_ip/keep.list')), before);
    assert.deepEqual(await hashFile(path.join(env.candidate, 'List/non_ip/keep.list')), before);
    assert.equal(await fs.readFile(path.join(env.out, modulePath), 'utf8'), '#!name=latest accepted\n');
    assert.equal(result.manifest.files.find(file => file.path === modulePath)?.preservedFromCommit, NEW_COMMIT);
    assert.equal(result.manifest.baselineReceiptId, 2);
    assert.ok((await fs.readFile(path.join(env.out, 'index.html'), 'utf8')).includes('Modules/Converted/restored.sgmodule'));
  });

  it('drops obsolete verified restored files on drift and refuses dangling retained module dependencies', async t => {
    for (const referenced of [false, true]) {
      // eslint-disable-next-line no-await-in-loop -- exercise unreferenced removal and a real script dependency separately
      const env = await environment(t);
      // eslint-disable-next-line no-await-in-loop -- each scenario owns an independent candidate
      await fixture(env.candidate, [['keep', ['DOMAIN,current.example']]], 1);
      // eslint-disable-next-line no-await-in-loop -- latest accepted baseline no longer contains the optional script
      await fixture(env.tree, [['keep', ['DOMAIN,latest.example']]], 2);
      // eslint-disable-next-line no-await-in-loop -- optional directory fixture
      await fs.mkdir(path.join(env.candidate, 'Modules/Converted'), { recursive: true });
      // eslint-disable-next-line no-await-in-loop -- optional directory fixture
      await fs.mkdir(path.join(env.candidate, 'Scripts'), { recursive: true });
      const obsolete = 'Scripts/obsolete.js';
      // eslint-disable-next-line no-await-in-loop -- exact restored file fixture
      await fs.writeFile(path.join(env.candidate, obsolete), 'old script');
      // eslint-disable-next-line no-await-in-loop -- this module remains fresh after rebase
      await fs.writeFile(path.join(env.candidate, 'Modules/Converted/fresh.sgmodule'), referenced ? '[Script]\nrun=type=http-response,script-path=https://nrrule.pages.dev/Scripts/obsolete.js' : '#!name=fresh\n[Rule]\nDOMAIN,keep.example,DIRECT');
      // eslint-disable-next-line no-await-in-loop -- keep the refreshed script directory nonempty
      await fs.writeFile(path.join(env.candidate, 'Scripts/fresh.js'), 'fresh');
      // eslint-disable-next-line no-await-in-loop -- bind restoration provenance to exact original bytes
      const digest = await hashFile(path.join(env.candidate, obsolete));
      // eslint-disable-next-line no-await-in-loop -- restoration record is synthetic but follows the real schema
      await fs.writeFile(path.join(env.candidate, 'Internal/preserved-artifacts.json'), JSON.stringify({ schemaVersion: 1, fromCommit: OLD_COMMIT, files: [{ path: obsolete, ...digest }] }));
      // eslint-disable-next-line no-await-in-loop -- baseline is captured before stage mutates its isolated output
      const accepted = await baseline(env.tree, 2);
      const run = stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['build', 'deploy', 'convert-plugins'], sourceCommit: SOURCE, baseline: accepted, baselineTreeDir: env.tree, render: renderPublicInChild });
      if (referenced) {
        // eslint-disable-next-line no-await-in-loop -- dangling dependency blocks only this candidate
        await assert.rejects(run, error => error instanceof StageError && error.code === 'provenance-mismatch' && error.message.includes('references removed restored Scripts/obsolete.js'));
      } else {
        // eslint-disable-next-line no-await-in-loop -- unreferenced obsolete artifact is removed without another download
        const result = await run;
        assert.ok(result.manifest.removedPaths.includes(obsolete));
        // eslint-disable-next-line no-await-in-loop -- removed output must not survive in staging
        await assert.rejects(fs.access(path.join(env.out, obsolete)));
        // eslint-disable-next-line no-await-in-loop -- original candidate is immutable
        assert.equal(await fs.readFile(path.join(env.candidate, obsolete), 'utf8'), 'old script');
      }
    }
  });

  it('refuses overlapping and symlink-aliased output trees before touching input sentinels', async t => {
    const env = await environment(t);
    await fs.mkdir(env.candidate, { recursive: true });
    await fs.mkdir(env.tree, { recursive: true });
    await fs.writeFile(path.join(env.candidate, 'sentinel'), 'candidate stays');
    await fs.writeFile(path.join(env.tree, 'sentinel'), 'baseline stays');
    const alias = path.join(path.dirname(env.candidate), 'candidate-alias');
    await fs.symlink(env.candidate, alias, 'dir');
    for (const outDir of [env.candidate, path.dirname(env.candidate), path.join(env.candidate, 'nested'), env.tree, path.join(env.tree, 'nested'), alias, path.join(alias, 'missing/nested')]) {
      // eslint-disable-next-line no-await-in-loop -- each unsafe path must fail before the first filesystem mutation
      await assert.rejects(stagePublication({ candidateDir: env.candidate, outDir, tasks: ['build'], sourceCommit: SOURCE, baseline: null, baselineTreeDir: env.tree, render: renderPublicInChild }), error => error instanceof StageError && error.code === 'unsafe-directory');
      // eslint-disable-next-line no-await-in-loop -- candidate sentinel proves that rm did not run
      assert.equal(await fs.readFile(path.join(env.candidate, 'sentinel'), 'utf8'), 'candidate stays');
      // eslint-disable-next-line no-await-in-loop -- accepted baseline sentinel proves it was not removed either
      assert.equal(await fs.readFile(path.join(env.tree, 'sentinel'), 'utf8'), 'baseline stays');
    }
  });

  it('rejects the filesystem root before calling rm', async t => {
    const env = await environment(t);
    await fs.mkdir(env.candidate, { recursive: true });
    await fs.writeFile(path.join(env.candidate, 'sentinel'), 'unchanged');
    const originalRm = fs.rm;
    let rmCalls = 0;
    fs.rm = () => {
      rmCalls++;
      return Promise.reject(new Error('unsafe rm attempted; intercepted by test'));
    };
    try {
      await assert.rejects(stagePublication({ candidateDir: env.candidate, outDir: path.parse(env.candidate).root, tasks: ['build'], sourceCommit: SOURCE, baseline: null, baselineTreeDir: null, render: renderPublicInChild }), error => error instanceof StageError && error.code === 'unsafe-directory');
      assert.equal(rmCalls, 0);
      assert.equal(await fs.readFile(path.join(env.candidate, 'sentinel'), 'utf8'), 'unchanged');
    } finally {
      fs.rm = originalRm;
    }
  });

  it('restores newly required mirrored scripts from accepted bytes and preserves fresh scripts', async t => {
    for (const mode of ['restore', 'fresh', 'missing'] as const) {
      // eslint-disable-next-line no-await-in-loop -- each mode has isolated files and baseline evidence
      const env = await environment(t);
      // eslint-disable-next-line no-await-in-loop -- candidate is built against the old receipt
      await fixture(env.candidate, [['keep', ['DOMAIN,current.example']]], 1);
      // eslint-disable-next-line no-await-in-loop -- newer accepted tree has changed optional module dependencies
      await fixture(env.tree, [['keep', ['DOMAIN,latest.example']]], 2);
      for (const root of [env.candidate, env.tree]) {
        // eslint-disable-next-line no-await-in-loop -- optional fixture directories
        await fs.mkdir(path.join(root, 'Modules/Converted'), { recursive: true });
        // eslint-disable-next-line no-await-in-loop -- optional fixture directories
        await fs.mkdir(path.join(root, 'Scripts'), { recursive: true });
      }
      const modulePath = 'Modules/Converted/restored.sgmodule';
      // eslint-disable-next-line no-await-in-loop -- old optional artifact has no mirrored dependency
      await fs.writeFile(path.join(env.candidate, modulePath), '#!name=old module');
      // eslint-disable-next-line no-await-in-loop -- newly accepted module requires this owned script
      await fs.writeFile(path.join(env.tree, modulePath), '[Script]\nrun=type=http-response,script-path=https://nrrule.pages.dev/Scripts/new.js');
      // eslint-disable-next-line no-await-in-loop -- refreshed directory remains nonempty
      await fs.writeFile(path.join(env.candidate, 'Scripts/fresh.js'), 'fresh');
      // eslint-disable-next-line no-await-in-loop -- current module is bound to its restoration bytes
      const digest = await hashFile(path.join(env.candidate, modulePath));
      // eslint-disable-next-line no-await-in-loop -- restoration provenance identifies the exact optional file
      await fs.writeFile(path.join(env.candidate, 'Internal/preserved-artifacts.json'), JSON.stringify({ schemaVersion: 1, fromCommit: OLD_COMMIT, files: [{ path: modulePath, ...digest }] }));
      // eslint-disable-next-line no-await-in-loop -- only an accepted script may fill a missing file
      if (mode !== 'missing') await fs.writeFile(path.join(env.tree, 'Scripts/new.js'), 'accepted new script');
      // eslint-disable-next-line no-await-in-loop -- a fresh script must not be overwritten
      if (mode === 'fresh') await fs.writeFile(path.join(env.candidate, 'Scripts/new.js'), 'fresh new script');
      // eslint-disable-next-line no-await-in-loop -- freeze evidence after all latest-tree files are present
      const accepted = await baseline(env.tree, 2);
      const run = stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['build', 'deploy', 'convert-plugins'], sourceCommit: SOURCE, baseline: accepted, baselineTreeDir: env.tree, render: renderPublicInChild });
      if (mode === 'missing') {
        // eslint-disable-next-line no-await-in-loop -- unverified dependencies block publication
        await assert.rejects(run, error => error instanceof StageError && error.code === 'provenance-mismatch' && error.message.includes('references missing Scripts/new.js'));
      } else {
        // eslint-disable-next-line no-await-in-loop -- verified missing dependency is added without a download
        const result = await run;
        // eslint-disable-next-line no-await-in-loop -- assert actual dependency bytes, not just manifest presence
        assert.equal(await fs.readFile(path.join(env.out, 'Scripts/new.js'), 'utf8'), mode === 'restore' ? 'accepted new script' : 'fresh new script');
        const entry = result.manifest.files.find(file => file.path === 'Scripts/new.js');
        assert.equal(entry?.origin, mode === 'restore' ? 'preserved' : 'generated');
        if (mode === 'restore') assert.equal(entry?.preservedFromCommit, NEW_COMMIT);
      }
    }
  });

  it('rejects corrupted original output digests before retirement projection can hide the mismatch', async t => {
    const env = await environment(t);
    await fixture(env.candidate, [['keep', ['DOMAIN,keep.example']], ['discord', ['DOMAIN,discord.example']]], 1, true);
    await fs.writeFile(path.join(env.candidate, 'List/discord.list'), 'tampered');
    await assert.rejects(stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['rollback'], sourceCommit: SOURCE, baseline: null, baselineTreeDir: null, rollbackOf: { receiptId: 1, deployCommit: OLD_COMMIT, sourceCommit: SOURCE }, render: renderPublicInChild }), error => error instanceof StageError && error.code === 'output-mismatch');
  });

  it('rejects malformed snapshots during rebase instead of reporting invented deltas', async t => {
    const env = await environment(t);
    await fixture(env.candidate, [['keep', ['DOMAIN,keep.example']]], 1);
    await fixture(env.tree, [['keep', ['DOMAIN,baseline.example']]], 2);
    await writeSourceSnapshotFile(path.join(env.candidate, 'Internal/source-snapshots/keep.json.gz'), { conditions: ['invented'] });
    await assert.rejects(stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['build', 'deploy'], sourceCommit: SOURCE, baseline: await baseline(env.tree, 2), baselineTreeDir: env.tree, render: renderPublicInChild }), error => error instanceof StageError && error.code === 'invalid-report');
    assert.deepEqual(await readSourceSnapshotFile(path.join(env.candidate, 'Internal/source-snapshots/keep.json.gz')), { conditions: ['invented'] });
  });

  it('retires a historical plain snapshot and rejects a second encoding before projection', async t => {
    const env = await environment(t);
    await fixture(env.candidate, [['discord', ['DOMAIN,discord.example']]], 1);
    const compressed = path.join(env.candidate, 'Internal/source-snapshots/discord.json.gz');
    const plain = compressed.slice(0, -3);
    await writeSourceSnapshotFile(plain, await readSourceSnapshotFile(compressed));
    await assert.rejects(projectRetiredRuleOutputs(env.candidate), /Duplicate source snapshot encodings/);
    await fs.rm(compressed);
    const auditPath = path.join(env.candidate, 'Internal/rule-output-audit.json');
    const audit = await json<{ rulesets: Array<{ snapshotPath: string }> }>(auditPath);
    audit.rulesets[0].snapshotPath = 'Internal/source-snapshots/discord.json';
    await fs.writeFile(auditPath, JSON.stringify(audit));
    const result = await projectRetiredRuleOutputs(env.candidate);
    assert.equal(result.changed, true);
    await assert.rejects(fs.access(plain));
    assert.deepEqual((await json<ProjectionAudit>(auditPath)).rulesets, []);
  });
});

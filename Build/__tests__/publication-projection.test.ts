import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { EnhancedFileOutput } from '../lib/enhanced-file-output';
import { writeRuleOutputReports } from '../lib/output-audit';
import type { RulesetAuditRecord } from '../lib/output-audit';
import type { ResolvedBaseline } from '../lib/publication-baseline';
import { computeCandidateId, hashFile, scanTree, sha256Hex } from '../lib/publication-manifest';
import { StageError, renderPublicInChild, stagePublication } from '../lib/publication-stage';
import { collectAbsentPaths } from '../lib/publication-verify';
import { createSpan } from '../trace';

const SOURCE = 'a'.repeat(40);
const OLD_COMMIT = 'b'.repeat(40);
const NEW_COMMIT = 'c'.repeat(40);
const BUILT_AT = '2026-10-11T00:00:00.000Z';

async function json<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}

async function fixture(root: string, records: Array<[string, string[]]>, receiptId: number): Promise<void> {
  const audits: RulesetAuditRecord[] = [];
  for (const [id, rules] of records) {
    const output = new EnhancedFileOutput(createSpan(id), id, ['surge', 'clash', 'singbox', 'loon'], null, undefined, root).withTitle(id).withDescription(['fixture']);
    output.addRules(rules);
    // eslint-disable-next-line no-await-in-loop -- fixture publication keeps its own audit with the written files
    audits.push({ ...(await output.write()), sources: [] });
  }
  await writeRuleOutputReports({ outputRoot: root, records: audits, generatedAt: BUILT_AT, baselineDir: null, baselineReceiptId: receiptId });
  await fs.mkdir(path.join(root, 'GeoIP'), { recursive: true });
  await fs.writeFile(path.join(root, 'GeoIP/fixture.mmdb'), 'fixture');
  await fs.writeFile(path.join(root, 'Internal/rule-coverage.json'), '{}\n');
  await fs.writeFile(path.join(root, 'status.json'), JSON.stringify({ buildTime: BUILT_AT, commit: SOURCE, rulesets: audits.map(record => ({ id: record.id, platforms: record.platforms, ruleCount: record.stages.canonicalCount, lastSuccess: BUILT_AT })) }));
}

async function baseline(tree: string, id: number): Promise<ResolvedBaseline> {
  const files = await scanTree(tree);
  return { receiptId: id, kind: 'manifest', deployCommit: NEW_COMMIT, sourceCommit: SOURCE, candidateId: computeCandidateId(files), generatedAt: '2026-10-10T00:00:00.000Z', parentReceiptId: null, files: files.map(file => ({ path: file.path, sha256: file.sha256 })) };
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
  it('rolls back a historical audited ruleset, retiring its flat and variant files without claiming they are published', async t => {
    const env = await environment(t);
    await fixture(env.candidate, [['keep', ['DOMAIN,keep.example']], ['discord', ['DOMAIN,discord.example', 'IP-CIDR,203.0.113.0/24']]], 1);
    await fs.cp(env.candidate, env.tree, { recursive: true });
    const result = await stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['rollback'], sourceCommit: SOURCE, baseline: await baseline(env.tree, 2), baselineTreeDir: env.tree, rollbackOf: { receiptId: 1, deployCommit: OLD_COMMIT, sourceCommit: SOURCE }, render: renderPublicInChild });
    const audit = await json<ProjectionAudit>(path.join(env.out, 'Internal/rule-output-audit.json'));
    assert.deepEqual(audit.rulesets.map(record => record.id), ['keep']);
    assert.equal(audit.retiredOutputs.length, 16);
    assert.ok(audit.retiredOutputs.every(output => output.lifecycleId === 'ruleset:discord'));
    assert.ok(result.manifest.retiredRemoved.includes('List/domainset/discord.list'));
    assert.ok(result.manifest.retiredRemoved.includes('sing-box/ip/discord.json'));
    await assert.rejects(fs.access(path.join(env.out, 'Internal/source-snapshots/discord.json')));
    const delta = await json<Delta>(path.join(env.out, 'Internal/source-delta.json'));
    const removed = delta.sources.find(source => source.rulesetId === 'discord');
    assert.equal(removed?.status, 'removed');
    assert.equal(removed?.removed, 2);
    assert.equal(delta.baseline.receiptId, 2);
    const status = await json<{ rulesets: Array<{ id: string }> }>(path.join(env.out, 'status.json'));
    assert.deepEqual(status.rulesets.map(record => record.id), ['keep']);
    const absent = await collectAbsentPaths(env.out, result.manifest);
    assert.ok(absent.includes('List/domainset/discord.list'));
    assert.equal(result.manifest.files.find(file => file.path === 'Internal/rule-output-audit.json')?.origin, 'generated');
    assert.equal(result.manifest.files.find(file => file.path === 'Internal/source-snapshots/keep.json')?.origin, 'preserved');
    assert.ok((await json<ProjectionAudit>(path.join(env.candidate, 'Internal/rule-output-audit.json'))).rulesets.some(record => record.id === 'discord'));
  });

  it('projects partial platform retirement in the audit and snapshot while preserving normalized conditions and active platforms', async t => {
    const env = await environment(t);
    await fixture(env.candidate, [['keep', ['DOMAIN,keep.example']], ['china_asn', ['DOMAIN,asn.example', 'IP-ASN,1']]], 1);
    await fs.cp(env.candidate, env.tree, { recursive: true });
    const before = await json<Snapshot>(path.join(env.candidate, 'Internal/source-snapshots/china_asn.json'));
    const result = await stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['rollback'], sourceCommit: SOURCE, baseline: await baseline(env.tree, 2), baselineTreeDir: env.tree, rollbackOf: { receiptId: 1, deployCommit: OLD_COMMIT, sourceCommit: SOURCE }, render: renderPublicInChild });
    const audit = await json<ProjectionAudit>(path.join(env.out, 'Internal/rule-output-audit.json'));
    const record = audit.rulesets.find(ruleset => ruleset.id === 'china_asn');
    assert.ok(record);
    assert.ok(record.outputs.every(output => !output.path.startsWith('sing-box/')));
    assert.ok(record.effectiveOutputs.every(output => output.platform !== 'singbox'));
    assert.ok(!record.platforms.includes('singbox'));
    const after = await json<Snapshot>(path.join(env.out, 'Internal/source-snapshots/china_asn.json'));
    assert.deepEqual(after.conditions, before.conditions);
    assert.deepEqual(after.effectiveOutputs.map(output => output.platform).sort(), ['clash', 'loon', 'surge']);
    assert.equal(result.manifest.files.find(file => file.path === 'Internal/source-snapshots/china_asn.json')?.origin, 'generated');
    await fs.access(path.join(env.out, 'List/china_asn.list'));
    await assert.rejects(fs.access(path.join(env.out, 'sing-box/domainset/china_asn.json')));
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
    const before = await hashFile(path.join(env.candidate, 'List/keep.list'));
    const result = await stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['build', 'deploy', 'convert-plugins'], sourceCommit: SOURCE, baseline: await baseline(env.tree, 2), baselineTreeDir: env.tree, render: renderPublicInChild });
    const delta = await json<Delta>(path.join(env.out, 'Internal/source-delta.json'));
    assert.equal(delta.baseline.receiptId, 2);
    const keep = delta.sources.find(source => source.rulesetId === 'keep');
    assert.deepEqual(keep?.samples, { added: ['DOMAIN,current.example'], removed: ['DOMAIN,latest.example'] });
    assert.equal(keep?.added, 1);
    assert.equal(keep?.removed, 1);
    assert.deepEqual(await hashFile(path.join(env.out, 'List/keep.list')), before);
    assert.deepEqual(await hashFile(path.join(env.candidate, 'List/keep.list')), before);
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
    await fixture(env.candidate, [['keep', ['DOMAIN,keep.example']], ['discord', ['DOMAIN,discord.example']]], 1);
    await fs.writeFile(path.join(env.candidate, 'List/discord.list'), 'tampered');
    await assert.rejects(stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['rollback'], sourceCommit: SOURCE, baseline: null, baselineTreeDir: null, rollbackOf: { receiptId: 1, deployCommit: OLD_COMMIT, sourceCommit: SOURCE }, render: renderPublicInChild }), error => error instanceof StageError && error.code === 'output-mismatch');
  });

  it('rejects malformed snapshots during rebase instead of reporting invented deltas', async t => {
    const env = await environment(t);
    await fixture(env.candidate, [['keep', ['DOMAIN,keep.example']]], 1);
    await fixture(env.tree, [['keep', ['DOMAIN,baseline.example']]], 2);
    await fs.writeFile(path.join(env.candidate, 'Internal/source-snapshots/keep.json'), JSON.stringify({ conditions: ['invented'] }));
    await assert.rejects(stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['build', 'deploy'], sourceCommit: SOURCE, baseline: await baseline(env.tree, 2), baselineTreeDir: env.tree, render: renderPublicInChild }), error => error instanceof StageError && error.code === 'invalid-report');
    assert.equal(sha256Hex(await fs.readFile(path.join(env.candidate, 'Internal/source-snapshots/keep.json'))), sha256Hex(JSON.stringify({ conditions: ['invented'] })));
  });
});

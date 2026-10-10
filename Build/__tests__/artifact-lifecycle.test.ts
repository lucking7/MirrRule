import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';

import {
  ARTIFACT_LIFECYCLE_REGISTRY,
  ARTIFACT_LIFECYCLE_REPORT_PATH,
  ARTIFACT_LIFECYCLE_VERSION,
  assertNoRetiredArtifacts,
  createLifecycleReport,
  findLifecycleRecord,
  findRetiredExclusiveScripts,
  isRetiredPublicPath,
  normalizePublicPath,
  purgeOrphanedRetiredScripts,
  purgeRetiredArtifacts,
  validateLifecycleRegistry,
  writeLifecycleReport,
} from '../lib/artifact-lifecycle';
import type { ArtifactLifecycleRecord } from '../lib/artifact-lifecycle';
import {
  getPluginRetirementReason,
  isRetiredPluginArtifact,
  RETIRED_PLUGIN_ARTIFACTS,
} from '../integration/plugin-converter/plugin-policy';

const SCRIPT_BASE = 'https://nrrule.pages.dev/Scripts';
const TENCENT_SOURCE = 'https://kelee.one/Tool/Loon/Lpx/Tencent_Video_remove_ads.lpx';

function scriptModule(name: string, ...scripts: string[]): string {
  return [
    `#!name=${name}`,
    '[Script]',
    ...scripts.map((script, index) => `s${index}=type=http-response, pattern=^https://example.test, script-path=${SCRIPT_BASE}/${script}`),
  ].join('\n');
}

async function withTree(files: Record<string, string>, run: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-lifecycle-'));
  try {
    await Promise.all(Object.entries(files).map(async ([relative, content]) => {
      const target = path.join(root, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content);
    }));
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function assertAllExist(root: string, relatives: readonly string[]): Promise<void> {
  const present = await Promise.all(relatives.map(relative => exists(path.join(root, relative))));
  assert.deepEqual(present, relatives.map(() => true), relatives.join(', '));
}

function retiredRecord(paths: string[]): ArtifactLifecycleRecord {
  return { id: 'bad', state: 'retired', paths, reason: 'r', evidence: 'e' };
}

describe('artifact lifecycle registry', () => {
  it('owns the retired Tencent identity and both Chinese and English historical filenames', () => {
    const record = ARTIFACT_LIFECYCLE_REGISTRY.find(candidate => candidate.id === 'plugin:tencent-video-remove-ads');
    assert.ok(record);
    assert.equal(record.state, 'retired');
    assert.deepEqual(record.canonicalSources, [TENCENT_SOURCE]);
    assert.deepEqual([...RETIRED_PLUGIN_ARTIFACTS], ['腾讯视频去广告.sgmodule', 'Tencent_Video_remove_ads.sgmodule']);
    for (const name of RETIRED_PLUGIN_ARTIFACTS) {
      assert.equal(findLifecycleRecord(`Modules/Converted/${name}`), record);
      assert.equal(findLifecycleRecord(['Modules', 'Converted', name].join('\\')), record);
      assert.equal(isRetiredPublicPath(`Modules/Converted/${name}`), true);
      assert.equal(isRetiredPluginArtifact(name), true);
    }
    assert.equal(getPluginRetirementReason({ url: TENCENT_SOURCE }), record.reason);
  });

  it('isolates an active source that reuses the retired name while keeping retired filenames reserved', () => {
    const activeSource = 'https://plugins.test/Tencent_Video_remove_ads.lpx';
    assert.equal(getPluginRetirementReason({ url: activeSource }), undefined);
    assert.equal(getPluginRetirementReason({ url: `${TENCENT_SOURCE}?version=2` }), undefined);
    assert.equal(isRetiredPublicPath('Modules/Converted/Active alternative.sgmodule'), false);
    assert.equal(isRetiredPluginArtifact('Tencent_Video_remove_ads.sgmodule'), true);
  });

  it('rejects absolute, traversing and unregistered-root paths', () => {
    for (const bad of ['/etc/passwd', String.raw`C:\Windows\x`, '../outside.list', 'List/../../outside.list', '..', '.']) {
      assert.throws(() => normalizePublicPath(bad), /Lifecycle path/, bad);
    }
    for (const paths of [['../x.list'], ['/abs/x.list'], ['index.html'], ['Internal/report.json'], ['Unknown/x.list'], []]) {
      assert.throws(() => validateLifecycleRegistry([retiredRecord(paths)]), /Lifecycle/, JSON.stringify(paths));
    }
    assert.throws(() => validateLifecycleRegistry([retiredRecord(['List/a.list']), { ...retiredRecord(['List/a.list']), id: 'other' }]), /registered by/);
    assert.throws(() => validateLifecycleRegistry([{ ...retiredRecord(['List/a.list']), reason: ' ' }]), /reason and evidence/);
    assert.throws(() => validateLifecycleRegistry([{ ...retiredRecord(['List/a.list']), canonicalSources: [`${TENCENT_SOURCE}#x`] }]), /not canonical/);
  });

  it('never deletes outside the root for illegal registries or symlinked directories', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-lifecycle-outside-'));
    try {
      await fs.mkdir(path.join(outside, 'Converted'), { recursive: true });
      await fs.writeFile(path.join(outside, 'Converted', 'x.sgmodule'), 'keep');
      await withTree({}, async root => {
        const traversal: ArtifactLifecycleRecord[] = [{ id: 'bad', state: 'retired', paths: [`../${path.basename(outside)}/Converted/x.sgmodule`], reason: 'r', evidence: 'e' }];
        await assert.rejects(purgeRetiredArtifacts(root, traversal), /Lifecycle path/);
        await fs.symlink(outside, path.join(root, 'Modules'));
        const linked: ArtifactLifecycleRecord[] = [{ id: 'linked', state: 'retired', paths: ['Modules/Converted/x.sgmodule'], reason: 'r', evidence: 'e' }];
        await assert.rejects(purgeRetiredArtifacts(root, linked), /outside the publication root/);
      });
      assert.equal(await fs.readFile(path.join(outside, 'Converted', 'x.sgmodule'), 'utf8'), 'keep');
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

describe('retired artifact cleanup', () => {
  it('AE6: clears a preserved retired Tencent module and its exclusive script but keeps shared and active files', async () => {
    await withTree({
      'Modules/Converted/腾讯视频去广告.sgmodule': scriptModule('腾讯视频去广告', 'tencent-only.js', 'shared.js'),
      'Modules/Converted/Tencent_Video_remove_ads.sgmodule': scriptModule('Tencent', 'tencent-only.js'),
      'Modules/Converted/哈罗去广告.sgmodule': scriptModule('哈罗去广告', 'shared.js'),
      'Mirror/Sukka/module.sgmodule': scriptModule('Mirror', 'mirror.js'),
      'Scripts/tencent-only.js': 'const tencent = true;',
      'Scripts/shared.js': 'const shared = true;',
      'Scripts/mirror.js': 'const mirror = true;',
      'List/apple.list': 'DOMAIN,apple.com',
      'sing-box/china_asn.json': '{}',
    }, async root => {
      await assert.rejects(assertNoRetiredArtifacts(root), /腾讯视频去广告\.sgmodule/);
      assert.deepEqual(await findRetiredExclusiveScripts(root), ['Scripts/tencent-only.js']);
      const removed = await purgeRetiredArtifacts(root);
      assert.deepEqual(removed, [
        'Modules/Converted/腾讯视频去广告.sgmodule',
        'Modules/Converted/Tencent_Video_remove_ads.sgmodule',
        'sing-box/china_asn.json',
        'Scripts/tencent-only.js',
      ]);
      await assertNoRetiredArtifacts(root);
      await assertAllExist(root, ['Modules/Converted/哈罗去广告.sgmodule', 'Scripts/shared.js', 'Scripts/mirror.js', 'Mirror/Sukka/module.sgmodule', 'List/apple.list']);
      assert.deepEqual(await purgeRetiredArtifacts(root), []);
    });
  });

  it('keeps scripts whose exclusive ownership is not proven', async () => {
    await withTree({
      'Modules/Converted/Tencent_Video_remove_ads.sgmodule': [
        scriptModule('Tencent', 'by-mirror.js', 'by-script.js', 'by-text.js', 'missing.js'),
        `bad=type=http-response, script-path=${SCRIPT_BASE}/%ZZ.js`,
        `escape=type=http-response, script-path=${SCRIPT_BASE}/%2e%2e/%2e%2e/outside.js`,
      ].join('\n'),
      'Mirror/Other/plugin.plugin': `script-path=${SCRIPT_BASE}/by-mirror.js`,
      'Scripts/loader.js': `importScripts("${SCRIPT_BASE}/by-script.js")`,
      'Modules/notes.conf': 'see /Scripts/by-text.js',
      'Scripts/by-mirror.js': 'a',
      'Scripts/by-script.js': 'b',
      'Scripts/by-text.js': 'c',
      'Scripts/%ZZ.js': 'd',
    }, async root => {
      assert.deepEqual(await findRetiredExclusiveScripts(root), []);
      assert.deepEqual(await purgeRetiredArtifacts(root), ['Modules/Converted/Tencent_Video_remove_ads.sgmodule']);
      await assertAllExist(root, ['Scripts/by-mirror.js', 'Scripts/by-script.js', 'Scripts/by-text.js', 'Scripts/%ZZ.js', 'Scripts/loader.js']);
    });
  });

  for (const [label, [first, second, entry, unrelated]] of [
    ['ascending', ['a.js', 'b.js', 'z.js', 'c.js']],
    ['reversed', ['z.js', 'y.js', 'a.js', 'x.js']],
  ] as const) {
    it(`keeps scripts reachable from active modules through other scripts (${label} scan order)`, async () => {
      await withTree({
        'Modules/Converted/Tencent_Video_remove_ads.sgmodule': scriptModule('Tencent', first, second, unrelated),
        'Modules/Converted/active.sgmodule': scriptModule('Active', entry),
        [`Scripts/${entry}`]: `importScripts("${SCRIPT_BASE}/${first}")`,
        [`Scripts/${first}`]: `const next = "${SCRIPT_BASE}/${second}";`,
        [`Scripts/${second}`]: 'const leaf = true;',
        [`Scripts/${unrelated}`]: 'const retiredOnly = true;',
      }, async root => {
        assert.deepEqual(await findRetiredExclusiveScripts(root), [`Scripts/${unrelated}`]);
        assert.deepEqual(await purgeRetiredArtifacts(root), [
          'Modules/Converted/Tencent_Video_remove_ads.sgmodule', `Scripts/${unrelated}`,
        ]);
        await assertAllExist(root, [`Scripts/${entry}`, `Scripts/${first}`, `Scripts/${second}`, 'Modules/Converted/active.sgmodule']);
      });
    });
  }

  it('purges retired files from an existing public directory without downloading a previous build', async () => {
    await withTree({
      'Modules/Converted/腾讯视频去广告.sgmodule': '[Rule]\nDOMAIN,retired.test,REJECT',
      'List/apple.list': 'DOMAIN,apple.com',
    }, async root => {
      const result = spawnSync(process.execPath, ['-r', '@swc-node/register', 'Build/download-previous-build.ts'], {
        cwd: path.resolve(__dirname, '../..'),
        env: { ...process.env, PUBLIC_DIR: root, SWC_NODE_IGNORE_DYNAMIC: 'true' },
        encoding: 'utf8',
        timeout: 30000,
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /skip downloading previous build/);
      assert.equal(await exists(path.join(root, 'Modules/Converted/腾讯视频去广告.sgmodule')), false);
      await assertAllExist(root, ['List/apple.list']);
    });
  });

  it('does not delete scripts once the retired module that proved ownership is gone', async () => {
    await withTree({ 'Scripts/tencent-only.js': 'const tencent = true;' }, async root => {
      assert.deepEqual(await purgeOrphanedRetiredScripts(root), []);
      assert.equal(await exists(path.join(root, 'Scripts/tencent-only.js')), true);
    });
  });

  it('keeps deprecated subscriptions published and reports replacement without redirecting', async () => {
    const registry: ArtifactLifecycleRecord[] = [
      ...ARTIFACT_LIFECYCLE_REGISTRY,
      { id: 'ruleset:legacy', state: 'deprecated', paths: ['List/legacy.list'], reason: 'Split into variants', evidence: 'test', replacement: 'List/domainset/legacy.list' },
    ];
    await withTree({ 'List/legacy.list': 'DOMAIN,legacy.test', 'List/container.list': 'DOMAIN,old.test' }, async root => {
      const removed = await purgeRetiredArtifacts(root, registry);
      assert.deepEqual(removed, ['List/container.list']);
      assert.equal(await exists(path.join(root, 'List/legacy.list')), true);
      await assertNoRetiredArtifacts(root, registry);
      const written = await writeLifecycleReport(root, removed, registry);
      assert.equal(written, path.join(root, ...ARTIFACT_LIFECYCLE_REPORT_PATH.split('/')));
      const report = JSON.parse(await fs.readFile(written, 'utf8'));
      assert.deepEqual(report, createLifecycleReport(removed, registry));
      assert.equal(report.version, ARTIFACT_LIFECYCLE_VERSION);
      assert.equal(report.automaticRedirects, false);
      assert.deepEqual(report.removed, ['List/container.list']);
      assert.deepEqual(report.records.find((record: { id: string }) => record.id === 'ruleset:legacy'), {
        id: 'ruleset:legacy', state: 'deprecated', paths: ['List/legacy.list'], reason: 'Split into variants', evidence: 'test', replacement: 'List/domainset/legacy.list',
      });
      const asn = report.records.find((record: { id: string }) => record.id === 'ruleset:china_asn:sing-box');
      assert.match(asn?.replacement ?? '', /sing-box\/china_ip\.json/);
      const tencent = report.records.find((record: { id: string }) => record.id === 'plugin:tencent-video-remove-ads');
      assert.ok(tencent);
      assert.deepEqual(tencent.canonicalSources, [TENCENT_SOURCE]);
      assert.equal('replacement' in tencent, false);
      assert.equal(await exists(path.join(root, 'List/domainset/legacy.list')), false);
    });
  });
});

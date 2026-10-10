import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';

import type { ResolvedBaseline } from '../lib/publication-baseline';
import { publishStagingTree } from '../lib/publication-git';
import {
  PUBLICATION_MANIFEST_PATH,
  computeCandidateId,
  isTreeVerified,
  parseManifest,
  scanTree,
  verifyTreeAgainstFiles,
} from '../lib/publication-manifest';
import { StageError, renderPublicInChild, stagePublication } from '../lib/publication-stage';

const SOURCE = 'a'.repeat(40);
const BASELINE_COMMIT = 'b'.repeat(40);
const RETIRED_MODULE = 'Modules/Converted/腾讯视频去广告.sgmodule';

const VARIANT_FILES: Record<string, string> = {
  'List/domainset/apple_cdn.list': '.apple.com\n',
  'Clash/domainset/apple_cdn.txt': 'DOMAIN-SUFFIX,apple.com\n',
  'Loon/domainset/apple_cdn.list': 'DOMAIN-SUFFIX,apple.com\n',
  'sing-box/domainset/apple_cdn.json': '{"version":2,"rules":[{"domain_suffix":["apple.com"]}]}\n',
  'List/ip/telegram.list': 'IP-CIDR,91.108.4.0/22,no-resolve\n',
  'sing-box/ip/telegram.json': '{"version":2,"rules":[{"ip_cidr":["91.108.4.0/22"]}]}\n',
};

const RULE_OUTPUTS: Record<string, string> = {
  'List/apple_cdn.list': 'DOMAIN-SUFFIX,apple.com\n',
  'List/telegram.list': 'IP-CIDR,91.108.4.0/22,no-resolve\n',
  'Clash/apple_cdn.txt': 'DOMAIN-SUFFIX,apple.com\n',
  'Loon/apple_cdn.list': 'DOMAIN-SUFFIX,apple.com\n',
  'sing-box/apple_cdn.json': '{"version":2,"rules":[]}\n',
  ...VARIANT_FILES,
};

function audit(rules: Record<string, string>, absent: readonly string[]): string {
  const outputs = [
    ...Object.entries(rules).map(([relative, content]) => ({ path: relative, status: 'published', bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') })),
    ...absent.map(relative => ({ path: relative, status: 'absent-empty', bytes: null, sha256: null })),
  ];
  return `${JSON.stringify({ schemaVersion: 1, rulesets: [{ id: 'fixture', outputs }] })}\n`;
}

const CANDIDATE: Record<string, string> = {
  ...RULE_OUTPUTS,
  'GeoIP/Country.mmdb': 'mmdb',
  'Internal/rule-output-audit.json': audit(RULE_OUTPUTS, ['Clash/domainset/telegram.txt']),
  'Internal/source-delta.json': '{"schemaVersion":1,"baseline":{"configured":true,"receiptId":"11"},"sources":[]}\n',
  'Internal/source-snapshots/apple_cdn.json': '{"conditions":["DOMAIN-SUFFIX,apple.com"]}\n',
  'Internal/rule-coverage.json': '{}\n',
  'status.json': '{"buildTime":"2026-10-10T05:00:00.000Z","commit":"aaaaaaaa","rulesets":[]}\n',
  // Stale copy of a non-run directory inside the build artifact; must not reach production.
  'Mirror/iRingo/Weather.sgmodule': 'stale artifact copy\n',
};

const BASELINE_TREE: Record<string, string> = {
  'Mirror/iRingo/Weather.sgmodule': 'accepted weather\n',
  'Modules/Converted/active.sgmodule': '#!name=active\n',
  [RETIRED_MODULE]: '#!name=腾讯视频去广告\n',
  'Modules/Merged/pro.sgmodule': '#!name=pro\n',
  'Scripts/shared.js': 'shared\n',
};

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split('/'));
    // eslint-disable-next-line no-await-in-loop -- small fixture
    await fs.mkdir(path.dirname(target), { recursive: true });
    // eslint-disable-next-line no-await-in-loop -- small fixture
    await fs.writeFile(target, content);
  }
}

async function fixture(t: { after: (fn: () => Promise<void>) => void }, candidateOverrides: Record<string, string> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-publication-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const candidate = path.join(root, 'candidate');
  const baselineTree = path.join(root, 'baseline');
  await writeTree(candidate, { ...CANDIDATE, ...candidateOverrides });
  await writeTree(baselineTree, BASELINE_TREE);
  const files = await scanTree(baselineTree, new Set());
  const baseline: ResolvedBaseline = {
    receiptId: 11,
    kind: 'manifest',
    deployCommit: BASELINE_COMMIT,
    sourceCommit: SOURCE,
    candidateId: computeCandidateId(files),
    generatedAt: '2026-10-09T00:00:00.000Z',
    parentReceiptId: null,
    files: files.map(file => ({ path: file.path, sha256: file.sha256 })),
  };
  return { root, candidate, baselineTree, baseline };
}

function stage(env: Awaited<ReturnType<typeof fixture>>, outName: string) {
  return stagePublication({
    candidateDir: env.candidate,
    outDir: path.join(env.root, outName),
    tasks: ['build', 'deploy'],
    sourceCommit: SOURCE,
    baseline: env.baseline,
    baselineTreeDir: env.baselineTree,
    render: renderPublicInChild,
  });
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' },
  }).trim();
}

describe('publication integration', () => {
  it('publishes nested variants, reports and verified preserved directories with a consistent index and manifest', async (t) => {
    const env = await fixture(t);
    const result = await stage(env, 'staging');
    const staging = path.join(env.root, 'staging');
    const byPath = new Map(result.manifest.files.map(file => [file.path, file]));

    for (const relative of Object.keys(VARIANT_FILES)) assert.equal(byPath.get(relative)?.origin, 'generated', relative);
    for (const relative of ['Internal/rule-output-audit.json', 'Internal/source-delta.json', 'Internal/source-snapshots/apple_cdn.json', 'Internal/rule-coverage.json', 'Internal/artifact-lifecycle.json']) {
      assert.ok(byPath.has(relative), relative);
    }
    for (const relative of ['Mirror/iRingo/Weather.sgmodule', 'Modules/Converted/active.sgmodule', 'Modules/Merged/pro.sgmodule', 'Scripts/shared.js']) {
      assert.equal(byPath.get(relative)?.origin, 'preserved', relative);
      assert.equal(byPath.get(relative)?.preservedFromCommit, BASELINE_COMMIT, relative);
    }
    assert.equal(await fs.readFile(path.join(staging, 'Mirror', 'iRingo', 'Weather.sgmodule'), 'utf8'), 'accepted weather\n');
    assert.deepEqual(result.manifest.preservedDirs, ['Mirror', 'Modules', 'Scripts']);
    assert.deepEqual(result.manifest.freshDirs, ['Clash', 'GeoIP', 'Internal', 'List', 'Loon', 'sing-box']);
    assert.equal(result.manifest.baselineReceiptId, 11);
    assert.equal(result.manifest.generatedAt, '2026-10-10T05:00:00.000Z');

    const manifestText = await fs.readFile(path.join(staging, ...PUBLICATION_MANIFEST_PATH.split('/')), 'utf8');
    assert.deepEqual(parseManifest(manifestText), result.manifest);
    assert.ok(isTreeVerified(await verifyTreeAgainstFiles(staging, result.manifest.files)));

    const index = await fs.readFile(path.join(staging, 'index.html'), 'utf8');
    for (const file of result.manifest.files) {
      const name = path.posix.basename(file.path);
      if (name.startsWith('_') || name.startsWith('.') || name.endsWith('.html') || !file.path.includes('/')) continue;
      assert.ok(index.includes(file.path.split('/').map(segment => encodeURIComponent(segment)).join('/')), `index lists ${file.path}`);
    }
    assert.ok(index.includes('Internal/publication-manifest.json'));
    assert.ok(index.includes('2026-10-10T05:00:00.000Z'));
    await fs.access(path.join(staging, '_headers'));
  });

  it('removes a retired module preserved from the baseline during a rule-only publication', async (t) => {
    const env = await fixture(t);
    const result = await stage(env, 'staging');
    const staging = path.join(env.root, 'staging');
    await assert.rejects(fs.access(path.join(staging, ...RETIRED_MODULE.split('/'))), { code: 'ENOENT' });
    assert.ok(result.manifest.retiredRemoved.includes(RETIRED_MODULE));
    assert.ok(!result.manifest.files.some(file => file.path === RETIRED_MODULE));
    const index = await fs.readFile(path.join(staging, 'index.html'), 'utf8');
    assert.ok(!index.includes(encodeURIComponent('腾讯视频去广告')));
    const report = JSON.parse(await fs.readFile(path.join(staging, 'Internal', 'artifact-lifecycle.json'), 'utf8')) as { removed: string[] };
    assert.ok(report.removed.includes(RETIRED_MODULE));
    assert.equal(await fs.readFile(path.join(staging, 'Scripts', 'shared.js'), 'utf8'), 'shared\n');
  });

  it('refuses half variant sets in either direction', async (t) => {
    const missing = await fixture(t);
    await fs.rm(path.join(missing.candidate, 'sing-box', 'ip', 'telegram.json'));
    await assert.rejects(stage(missing, 'staging'), (error: unknown) => error instanceof StageError && error.code === 'output-mismatch' && error.message.includes('sing-box/ip/telegram.json'));

    const unlisted = await fixture(t, { 'Loon/ip/telegram.list': 'IP-CIDR,91.108.4.0/22,no-resolve\n' });
    await assert.rejects(stage(unlisted, 'staging'), (error: unknown) => error instanceof StageError && error.code === 'output-mismatch' && error.message.includes('Loon/ip/telegram.list'));
  });

  it('turns a retry of the same artifact into an identical tree and a no-op push', async (t) => {
    const env = await fixture(t);
    const first = await stage(env, 'staging-1');
    const second = await stage(env, 'staging-2');
    assert.equal(second.manifestText, first.manifestText);
    assert.equal(second.manifest.candidateId, first.manifest.candidateId);

    const remote = path.join(env.root, 'remote.git');
    git(env.root, 'init', '--quiet', '--bare', '--initial-branch=main', remote);
    const seed = path.join(env.root, 'seed');
    git(env.root, 'init', '--quiet', '--initial-branch=main', seed);
    await writeTree(seed, { 'README.md': 'legacy\n' });
    git(seed, 'add', '.');
    git(seed, 'commit', '--quiet', '-m', 'legacy');
    git(seed, 'remote', 'add', 'origin', remote);
    git(seed, 'push', '--quiet', 'origin', 'HEAD:main');
    const clone = path.join(env.root, 'clone');
    git(env.root, 'clone', '--quiet', '--no-checkout', '--depth=1', `file://${remote}`, clone);
    git(clone, 'config', 'user.email', 't@example.com');
    git(clone, 'config', 'user.name', 't');

    const pushed = await publishStagingTree({ repoDir: clone, stagingDir: path.join(env.root, 'staging-1'), branch: 'main', expectedHead: git(clone, 'rev-parse', 'HEAD'), message: 'deploy: test [rules]' });
    assert.equal(pushed.outcome, 'pushed');
    const retry = await publishStagingTree({ repoDir: clone, stagingDir: path.join(env.root, 'staging-2'), branch: 'main', expectedHead: pushed.deployCommit, message: 'deploy: test [rules]' });
    assert.equal(retry.outcome, 'no-op');
    assert.equal(retry.deployCommit, pushed.deployCommit);
    const published = git(env.root, '--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main').split('\n');
    assert.ok(!published.includes('README.md') || first.manifest.files.some(file => file.path === 'README.md'));
    assert.ok(published.includes(PUBLICATION_MANIFEST_PATH));
    assert.deepEqual(published.filter(item => item !== PUBLICATION_MANIFEST_PATH).sort(), first.manifest.files.map(file => file.path).sort());
  });
});

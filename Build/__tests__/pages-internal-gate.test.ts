import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { writePagesInternalGate } from '../lib/pages-internal-gate';
import { retiredPublicPaths } from '../lib/artifact-lifecycle';
import { RULE_OUTPUT_LAYOUT_VERSION } from '../lib/rule-output-variants';

async function fixture(t: { after: (fn: () => Promise<unknown>) => void }): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-pages-gate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'Internal/source-snapshots'), { recursive: true });
  return root;
}

async function writeDomainsetAudit(root: string, current: boolean): Promise<void> {
  const fixtures = [
    { path: 'List/domainset/cdn.conf', platform: 'surge', format: 'surge-domainset' },
    { path: 'Clash/domainset/cdn.txt', platform: 'clash', format: 'clash-domain' },
    { path: 'sing-box/domainset/cdn.json', platform: 'singbox', format: 'singbox-json-v2' },
  ];
  const outputs = await Promise.all(fixtures.map(async output => {
    const bytes = await fs.readFile(path.join(root, output.path));
    return {
      ...output, variant: 'domainset', status: 'published',
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }));
  const layoutVersion = current ? RULE_OUTPUT_LAYOUT_VERSION : undefined;
  await fs.writeFile(path.join(root, 'Internal/rule-output-audit.json'), JSON.stringify({
    schemaVersion: 1, layoutVersion, rulesets: [{ id: 'cdn', outputs }],
  }));
}

function exerciseWorker(root: string, checks: Array<{ pathname: string, status: number, delegated: boolean, method?: string, assetStatus?: number }>): void {
  const script = String.raw`
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const source = await fs.readFile(new URL(${JSON.stringify(pathToFileURL(path.join(root, '_worker.js')).href)}), 'utf8');
const { default: worker } = await import('data:text/javascript,' + encodeURIComponent(source));
for (const check of ${JSON.stringify(checks)}) {
  let calls = 0;
  const request = new Request('https://nrrule.pages.dev' + check.pathname, { method: check.method || 'GET' });
  const response = await worker.fetch(request, { ASSETS: { fetch(received) {
    calls++;
    assert.equal(received, request);
    return new Response(request.method === 'HEAD' ? null : 'current asset', { status: check.assetStatus || 200, headers: { 'x-asset': 'preserved', 'content-type': 'application/gzip', 'cache-control': 'public, max-age=240' } });
  } } });
  assert.equal(response.status, check.status, check.pathname);
  assert.equal(calls, check.delegated ? 1 : 0, check.pathname);
  if (check.delegated) {
    assert.equal(response.headers.get('x-asset'), 'preserved');
    assert.equal(await response.text(), check.method === 'HEAD' ? '' : 'current asset');
    if (check.pathname.startsWith('/Internal/')) {
      assert.equal(response.headers.get('content-type'), 'application/gzip');
      assert.equal(response.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-robots-tag'), 'noindex');
    } else if (/^\/(?:(?:List|Clash|Loon|sing-box)\/(?:domainset|ip|non_ip)|Mirror)\//.test(decodeURIComponent(check.pathname))) {
      assert.equal(response.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
      assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
      assert.equal(response.headers.get('x-robots-tag'), 'noindex');
    } else {
      assert.equal(response.headers.get('content-type'), 'application/gzip');
      assert.equal(response.headers.get('cache-control'), 'public, max-age=240');
    }
  } else {
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
    assert.equal(await response.text(), check.method === 'HEAD' ? '' : 'Not Found\n');
  }
}
`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

describe('Pages Internal inventory gate', () => {
  it('delegates current Internal files and ordinary assets but blocks missing reports before ASSETS', async t => {
    const root = await fixture(t);
    for (const name of ['current.json.gz', 'literal%2Fid.json.gz', 'quoted"id.json.gz']) {
      // eslint-disable-next-line no-await-in-loop -- fixture files are written before generating the inventory
      await fs.writeFile(path.join(root, 'Internal/source-snapshots', name), 'snapshot');
    }
    await fs.writeFile(path.join(root, 'Internal/audit.json'), 'audit');
    await fs.mkdir(path.join(root, 'Internal/nested'));
    await fs.writeFile(path.join(root, 'Internal/nested/report.json'), 'nested');
    await fs.mkdir(path.join(root, 'List/ip'), { recursive: true });
    await fs.writeFile(path.join(root, 'List/ip/cdn.list'), 'IP-CIDR,185.199.108.0/22');
    await fs.mkdir(path.join(root, 'List/non_ip'), { recursive: true });
    await fs.writeFile(path.join(root, 'List/non_ip/cdn.list'), 'DOMAIN-SUFFIX,cdn.example');
    await fs.writeFile(path.join(root, 'List/non_ip/cdn.conf'), 'DOMAIN-SUFFIX,cdn.example');
    await fs.mkdir(path.join(root, 'List/domainset'), { recursive: true });
    await fs.writeFile(path.join(root, 'List/domainset/cdn.conf'), '.cdn.example');
    await fs.mkdir(path.join(root, 'Clash/domainset'), { recursive: true });
    await fs.writeFile(path.join(root, 'Clash/domainset/cdn.txt'), '+.cdn.example');
    await fs.mkdir(path.join(root, 'sing-box/domainset'), { recursive: true });
    await fs.writeFile(path.join(root, 'sing-box/domainset/cdn.json'), '{"version":2,"rules":[{"domain_suffix":["cdn.example"]}]}');
    await writeDomainsetAudit(root, true);
    await fs.mkdir(path.join(root, 'Mirror/fmz200/sgmodule/categories/Q'), { recursive: true });
    await fs.writeFile(path.join(root, 'Mirror/fmz200/sgmodule/categories/Q/知乎.sgmodule'), '#!name=知乎');
    await writePagesInternalGate(root);
    const routes = JSON.parse(await fs.readFile(path.join(root, '_routes.json'), 'utf8')) as { version: number, include: string[], exclude: string[] };
    const routed = [
      '/Clash/domainset/', '/Clash/ip/', '/Clash/non_ip/',
      '/Loon/ip/', '/Loon/non_ip/', '/Mirror/', '/sing-box/domainset/', '/sing-box/ip/', '/sing-box/non_ip/',
      '/Loon/domainset/', '/List/',
    ];
    assert.deepEqual(routes, {
      version: 1,
      include: [
        '/Internal/*',
        ...routed.map(prefix => `${prefix}*`),
        ...[...new Set(retiredPublicPaths().map(relative => `/${relative}`))].sort().flatMap(relative => (
          routed.some(prefix => relative.startsWith(prefix)) ? [] : [relative.split('/').map(segment => encodeURIComponent(segment)).join('/')]
        )),
      ],
      exclude: [],
    });
    // Retired exact paths in a routed directory, such as List/ip/discord.list, need no own route.
    assert.equal(routes.include.includes('/List/ip/discord.list'), false);
    exerciseWorker(root, [
      { pathname: '/Internal/source-snapshots/current.json.gz', status: 200, delegated: true },
      { pathname: '/Internal/source-snapshots/current.json.gz?query=1', status: 200, delegated: true },
      { pathname: '/Internal/source-snapshots/current.json.gz', status: 200, delegated: true, method: 'HEAD' },
      { pathname: '/Internal/source-snapshots/current.json.gz', status: 503, delegated: true, assetStatus: 503 },
      { pathname: '/Internal/source-snapshots/literal%252Fid.json.gz', status: 200, delegated: true },
      { pathname: '/Internal/source-snapshots/quoted%22id.json.gz', status: 200, delegated: true },
      { pathname: '/Internal/source-snapshots/literal%2Fid.json.gz', status: 404, delegated: false },
      { pathname: '/Internal/source-snapshots/current.json', status: 404, delegated: false },
      { pathname: '/Internal/source-snapshots/missing.json', status: 404, delegated: false, method: 'HEAD' },
      { pathname: '/Internal/source-snapshots/%ZZ.json', status: 404, delegated: false },
      { pathname: '/Internal/audit.json', status: 200, delegated: true },
      { pathname: '/Internal/nested/report.json', status: 200, delegated: true },
      { pathname: '/Internal/preserved-artifacts.json', status: 404, delegated: false },
      { pathname: '/List/ai.list', status: 404, delegated: false },
      { pathname: '/List//ai.list', status: 404, delegated: false },
      { pathname: '/%49nternal/missing.json', status: 404, delegated: false },
      { pathname: '/List/%61i.list?cached=1', status: 404, delegated: false, method: 'HEAD' },
      { pathname: '/List/notes.md', status: 200, delegated: true },
      { pathname: '/List/ip/cdn.list', status: 200, delegated: true },
      { pathname: '/List/ip/cdn.list', status: 200, delegated: true, method: 'HEAD' },
      // A deleted ip variant is answered before the edge cache can serve its stale copy.
      { pathname: '/List/ip/netflix.list', status: 404, delegated: false },
      { pathname: '/Clash/ip/cdn.txt', status: 404, delegated: false },
      { pathname: '/List/ip/discord.list', status: 404, delegated: false },
      { pathname: '/List/non_ip/cdn.list', status: 200, delegated: true },
      { pathname: '/List/%6eon_ip/cdn.list', status: 200, delegated: true },
      { pathname: '/List/%6eon_ip/stale.list', status: 404, delegated: false },
      { pathname: '/List/non_ip/cdn.conf', status: 200, delegated: true },
      { pathname: '/List/domainset/cdn.conf', status: 200, delegated: true },
      { pathname: '/Clash/domainset/cdn.txt', status: 200, delegated: true },
      { pathname: '/sing-box/domainset/cdn.json', status: 200, delegated: true },
      { pathname: '/List/domainset/cdn.list', status: 404, delegated: false },
      { pathname: '/List/domainset/missing.conf', status: 404, delegated: false },
      { pathname: '/Clash/domainset/discord.txt', status: 404, delegated: false },
      { pathname: '/sing-box/domainset/missing.json', status: 404, delegated: false },
      { pathname: '/Loon/domainset/cdn.list', status: 404, delegated: false },
      // A sing-box non_ip that disappears when a ruleset turns IP-only is not served from the cache.
      { pathname: '/sing-box/non_ip/apple_services_ip.json', status: 404, delegated: false },
      { pathname: '/Mirror/fmz200/sgmodule/categories/Q/%E7%9F%A5%E4%B9%8E.sgmodule', status: 200, delegated: true },
      // A mirrored module renamed or dropped upstream is not served from the edge cache.
      { pathname: '/Mirror/fmz200/sgmodule/categories/Q/%E5%B0%8F%E7%BA%A2%E4%B9%A6.sgmodule', status: 404, delegated: false },
      { pathname: '/Mirror/iRingo/sgmodule/removed.sgmodule', status: 404, delegated: false },
    ]);
  });

  it('serves only audited native domainsets from a reused output directory', async t => {
    const root = await fixture(t);
    for (const [directory, filename] of [['List', 'cdn.conf'], ['Clash', 'cdn.txt'], ['sing-box', 'cdn.json']]) {
      const tree = path.join(root, directory, 'domainset');
      // eslint-disable-next-line no-await-in-loop -- fixture on disk precedes audit
      await fs.mkdir(tree, { recursive: true });
      // eslint-disable-next-line no-await-in-loop -- fixture on disk precedes audit
      await fs.writeFile(path.join(tree, filename), 'old body');
    }
    const native = { pathname: '/Clash/domainset/cdn.txt', status: 404, delegated: false };
    await writePagesInternalGate(root);
    exerciseWorker(root, [native]);
    await writeDomainsetAudit(root, false);
    await writePagesInternalGate(root);
    exerciseWorker(root, [native]);

    await fs.writeFile(path.join(root, 'Clash/domainset/cdn.txt'), '+.cdn.example');
    await writeDomainsetAudit(root, true);
    await fs.writeFile(path.join(root, 'List/domainset/cdn.list'), '.cdn.example');
    await fs.writeFile(path.join(root, 'Clash/domainset/cdn.txt'), 'DOMAIN-SUFFIX,cdn.example');
    await writePagesInternalGate(root);
    exerciseWorker(root, [
      native,
      { pathname: '/List/domainset/cdn.list', status: 404, delegated: false },
    ]);
  });

  it('blocks registered retired URLs without consulting cached assets while active subscriptions remain static', async t => {
    const root = await fixture(t);
    await writePagesInternalGate(root);
    const routes = JSON.parse(await fs.readFile(path.join(root, '_routes.json'), 'utf8')) as { include: string[] };
    assert.ok(routes.include.length <= 100);
    const retiredChecks = retiredPublicPaths().map(relative => ({
      pathname: `/${relative.split('/').map(segment => encodeURIComponent(segment)).join('/')}`,
      status: 404, delegated: false,
    }));
    exerciseWorker(root, [
      ...retiredChecks,
      { pathname: '/sing-box/china_asn.json?original=1', status: 404, delegated: false },
      { pathname: '/sing-box/china_asn.json', status: 404, delegated: false, method: 'HEAD' },
      { pathname: '/Modules/Converted/腾讯视频去广告.sgmodule', status: 404, delegated: false },
      { pathname: '/List/domainset/cdn.list', status: 404, delegated: false },
      { pathname: '/sing-box/domainset/cdn.json?v=1', status: 404, delegated: false },
      { pathname: '/List/non_ip/cdn.list', status: 404, delegated: false },
      { pathname: '/List/ai.list', status: 404, delegated: false },
      { pathname: '/List/speedtest_china.list', status: 404, delegated: false },
      { pathname: '/List/arbitrary%20old.list', status: 404, delegated: false },
      { pathname: '/Loon/ai.list', status: 200, delegated: true },
      { pathname: '/sing-box/china_ip.json', status: 200, delegated: true },
    ]);
  });

  it('regenerates the allowlist for a historical plain snapshot rollback', async t => {
    const root = await fixture(t);
    const compressed = path.join(root, 'Internal/source-snapshots/current.json.gz');
    await fs.writeFile(compressed, 'compressed');
    await writePagesInternalGate(root);
    const first = await fs.readFile(path.join(root, '_worker.js'), 'utf8');
    await fs.rm(compressed);
    await fs.writeFile(path.join(root, 'Internal/source-snapshots/historical.json'), 'plain');
    await writePagesInternalGate(root);
    assert.notEqual(await fs.readFile(path.join(root, '_worker.js'), 'utf8'), first);
    exerciseWorker(root, [
      { pathname: '/Internal/source-snapshots/historical.json', status: 200, delegated: true },
      { pathname: '/Internal/source-snapshots/current.json.gz', status: 404, delegated: false },
    ]);
    const second = await fs.readFile(path.join(root, '_worker.js'), 'utf8');
    await writePagesInternalGate(root);
    assert.equal(await fs.readFile(path.join(root, '_worker.js'), 'utf8'), second);
  });

  it('generates an empty gate when Internal is absent', async t => {
    const root = await fixture(t);
    await fs.rm(path.join(root, 'Internal'), { recursive: true });
    await writePagesInternalGate(root);
    exerciseWorker(root, [{ pathname: '/Internal/source-snapshots/old.json', status: 404, delegated: false }]);
  });

  it('rejects symlinks and non-regular inventory entries', async t => {
    const root = await fixture(t);
    const snapshots = path.join(root, 'Internal/source-snapshots');
    await fs.writeFile(path.join(root, 'target.json'), 'outside');
    await fs.symlink(path.join(root, 'target.json'), path.join(snapshots, 'linked.json'));
    await assert.rejects(writePagesInternalGate(root), /non-regular file/);
    await fs.rm(snapshots, { recursive: true });
    await fs.symlink(root, snapshots);
    await assert.rejects(writePagesInternalGate(root), /non-regular file/);
    await fs.rm(path.join(root, 'Internal'), { recursive: true });
    await fs.symlink(root, path.join(root, 'Internal'));
    await assert.rejects(writePagesInternalGate(root), /not a regular directory/);
  });
});

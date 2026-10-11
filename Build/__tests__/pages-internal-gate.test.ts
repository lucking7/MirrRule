import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { writePagesInternalGate } from '../lib/pages-internal-gate';

async function fixture(t: { after: (fn: () => Promise<unknown>) => void }): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-pages-gate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'Internal/source-snapshots'), { recursive: true });
  return root;
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
    assert.equal(response.headers.get('content-type'), 'application/gzip');
    assert.equal(await response.text(), check.method === 'HEAD' ? '' : 'current asset');
    if (check.pathname.startsWith('/Internal/')) {
      assert.equal(response.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-robots-tag'), 'noindex');
    } else {
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
    await writePagesInternalGate(root);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, '_routes.json'), 'utf8')), {
      version: 1, include: ['/Internal/*'], exclude: [],
    });
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
      { pathname: '/List/ai.list', status: 200, delegated: true },
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

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { parseArgs } from '../audit-module-dependencies';
import {
  auditModuleDependencies,
  createHttpProbe,
  MISSING_THRESHOLD,
  MODULE_DEPENDENCY_AUDIT_PATH,
  moduleScriptUrls,
  stripScriptLines,
} from '../lib/module-dependency-audit';
import type { Probe } from '../lib/module-dependency-audit';

const DEAD = 'https://raw.githubusercontent.com/owner/repo/main/dead.js';
const LIVE = 'https://raw.githubusercontent.com/owner/repo/main/live.js';
const FLAKY = 'https://raw.githubusercontent.com/owner/repo/main/flaky.js';

const collection = [
  '#!name=Collection',
  '[Rule]',
  'DOMAIN,ads.example,REJECT',
  '[Script]',
  '# script-path=https://example.test/commented.js',
  `dead = type=http-response,pattern=^https://a\\.example/,script-path=${DEAD},requires-body=1`,
  `live = type=http-response,pattern=^https://b\\.example/,script-path=${LIVE}`,
  '[MITM]',
  'hostname = %APPEND% a.example, b.example',
  '',
].join('\n');
const deadOnly = `#!name=Dead only\n[Script]\nd = type=http-request,pattern=^https://c\\.example/,script-path=${DEAD}\n`;

const probe: Probe = url => Promise.resolve(
  url === DEAD ? { status: 'missing', httpStatus: 404 } : (url === FLAKY ? { status: 'unknown', httpStatus: 503 } : { status: 'ok', httpStatus: 200 })
);

async function tree(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-module-deps-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (relative: string, content: string) => {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.writeFile(path.join(root, relative), content);
  };
  return { root, write };
}

/** Run the audit `runs` times, carrying each report forward as the next run's baseline. */
async function runRepeatedly(root: string, runs: number, refreshed: Array<'Mirror' | 'Modules'>, restore: () => Promise<void>) {
  let baselineDir: string | null = null;
  let report: Awaited<ReturnType<typeof auditModuleDependencies>> | undefined;
  for (let run = 0; run < runs; run++) {
    // eslint-disable-next-line no-await-in-loop -- each run depends on the previous report
    await restore();
    // eslint-disable-next-line no-await-in-loop -- sequential builds
    report = await auditModuleDependencies({ publicDir: root, refreshedDirs: refreshed, baselineDir, probe, generatedAt: `run-${run}` });
    const next = path.join(root, '..', `${path.basename(root)}-baseline-${run}`);
    // eslint-disable-next-line no-await-in-loop -- copy the report as the accepted baseline
    await fs.mkdir(path.join(next, 'Internal'), { recursive: true });
    // eslint-disable-next-line no-await-in-loop -- copy the report as the accepted baseline
    await fs.copyFile(path.join(root, MODULE_DEPENDENCY_AUDIT_PATH), path.join(next, MODULE_DEPENDENCY_AUDIT_PATH));
    baselineDir = next;
  }
  if (!report) throw new Error('runRepeatedly needs at least one run');
  return report;
}

describe('module script parsing', () => {
  it('reads only active [Script] lines and strips exactly the lines loading the given scripts', () => {
    assert.deepEqual(moduleScriptUrls(collection), [DEAD, LIVE]);
    const result = stripScriptLines(collection, new Set([DEAD]));
    assert.deepEqual([...result.removed], [[DEAD, 1]]);
    assert.equal(result.remaining, 1);
    assert.equal(result.content, collection.replace(/^dead = .*\n/m, ''));
    assert.equal(stripScriptLines(deadOnly, new Set([DEAD])).remaining, 0);
  });
});

describe('module dependency audit', () => {
  it('strips a script only after three consecutive missing results and keeps the rest of the module', async t => {
    const { root, write } = await tree(t);
    const restore = () => write('Mirror/fmz200/sgmodule/Collection.sgmodule', collection);

    const early = await runRepeatedly(root, MISSING_THRESHOLD - 1, ['Mirror'], restore);
    assert.deepEqual(early.strippedLines, []);
    assert.equal(early.scripts.find(script => script.url === DEAD)?.consecutiveMissing, MISSING_THRESHOLD - 1);
    assert.equal(await fs.readFile(path.join(root, 'Mirror/fmz200/sgmodule/Collection.sgmodule'), 'utf8'), collection);

    const confirmed = await runRepeatedly(root, MISSING_THRESHOLD, ['Mirror'], restore);
    assert.deepEqual(confirmed.strippedLines, [{ module: 'Mirror/fmz200/sgmodule/Collection.sgmodule', url: DEAD, lines: 1 }]);
    const content = await fs.readFile(path.join(root, 'Mirror/fmz200/sgmodule/Collection.sgmodule'), 'utf8');
    assert.doesNotMatch(content, /dead\.js/);
    assert.match(content, /live\.js/);
    assert.match(content, /DOMAIN,ads\.example,REJECT/);
  });

  it('deletes a Mirror module whose scripts are all missing but never deletes Modules files', async t => {
    const { root, write } = await tree(t);
    const restore = async () => {
      await write('Mirror/fmz200/sgmodule/Dead.sgmodule', deadOnly);
      await write('Modules/Converted/Dead.sgmodule', deadOnly);
    };
    const report = await runRepeatedly(root, MISSING_THRESHOLD, ['Mirror', 'Modules'], restore);
    assert.deepEqual(report.removedModules, ['Mirror/fmz200/sgmodule/Dead.sgmodule']);
    await assert.rejects(fs.access(path.join(root, 'Mirror/fmz200/sgmodule/Dead.sgmodule')));
    assert.doesNotMatch(await fs.readFile(path.join(root, 'Modules/Converted/Dead.sgmodule'), 'utf8'), /dead\.js/);
  });

  it('counts but does not edit directories this run did not refresh', async t => {
    const { root, write } = await tree(t);
    const restore = () => write('Mirror/fmz200/sgmodule/Collection.sgmodule', collection);
    const report = await runRepeatedly(root, MISSING_THRESHOLD + 1, [], restore);
    assert.equal(report.scripts.find(script => script.url === DEAD)?.consecutiveMissing, MISSING_THRESHOLD + 1);
    assert.deepEqual(report.strippedLines, []);
    assert.equal(await fs.readFile(path.join(root, 'Mirror/fmz200/sgmodule/Collection.sgmodule'), 'utf8'), collection);
  });

  it('keeps tracking a stripped script and strips a refreshed copy again immediately', async t => {
    const { root, write } = await tree(t);
    await runRepeatedly(root, MISSING_THRESHOLD, ['Mirror'], () => write('Mirror/fmz200/sgmodule/Collection.sgmodule', collection));
    const baselineDir = path.join(root, '..', `${path.basename(root)}-baseline-${MISSING_THRESHOLD - 1}`);
    // A preserved run no longer references the stripped script but keeps its count.
    await write('Mirror/fmz200/sgmodule/Collection.sgmodule', collection.replace(/^dead = .*\n/m, ''));
    const preserved = await auditModuleDependencies({ publicDir: root, refreshedDirs: [], baselineDir, probe });
    assert.equal(preserved.scripts.find(script => script.url === DEAD)?.consecutiveMissing, MISSING_THRESHOLD + 1);
  });

  it('does not count unknown results and treats a missing NRRule-hosted script as missing', async t => {
    const { root, write } = await tree(t);
    const local = 'https://nrrule.pages.dev/Scripts/abc-gone.js';
    const kept = 'https://nrrule.pages.dev/Scripts/abc-kept.js';
    const restore = async () => {
      await write('Scripts/abc-kept.js', '//');
      await write('Modules/Converted/A.sgmodule', `[Script]\na = type=http-response,pattern=x,script-path=${FLAKY}\nb = type=http-response,pattern=y,script-path=${local}\nc = type=http-response,pattern=z,script-path=${kept}\n`);
    };
    const report = await runRepeatedly(root, MISSING_THRESHOLD, ['Modules'], restore);
    assert.equal(report.scripts.some(script => script.url === FLAKY), false);
    assert.deepEqual(report.strippedLines, [{ module: 'Modules/Converted/A.sgmodule', url: local, lines: 1 }]);
    assert.equal(report.scripts.some(script => script.url === kept), false);
  });

  it('classifies HTTP results and retries once on errors', async () => {
    const calls: string[] = [];
    const fake = (status: number | Error) => ((url: string) => {
      calls.push(url);
      return status instanceof Error ? Promise.reject(status) : Promise.resolve(new Response(null, { status }));
    }) as unknown as typeof fetch;
    assert.deepEqual(await createHttpProbe(fake(206))(LIVE), { status: 'ok', httpStatus: 206 });
    assert.deepEqual(await createHttpProbe(fake(404))(DEAD), { status: 'missing', httpStatus: 404 });
    assert.deepEqual(await createHttpProbe(fake(429))(FLAKY), { status: 'unknown', httpStatus: 429 });
    calls.length = 0;
    assert.deepEqual(await createHttpProbe(fake(new Error('reset')))(FLAKY), { status: 'unknown', httpStatus: null });
    assert.equal(calls.length, 2);
  });

  it('accepts only Mirror and Modules as refreshed directories', () => {
    assert.deepEqual(parseArgs(['--public', 'out', '--refreshed', 'Mirror,Modules']), { publicDir: 'out', refreshedDirs: ['Mirror', 'Modules'] });
    assert.deepEqual(parseArgs(['--refreshed', '']).refreshedDirs, []);
    assert.throws(() => parseArgs(['--refreshed', 'List']), /accepts Mirror and Modules/);
  });
});

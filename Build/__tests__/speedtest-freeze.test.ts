import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { it } from 'node:test';
import { gunzipSync } from 'node:zlib';
import undici from 'undici';

import { ROOT_DIR } from '../constants/dir';
import { ARTIFACT_LIFECYCLE_REGISTRY } from '../lib/artifact-lifecycle';
import { writeRuleOutputReports } from '../lib/output-audit';
import { RuleSourceProcessor } from '../lib/rule-source-processor';
import { ruleGroups, specialRules } from '../lib/rule-sources';
import { createSourceInventory } from '../lib/source-inventory';
import { createSpan } from '../trace';

const SUKKA_SPEEDTEST = 'https://ruleset.skk.moe/List/domainset/speedtest.conf';
const CHINA_PATH = 'List/speedtest_china.list';
const INTERNATIONAL_PATH = 'List/speedtest_international.list';
const LIVE_PATH = 'List/speedtest.list';
// SHA256 of the sorted `path sha256` lines, joined by LF, for the 18 retained regional files in
// NRRule 085c496b9f31e44d834a1106d67fbe104a65bf01's Internal/publication-manifest.json.
const ACCEPTED_REGIONAL_DIGEST = '737a03adcfaac32bc122d9b37fdd1b6f3364776d78d14b4ad85738f5dcf87e8e';

it('publishes the existing regional subscriptions from frozen archives and refreshes Sukka Speedtest', async t => {
  const extra = ruleGroups.find(group => group.name === 'Extra');
  assert.ok(extra);
  const speedtestPaths = new Set([CHINA_PATH, INTERNATIONAL_PATH, LIVE_PATH]);
  const files = extra.files.filter(file => speedtestPaths.has(file.path));
  const inventoryUrls = new Set(createSourceInventory(ruleGroups, specialRules, []).map(entry => entry.url));
  assert.ok(inventoryUrls.has(SUKKA_SPEEDTEST));
  for (const file of files) {
    if (file.path !== LIVE_PATH) assert.equal(inventoryUrls.has(file.url), false, file.url);
  }

  const requests: string[] = [];
  t.mock.method(undici, 'fetch', (url: string) => {
    requests.push(url);
    assert.equal(url, SUKKA_SPEEDTEST);
    return Promise.resolve(new undici.Response('.fast.com\nspeedtest.example.net\n', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }));
  });

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-frozen-speedtest-'));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  for (const [outputPath, alterContents] of [
    [CHINA_PATH, (body: string) => body.replace(/^# Last Updated: .*$/m, '# Last Updated: 2000-01-01')],
    [INTERNATIONAL_PATH, (body: string) => body.replaceAll('\n', '\r\n')],
  ] as const) {
    const split = path.join('List/non_ip', path.basename(outputPath));
    const archive = gunzipSync(fs.readFileSync(path.join(ROOT_DIR, 'Build/assets/frozen-rules', path.basename(outputPath) + '.gz'))).toString('utf8');
    const altered = alterContents(archive);
    assert.notEqual(altered, archive, outputPath);
    fs.mkdirSync(path.join(outputDir, 'List/non_ip'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, split), altered);
  }

  const processor = new RuleSourceProcessor(createSpan('frozen-speedtest'), outputDir);
  const stats = await processor.processRuleGroups([{ ...extra, files }]);
  assert.deepEqual(stats.errors, []);
  assert.deepEqual(requests, [SUKKA_SPEEDTEST]);
  assert.deepEqual(stats.audits.map(audit => audit.id), ['speedtest_china', 'speedtest_international', 'speedtest']);

  const regional = stats.audits.filter(audit => audit.id !== 'speedtest');
  const actualFiles: string[] = [];
  const absentFiles: string[] = [];
  for (const audit of regional) {
    assert.deepEqual(audit.sources.map(source => source.selection), ['frozen-snapshot']);
    const lifecycle = ARTIFACT_LIFECYCLE_REGISTRY.find(record => record.id === `ruleset:${audit.id}`);
    assert.equal(lifecycle?.state, 'deprecated');
    const publishedPaths: string[] = [];
    for (const output of audit.outputs) {
      const file = path.join(outputDir, output.path);
      if (output.status === 'absent-empty') {
        assert.equal(fs.existsSync(file), false, output.path);
        absentFiles.push(output.path);
        continue;
      }
      assert.equal(output.status, 'published', output.path);
      const bytes = fs.readFileSync(file);
      const digest = createHash('sha256').update(bytes).digest('hex');
      assert.equal(bytes.length, output.bytes, output.path);
      assert.equal(digest, output.sha256, output.path);
      actualFiles.push(`${output.path} ${digest}`);
      publishedPaths.push(output.path);
    }
    assert.deepEqual(lifecycle.paths.toSorted(), publishedPaths.sort());
  }
  assert.deepEqual(absentFiles.sort(), [
    'Clash/ip/speedtest_china.txt',
    'List/ip/speedtest_china.list',
    'Loon/ip/speedtest_china.list',
    'sing-box/ip/speedtest_china.json',
  ]);
  assert.equal(actualFiles.length, 18);
  assert.equal(fs.existsSync(path.join(outputDir, CHINA_PATH)), false);
  assert.equal(fs.existsSync(path.join(outputDir, INTERNATIONAL_PATH)), false);
  assert.equal(createHash('sha256').update(actualFiles.sort().join('\n')).digest('hex'), ACCEPTED_REGIONAL_DIGEST);

  const speedtest = stats.audits.find(audit => audit.id === 'speedtest');
  assert.deepEqual(speedtest?.sources.map(source => [source.selection, source.selectedUrl]), [['primary', SUKKA_SPEEDTEST]]);
  const domains = fs.readFileSync(path.join(outputDir, 'List/non_ip/speedtest.list'), 'utf8');
  assert.match(domains, /^DOMAIN-SUFFIX,fast\.com$/m);
  assert.match(domains, /^DOMAIN,speedtest\.example\.net$/m);
  const native = fs.readFileSync(path.join(outputDir, 'List/domainset/speedtest.conf'), 'utf8');
  assert.match(native, /^\.fast\.com$/m);
  assert.match(native, /^speedtest\.example\.net$/m);
  assert.equal(fs.readFileSync(path.join(outputDir, 'List/non_ip/speedtest.conf'), 'utf8'), domains);
});

it('fails on a mismatched frozen digest even with a usable baseline snapshot', async t => {
  const extra = ruleGroups.find(group => group.name === 'Extra');
  const china = extra?.files.find(file => file.path === CHINA_PATH);
  assert.ok(extra && china?.frozen);

  const fetch = t.mock.method(undici, 'fetch', () => {
    throw new Error('frozen rules must not request their upstream');
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-frozen-speedtest-invalid-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const baselineDir = path.join(root, 'baseline');
  const baselineProcessor = new RuleSourceProcessor(createSpan('frozen-speedtest-baseline'), baselineDir);
  const baseline = await baselineProcessor.processRuleGroups([{ ...extra, files: [china] }]);
  assert.deepEqual(baseline.errors, []);
  await writeRuleOutputReports({
    outputRoot: baselineDir,
    records: baseline.audits,
    generatedAt: '2026-11-19T00:00:00.000Z',
    baselineDir: null,
    baselineReceiptId: null,
  });

  const previousBaseline = process.env.PUBLICATION_BASELINE_DIR;
  process.env.PUBLICATION_BASELINE_DIR = baselineDir;
  t.after(() => {
    if (previousBaseline === undefined) delete process.env.PUBLICATION_BASELINE_DIR;
    else process.env.PUBLICATION_BASELINE_DIR = previousBaseline;
  });

  const candidateDir = path.join(root, 'candidate');
  const candidateProcessor = new RuleSourceProcessor(createSpan('frozen-speedtest-invalid'), candidateDir);
  const result = await candidateProcessor.processRuleGroups([{
    ...extra,
    files: [{ ...china, frozen: { ...china.frozen, sha256: '0'.repeat(64) } }],
  }]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].file, china.path);
  assert.match(result.errors[0].error, /Frozen rule snapshot digest mismatch/);
  assert.equal(result.filesProcessed, 0);
  assert.equal(fs.existsSync(path.join(candidateDir, china.path)), false);
  assert.equal(fetch.mock.callCount(), 0);
});

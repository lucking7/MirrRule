import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';

import type { RuleGroup, SpecialRuleConfig } from '../lib/rule-source-types';

interface FakeSpan {
  traceChild: () => FakeSpan;
  traceSyncFn: <T>(fn: (span: FakeSpan) => T) => T;
  traceAsyncFn: <T>(fn: (span: FakeSpan) => T | Promise<T>) => Promise<T>;
  tracePromise: <T>(promise: Promise<T>) => Promise<T>;
  traceChildSync: <T>(_name: string, fn: (span: FakeSpan) => T) => T;
  traceChildAsync: <T>(_name: string, fn: (span: FakeSpan) => T | Promise<T>) => Promise<T>;
  traceChildPromise: <T>(_name: string, promise: Promise<T>) => Promise<T>;
  stop: () => void;
  traceResult: { name: string; start: number; end: number; children: unknown[] };
}

const fakeSpan: FakeSpan = {
  traceChild() {
    return fakeSpan;
  },
  traceSyncFn(fn) {
    return fn(fakeSpan);
  },
  traceAsyncFn(fn) {
    return Promise.resolve(fn(fakeSpan));
  },
  tracePromise(promise) {
    return promise;
  },
  traceChildSync(_name, fn) {
    return fn(fakeSpan);
  },
  traceChildAsync(_name, fn) {
    return Promise.resolve(fn(fakeSpan));
  },
  traceChildPromise(_name, promise) {
    return promise;
  },
  stop() {
    // no-op
  },
  traceResult: { name: 'fake', start: 0, end: 0, children: [] },
};

const fixtureRules = [
  String.raw`URL-REGEX,^https://z\.example/path`,
  'DOMAIN-SUFFIX,z.example',
  'IP-CIDR6,2001:db8::/32',
  'DOMAIN,exact.example',
  'PROCESS-NAME,Example App',
  'IP-ASN,64512',
  'DOMAIN-WILDCARD,*.wild.example',
  'GEOIP,US',
  'DOMAIN-KEYWORD,keyword',
  'USER-AGENT,Example*',
  '.shorthand.example',
  'IP-CIDR,192.0.2.0/24',
  'DOMAIN-SUFFIX,z.example',
  'DOMAIN,a.example',
];

const goldenRoot = path.join(__dirname, 'fixtures', 'goldens');
const localRequire = createRequire(__filename);
const goldenFiles = [
  ['List/ordinary-golden.list', 'ordinary-golden.surge.list'],
  ['Clash/ordinary-golden.txt', 'ordinary-golden.clash.txt'],
  ['Loon/ordinary-golden.list', 'ordinary-golden.loon.list'],
  ['sing-box/ordinary-golden.json', 'ordinary-golden.singbox.json'],
  ['List/special-golden.list', 'special-golden.surge.list'],
  ['Clash/special-golden.txt', 'special-golden.clash.txt'],
  ['Loon/special-golden.list', 'special-golden.loon.list'],
  ['sing-box/special-golden.json', 'special-golden.singbox.json'],
] as const;

function createTempSourceModule(tempDir: string, name: string, rules: string[]) {
  const filePath = path.join(tempDir, `${name}.ts`);
  fs.writeFileSync(
    filePath,
    `export function getAllRules() { return ${JSON.stringify(rules)}; }\n`
  );
  return filePath;
}

function compareOrUpdateGoldens(outputDir: string) {
  const update = process.env.UPDATE_GOLDEN === '1';

  if (update) {
    fs.mkdirSync(goldenRoot, { recursive: true });
  }

  for (const [outputPath, fixtureName] of goldenFiles) {
    const actual = fs.readFileSync(path.join(outputDir, outputPath));
    const fixturePath = path.join(goldenRoot, fixtureName);

    if (update) {
      fs.writeFileSync(fixturePath, actual);
      continue;
    }

    assert.equal(
      fs.existsSync(fixturePath),
      true,
      `Missing golden fixture ${fixturePath}; review outputs, then run with UPDATE_GOLDEN=1`
    );
    assert.equal(actual.equals(fs.readFileSync(fixturePath)), true, `${fixtureName} changed`);
  }
}

describe('four-platform golden pipeline', () => {
  it('persists stable ordinary and special-rule outputs without network access', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-01T00:00:00.000Z') });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-four-platform-'));
    const outputDir = path.join(tempDir, 'output');
    const fetchAssetsId = localRequire.resolve('../utils/network/fetch-assets');
    localRequire(fetchAssetsId);
    const fetchAssetsCacheEntry = localRequire.cache[fetchAssetsId];
    assert.ok(fetchAssetsCacheEntry);
    const originalFetchAssetsExports = fetchAssetsCacheEntry.exports;
    let fetchCallCount = 0;
    fetchAssetsCacheEntry.exports = {
      fetchAssets() {
        fetchCallCount++;
        return Promise.resolve(fixtureRules);
      },
    };

    try {
      const { RuleSourceProcessor } = localRequire('../lib/rule-source-processor') as typeof import('../lib/rule-source-processor');
      const processor = new RuleSourceProcessor(fakeSpan as never, outputDir);
      const ordinaryConfig: RuleGroup = {
        name: 'Ordinary Golden',
        description: 'Offline ordinary rule pipeline fixture',
        targets: ['surge', 'clash', 'loon', 'singbox'],
        defaultPolicy: null,
        files: [{
          path: 'List/ordinary-golden.list',
          url: 'https://fixture.invalid/ordinary.list',
          dedup: true,
          sort: true,
          formatConversion: true,
        }],
      };
      const firstSource = createTempSourceModule(tempDir, 'special-first', fixtureRules.slice(0, 7));
      const secondSource = createTempSourceModule(tempDir, 'special-second', fixtureRules.slice(7));
      const specialConfig: SpecialRuleConfig = {
        name: 'Special Golden',
        description: 'Offline merged special-rule pipeline fixture',
        targetFile: 'List/special-golden.list',
        sourceFiles: [firstSource, secondSource],
        targets: ['surge', 'clash', 'loon', 'singbox'],
        defaultPolicy: null,
        dedup: true,
        sort: true,
        formatConversion: true,
      };

      const ordinaryStats = await processor.processRuleGroups([ordinaryConfig]);
      const specialStats = await processor.processSpecialRules([specialConfig]);

      assert.deepEqual(ordinaryStats.errors, []);
      assert.equal(ordinaryStats.filesProcessed, 1);
      assert.equal(ordinaryStats.rulesMerged, fixtureRules.length);
      assert.deepEqual(specialStats.errors, []);
      assert.equal(specialStats.filesProcessed, 1);
      assert.equal(specialStats.rulesMerged, fixtureRules.length);
      assert.equal(fetchCallCount, 1);

      // sing-box intentionally characterizes the currently supported subset; unsupported rules are omitted.
      compareOrUpdateGoldens(outputDir);
    } finally {
      fetchAssetsCacheEntry.exports = originalFetchAssetsExports;
      fs.rmSync(tempDir, { recursive: true, force: true });
      t.mock.timers.reset();
    }
  });
});

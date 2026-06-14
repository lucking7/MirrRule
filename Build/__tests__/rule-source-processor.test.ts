import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { RuleSourceProcessor } from '../lib/rule-source-processor';
import type { SpecialRuleConfig } from '../lib/rule-source-types';

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

function createTempSourceModule(tempDir: string, name: string, rules: string[]) {
  const filePath = path.join(tempDir, `${name}.ts`);
  fs.writeFileSync(
    filePath,
    `export function getAllRules() { return ${JSON.stringify(rules)}; }\n`
  );
  return filePath;
}

describe('RuleSourceProcessor special rules', () => {
  it('does not write output when one source fails to load', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-special-rule-'));
    const outputDir = path.join(tempDir, 'output');

    try {
      fs.mkdirSync(outputDir, { recursive: true });

      const goodSourcePath = createTempSourceModule(tempDir, 'good-source', [
        'DOMAIN,ok.example',
      ]);
      const missingSourcePath = path.join(tempDir, 'missing-source.ts');

      const processor = new RuleSourceProcessor(fakeSpan as any, outputDir);
      const config: SpecialRuleConfig = {
        name: 'Partial Test',
        targetFile: 'List/partial-test.list',
        sourceFiles: [goodSourcePath, missingSourcePath],
        targets: ['surge'],
        defaultPolicy: null,
        dedup: true,
        sort: true,
        formatConversion: true,
      };

      const stats = await processor.processSpecialRules([config]);

      assert.ok(stats.errors.length >= 1, 'expected at least one error');
      assert.equal(stats.filesProcessed, 0);
      assert.equal(
        fs.existsSync(path.join(outputDir, 'List', 'partial-test.list')),
        false,
        'partial output should not be written'
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('writes output when all sources load successfully', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-special-rule-'));
    const outputDir = path.join(tempDir, 'output');

    try {
      fs.mkdirSync(outputDir, { recursive: true });

      const firstSourcePath = createTempSourceModule(tempDir, 'first-source', [
        'DOMAIN,first.example',
      ]);
      const secondSourcePath = createTempSourceModule(tempDir, 'second-source', [
        'DOMAIN,second.example',
      ]);

      const processor = new RuleSourceProcessor(fakeSpan as any, outputDir);
      const config: SpecialRuleConfig = {
        name: 'Success Test',
        targetFile: 'List/success-test.list',
        sourceFiles: [firstSourcePath, secondSourcePath],
        targets: ['surge'],
        defaultPolicy: null,
        dedup: true,
        sort: true,
        formatConversion: true,
      };

      const stats = await processor.processSpecialRules([config]);

      assert.equal(stats.errors.length, 0);
      assert.equal(stats.filesProcessed, 1);
      assert.equal(
        fs.existsSync(path.join(outputDir, 'List', 'success-test.list')),
        true,
        'expected output file to be written'
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

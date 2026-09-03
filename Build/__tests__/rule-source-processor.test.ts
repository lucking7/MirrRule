import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { RuleSourceProcessor } from '../lib/rule-source-processor';
import type { RuleGroup, SpecialRuleConfig } from '../lib/rule-source-types';
import { fetchAssets } from '../utils/network/fetch-assets';

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

async function withRuleServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(request.url === '/rules' ? 'DOMAIN,example.com\n' : '');
  });

  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;

  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

describe('fetchAssets empty responses', () => {
  it('rejects an empty 200 by default and accepts a non-empty 200', async () => {
    await withRuleServer(async baseUrl => {
      await assert.rejects(fetchAssets(`${baseUrl}/empty`, null, true), /empty response w\/o 304/);
      assert.deepEqual(await fetchAssets(`${baseUrl}/rules`, null, true), [
        'DOMAIN,example.com',
      ]);
    });
  });
});

describe('RuleSourceProcessor ordinary rules', () => {
  it('downloads concurrently but applies success and error stats in configuration order', async () => {
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const pending: Array<{ url: string; response: http.ServerResponse }> = [];
    const server = http.createServer((request, response) => {
      activeRequests++;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      pending.push({ url: request.url ?? '', response });
      if (pending.length === 3) {
        for (const item of pending) {
          item.response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
          item.response.end(item.url === '/second' ? '' : `DOMAIN,${item.url.slice(1)}.example\n`);
          activeRequests--;
        }
      }
    });
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-concurrent-rule-'));

    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      const processor = new RuleSourceProcessor(fakeSpan as any, tempDir);
      const stats = await processor.processRuleGroups([{
        name: 'Concurrent Test',
        files: [
          { path: 'List/first.list', url: `${baseUrl}/first` },
          { path: 'List/second.list', url: `${baseUrl}/second` },
          { path: 'List/third.list', url: `${baseUrl}/third` },
        ],
        targets: ['surge'],
        defaultPolicy: null,
      }]);

      assert.ok(maximumActiveRequests > 1, 'expected overlapping source downloads');
      assert.equal(stats.filesProcessed, 2);
      assert.equal(stats.rulesMerged, 2);
      assert.deepEqual(stats.errors.map(error => error.file), ['List/second.list']);
      assert.equal(fs.existsSync(path.join(tempDir, 'List', 'first.list')), true);
      assert.equal(fs.existsSync(path.join(tempDir, 'List', 'second.list')), false);
      assert.equal(fs.existsSync(path.join(tempDir, 'List', 'third.list')), true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      await new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it('records an empty 200 as an error and writes no output by default', async () => {
    await withRuleServer(async baseUrl => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-ordinary-rule-'));

      try {
        const processor = new RuleSourceProcessor(fakeSpan as any, tempDir);
        const groups: RuleGroup[] = [{
          name: 'Empty Test',
          files: [{ path: 'List/empty.list', url: `${baseUrl}/empty` }],
          targets: ['surge'],
          defaultPolicy: null,
        }];

        const stats = await processor.processRuleGroups(groups);

        assert.equal(stats.errors.length, 1);
        assert.equal(stats.filesProcessed, 0);
        assert.equal(fs.existsSync(path.join(tempDir, 'List', 'empty.list')), false);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  it('honors explicit false and passes explicit true as the empty-response policy', async () => {
    await withRuleServer(async baseUrl => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-ordinary-rule-'));

      try {
        const processor = new RuleSourceProcessor(fakeSpan as any, tempDir);
        const groups: RuleGroup[] = [{
          name: 'Empty Policy Test',
          files: [
            { path: 'List/empty-false.list', url: `${baseUrl}/empty`, allowEmpty: false },
            { path: 'List/empty-true.list', url: `${baseUrl}/empty`, allowEmpty: true },
          ],
          targets: ['surge'],
          defaultPolicy: null,
        }];

        const stats = await processor.processRuleGroups(groups);

        assert.equal(stats.errors.length, 1);
        assert.equal(stats.filesProcessed, 1);
        assert.equal(fs.existsSync(path.join(tempDir, 'List', 'empty-false.list')), false);
        assert.equal(fs.existsSync(path.join(tempDir, 'List', 'empty-true.list')), true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  it('writes output for a non-empty 200', async () => {
    await withRuleServer(async baseUrl => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-ordinary-rule-'));

      try {
        const processor = new RuleSourceProcessor(fakeSpan as any, tempDir);
        const groups: RuleGroup[] = [{
          name: 'Non-empty Test',
          files: [{ path: 'List/non-empty.list', url: `${baseUrl}/rules` }],
          targets: ['surge'],
          defaultPolicy: null,
        }];

        const stats = await processor.processRuleGroups(groups);

        assert.equal(stats.errors.length, 0);
        assert.equal(stats.filesProcessed, 1);
        assert.equal(fs.existsSync(path.join(tempDir, 'List', 'non-empty.list')), true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});

describe('RuleSourceProcessor special rules', () => {
  it('publishes equivalent normalized rules for ordinary and special inputs', async () => {
    await withRuleServer(async baseUrl => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-rule-parity-'));
      const sourcePath = createTempSourceModule(tempDir, 'parity-source', [
        'DOMAIN,example.com',
      ]);

      try {
        const processor = new RuleSourceProcessor(fakeSpan as any, tempDir);
        await processor.processRuleGroups([{
          name: 'Ordinary Parity',
          files: [{ path: 'List/ordinary.list', url: `${baseUrl}/rules` }],
          targets: ['surge'],
          defaultPolicy: null,
        }]);
        await processor.processSpecialRules([{
          name: 'Special Parity',
          targetFile: 'List/special.list',
          sourceFiles: [sourcePath],
          targets: ['surge'],
          defaultPolicy: null,
        }]);

        const ruleLines = (filePath: string) => fs.readFileSync(filePath, 'utf8')
          .split(/\r?\n/)
          .filter(line => line && !line.startsWith('#'));
        assert.deepEqual(
          ruleLines(path.join(tempDir, 'List', 'ordinary.list')),
          ruleLines(path.join(tempDir, 'List', 'special.list'))
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  it('records an empty URL response as an error and writes no output by default', async () => {
    await withRuleServer(async baseUrl => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-special-rule-'));

      try {
        const processor = new RuleSourceProcessor(fakeSpan as any, tempDir);
        const config: SpecialRuleConfig = {
          name: 'Empty URL Test',
          targetFile: 'List/empty-url.list',
          sourceFiles: [`${baseUrl}/empty`],
          targets: ['surge'],
          defaultPolicy: null,
        };

        const stats = await processor.processSpecialRules([config]);

        assert.equal(stats.errors.length, 1);
        assert.equal(stats.filesProcessed, 0);
        assert.equal(fs.existsSync(path.join(tempDir, 'List', 'empty-url.list')), false);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  it('allows an opted-in empty URL source but rejects an all-empty special rule', async () => {
    await withRuleServer(async baseUrl => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-special-rule-'));

      try {
        const processor = new RuleSourceProcessor(fakeSpan as any, tempDir);
        const config: SpecialRuleConfig = {
          name: 'Allowed Empty URL Test',
          targetFile: 'List/allowed-empty-url.list',
          sourceFiles: [`${baseUrl}/empty`],
          allowEmpty: true,
          targets: ['surge'],
          defaultPolicy: null,
        };

        const stats = await processor.processSpecialRules([config]);

        assert.equal(stats.errors.length, 1);
        assert.match(stats.errors[0]?.error ?? '', /No rules loaded/);
        assert.equal(stats.filesProcessed, 0);
        assert.equal(fs.existsSync(path.join(tempDir, 'List', 'allowed-empty-url.list')), false);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

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

  it('processes a large special source successfully', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-large-special-rule-'));
    const outputDir = path.join(tempDir, 'output');

    try {
      fs.mkdirSync(outputDir, { recursive: true });

      const largeRules = Array.from(
        { length: 120000 },
        (_, index) => `DOMAIN,large-${index}.example`
      );
      const sourcePath = createTempSourceModule(tempDir, 'large-source', largeRules);
      const processor = new RuleSourceProcessor(fakeSpan as any, outputDir);
      const config: SpecialRuleConfig = {
        name: 'Large Source Test',
        targetFile: 'List/large-source.list',
        sourceFiles: [sourcePath],
        targets: ['surge'],
        defaultPolicy: 'REJECT',
        dedup: true,
        sort: true,
        formatConversion: true,
      };

      const stats = await processor.processSpecialRules([config]);
      const outputPath = path.join(outputDir, 'List', 'large-source.list');

      assert.equal(stats.errors.length, 0);
      assert.equal(stats.filesProcessed, 1);
      assert.equal(stats.rulesMerged, largeRules.length);
      assert.equal(fs.existsSync(outputPath), true);
      assert.match(fs.readFileSync(outputPath, 'utf8'), /large-119999\.example/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

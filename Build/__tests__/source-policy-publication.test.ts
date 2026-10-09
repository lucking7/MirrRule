import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { RuleSourceProcessor } from '../lib/rule-source-processor';
import { createSpan } from '../trace';
import type { RuleTarget } from '../lib/rule-source-types';

const outputs = [
  ['List', 'list'], ['Clash', 'txt'], ['Loon', 'list'], ['sing-box', 'json'],
];

async function withProxyOnlySource(verify: (url: string, outputDir: string, paths: string[]) => Promise<void>) {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('host-keyword, amp-api.podcasts.apple.com, proxy\n');
  });
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-empty-policy-publication-'));
  const paths = outputs.map(([directory, extension]) => {
    const file = path.join(outputDir, directory, `direct-fmz.${extension}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'last-known-good');
    return file;
  });
  try {
    await verify(`http://127.0.0.1:${port}/filterFix.list`, outputDir, paths);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

async function publishDirect(url: string, outputDir: string, allowEmpty = false, targets: RuleTarget[] = ['surge', 'clash', 'singbox', 'loon']) {
  return new RuleSourceProcessor(createSpan('source-policy-publication'), outputDir).processRuleGroups([{
    name: 'Direct',
    defaultPolicy: null,
    targets,
    files: [{
      path: 'List/direct-fmz.list',
      url,
      sourcePolicies: ['direct'],
      validate: true,
      allowEmpty,
    }],
  }]);
}

describe('source-policy publication boundary', () => {
  it('fails a nonempty source whose policies are all excluded and preserves four-platform outputs', async () => {
    await withProxyOnlySource(async (url, outputDir, paths) => {
      const stats = await publishDirect(url, outputDir);
      assert.equal(stats.filesProcessed, 0);
      assert.equal(stats.errors.length, 1);
      assert.equal(stats.errors[0].file, 'List/direct-fmz.list');
      assert.match(stats.errors[0].error, /source[- ]policy|source policies/i);
      assert.deepEqual(stats.rulesets, []);
      for (const file of paths) assert.equal(fs.readFileSync(file, 'utf8'), 'last-known-good');
    });
  });

  it('allowEmpty cannot publish a conditionless sing-box ruleset or overwrite sibling outputs', async () => {
    await withProxyOnlySource(async (url, outputDir, paths) => {
      const stats = await publishDirect(url, outputDir, true);
      assert.equal(stats.filesProcessed, 0);
      assert.equal(stats.errors.length, 1);
      assert.match(stats.errors[0].error, /without matching conditions/);
      assert.deepEqual(stats.rulesets, []);
      for (const file of paths) assert.equal(fs.readFileSync(file, 'utf8'), 'last-known-good');
    });
  });

  it('retains explicit allowEmpty for the text platforms', async () => {
    await withProxyOnlySource(async (url, outputDir, paths) => {
      const stats = await publishDirect(url, outputDir, true, ['surge', 'clash', 'loon']);
      assert.equal(stats.filesProcessed, 1);
      assert.deepEqual(stats.errors, []);
      assert.equal(stats.rulesets[0].ruleCount, 0);
      for (const file of paths) {
        const content = fs.readFileSync(file, 'utf8');
        if (file.endsWith('.json')) {
          assert.equal(content, 'last-known-good');
        } else {
          assert.notEqual(content, 'last-known-good');
          assert.equal(content.split('\n').filter(line => line && !line.startsWith('#')).length, 0);
        }
      }
    });
  });
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { RuleSourceProcessor } from '../lib/rule-source-processor';
import { specialRules } from '../lib/rule-sources';
import { createSpan } from '../trace';

test('AI preserves Meta CIDRs on every platform, including sing-box without ASN support', async t => {
  const ai = specialRules.find(rule => rule.targetFile === 'List/ai.list');
  assert.ok(ai);
  const fixtures: Record<string, string | undefined> = {
    'https://ruleset.skk.moe/List/non_ip/ai.conf': 'DOMAIN-SUFFIX,claude.ai\n',
    'https://ruleset.skk.moe/List/ip/ai.conf': 'IP-CIDR,198.51.100.0/24,no-resolve\nIP-ASN,399358\n',
    'https://github.com/dler-io/Rules/raw/main/Surge/Surge%203/Provider/AI%20Suite.list': 'DOMAIN,api.ai.test,AI\nDOMAIN,maps.googleapis.com,AI\nDOMAIN-SUFFIX,intercom.io,AI\n',
    'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ai-!cn.list': '+.openai.com\n+.anthropic.com\nfull:meta.ai.test\n',
    'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/asn/AS399358.list': '203.0.113.0/24\n2001:db8:3993::/48\n',
  };
  const server = http.createServer((request, response) => {
    const source = decodeURIComponent(request.url?.slice(1) ?? '');
    const body = fixtures[source];
    response.writeHead(body ? 200 : 404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(body ?? 'Missing AI source fixture');
  });
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) reject(error);
      else resolve();
    });
  }));
  const { port } = server.address() as AddressInfo;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-ai-rules-'));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  const processor = new RuleSourceProcessor(createSpan('ai-rules'), outputDir);
  const stats = await processor.processSpecialRules([{
    ...ai,
    sourceFiles: ai.sourceFiles.map(source => {
      assert.ok(fixtures[source], `missing AI fixture: ${source}`);
      return `http://127.0.0.1:${port}/${encodeURIComponent(source)}`;
    }),
  }]);
  assert.deepEqual(stats.errors, []);
  assert.equal(stats.filesProcessed, 1);

  const domains = [
    'api.ai.test',
    'maps.googleapis.com',
    'meta.ai.test',
  ];
  const suffixes = ['claude.ai', 'openai.com', 'anthropic.com', 'intercom.io'];
  const nonIpRules = [
    ...domains.map(domain => `DOMAIN,${domain}`),
    ...suffixes.map(domain => `DOMAIN-SUFFIX,${domain}`),
  ];
  const ipRules = [
    'IP-CIDR,198.51.100.0/24,no-resolve',
    'IP-CIDR,203.0.113.0/24',
    'IP-CIDR6,2001:db8:3993::/48',
    'IP-ASN,399358',
  ];
  for (const [variant, expected] of [
    ['', [...nonIpRules, ...ipRules]],
    ['non_ip', nonIpRules],
    ['ip', ipRules],
  ] as const) {
    for (const [directory, extension] of [['List', 'list'], ['Clash', 'txt'], ['Loon', 'list']]) {
      const outputPath = path.join(outputDir, directory, variant, `ai.${extension}`);
      const lines: string[] = [];
      for (const line of fs.readFileSync(outputPath, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) lines.push(trimmed);
      }
      // Keep upstream coverage without adding personal routing or blocking rules.
      assert.deepEqual(lines.sort(), [...expected].sort(), `${directory}/${variant || 'flat'}`);
    }

    const json = JSON.parse(fs.readFileSync(path.join(outputDir, 'sing-box', variant, 'ai.json'), 'utf8')) as {
      version: number;
      rules: Array<Record<string, string[]>>;
    };
    assert.equal(json.version, 2);
    assert.equal(json.rules.length, 1);
    const conditions: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(json.rules[0])) {
      if (values.length > 0) conditions[key] = values.sort();
    }
    assert.deepEqual(conditions, {
      ...(variant !== 'ip' && { domain: [...domains].sort(), domain_suffix: [...suffixes].sort() }),
      ...(variant !== 'non_ip' && { ip_cidr: ['198.51.100.0/24', '203.0.113.0/24', '2001:db8:3993::/48'].sort() }),
    }, `sing-box/${variant || 'flat'}`);
  }
});

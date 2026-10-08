import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { RuleSourceProcessor } from '../lib/rule-source-processor';
import { ruleGroups, specialRules } from '../lib/rule-sources';
import { createSpan } from '../trace';

// Representative release rules include gaps absent from the prior aggregate subscriptions.
const fixtures = {
  container: [
    'DOMAIN-SUFFIX,azurecr.io',
    'DOMAIN-SUFFIX,docker.io',
    'DOMAIN-SUFFIX,ecr.aws',
    'DOMAIN-SUFFIX,gcr.io',
    'DOMAIN-SUFFIX,ghcr.io',
    'DOMAIN-SUFFIX,mcr.microsoft.com',
    'DOMAIN-SUFFIX,quay.io',
    'DOMAIN-SUFFIX,registry.gitlab.com',
    'DOMAIN-SUFFIX,registry.k8s.io',
  ],
  discord: [
    'DOMAIN-SUFFIX,airhorn.solutions',
    'DOMAIN-SUFFIX,airhornbot.com',
    'DOMAIN-SUFFIX,bigbeans.solutions',
    'DOMAIN-SUFFIX,watchanimeattheoffice.com',
    'DOMAIN-SUFFIX,discord.com',
  ],
  scholar: [
    'DOMAIN,databank.worldbank.org',
    'DOMAIN-SUFFIX,acs.org',
    'DOMAIN-SUFFIX,aclweb.org',
    'DOMAIN-SUFFIX,alphaxiv.org',
    'DOMAIN-SUFFIX,nature.com',
  ],
};

type SubscriptionId = keyof typeof fixtures;

function getSubscription(id: SubscriptionId) {
  const config = specialRules.find(rule => rule.targetFile === `List/${id}.list`);
  assert.ok(config, `missing subscription: ${id}`);
  return config;
}

async function withFixtureServer(empty: boolean, verify: (baseUrl: string, outputDir: string) => Promise<void>) {
  const server = http.createServer((request, response) => {
    const id = request.url?.slice(1) ?? '';
    const rules = (fixtures as Partial<Record<string, string[]>>)[id];
    response.writeHead(rules ? 200 : 404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(empty ? '# No emitted rules\n' : `# Released domain rules\n${rules?.join('\n') ?? ''}\n`);
  });
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-geosite-subscriptions-'));
  try {
    await verify(`http://127.0.0.1:${port}`, outputDir);
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

describe('independent geosite subscriptions', () => {
  it('adds distinct subscriptions without changing aggregate or direct routing identities', () => {
    const paths = [
      ...ruleGroups.flatMap(group => group.files.map(file => file.path)),
      ...specialRules.map(rule => rule.targetFile),
    ];
    assert.equal(new Set(paths).size, paths.length, 'each output has exactly one publisher');
    for (const id of Object.keys(fixtures) as SubscriptionId[]) {
      const config = getSubscription(id);
      assert.deepEqual(config.targets, ['surge', 'clash', 'singbox', 'loon']);
      assert.equal(config.defaultPolicy, null);
      assert.notEqual(config.allowEmpty, true);
    }
    const scholar = getSubscription('scholar').sourceFiles[0];
    assert.equal(scholar, 'https://raw.githubusercontent.com/lucking7/surge-rules-dat/release/geo/geosite/category-scholar-!cn.list');
    assert.equal(specialRules.find(rule => rule.targetFile === 'List/ai.list')?.sourceFiles.includes(scholar), false);
    assert.deepEqual(specialRules.find(rule => rule.targetFile === 'List/direct.list')?.sourceFiles, [
      'https://ruleset.skk.moe/List/non_ip/my_direct.conf',
      'https://ruleset.skk.moe/List/non_ip/direct.conf',
    ]);
  });

  it('publishes previously missing domains and exact/suffix semantics on all four platforms', async () => {
    await withFixtureServer(false, async (baseUrl, outputDir) => {
      const configs = (Object.keys(fixtures) as SubscriptionId[]).map(id => ({
        ...getSubscription(id),
        sourceFiles: [`${baseUrl}/${id}`],
      }));
      const processor = new RuleSourceProcessor(createSpan('geosite-subscriptions'), outputDir);
      const stats = await processor.processSpecialRules(configs);
      assert.deepEqual(stats.errors, []);
      assert.equal(stats.filesProcessed, 3);
      for (const id of Object.keys(fixtures) as SubscriptionId[]) {
        const expected = fixtures[id];
        for (const [directory, extension] of [['List', 'list'], ['Clash', 'txt'], ['Loon', 'list']]) {
          const text = fs.readFileSync(path.join(outputDir, directory, `${id}.${extension}`), 'utf8');
          const rules = text.split('\n').filter(line => line.startsWith('DOMAIN'));
          assert.deepEqual(rules.sort(), [...expected].sort());
        }
        const json = JSON.parse(fs.readFileSync(path.join(outputDir, 'sing-box', `${id}.json`), 'utf8'));
        const domains: string[] = json.rules.flatMap((rule: { domain?: string[], domain_suffix?: string[] }) => [
          ...(rule.domain ?? []).map(domain => `DOMAIN,${domain}`),
          ...(rule.domain_suffix ?? []).map(domain => `DOMAIN-SUFFIX,${domain}`),
        ]);
        assert.deepEqual(domains.sort(), [...expected].sort());
      }
    });
  });

  it('rejects a comment-only upstream and preserves every last-known-good platform file', async () => {
    await withFixtureServer(true, async (baseUrl, outputDir) => {
      const previous = 'last-known-good';
      const paths = [['List', 'list'], ['Clash', 'txt'], ['Loon', 'list'], ['sing-box', 'json']].map(([directory, extension]) => {
        const file = path.join(outputDir, directory, `container.${extension}`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, previous);
        return file;
      });
      const processor = new RuleSourceProcessor(createSpan('empty-geosite-subscription'), outputDir);
      const stats = await processor.processSpecialRules([{
        ...getSubscription('container'),
        sourceFiles: [`${baseUrl}/container`],
      }]);
      assert.equal(stats.filesProcessed, 0);
      assert.equal(stats.errors.length, 1);
      for (const file of paths) assert.equal(fs.readFileSync(file, 'utf8'), previous);
    });
  });
});

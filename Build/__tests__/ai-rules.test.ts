import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  ANTHROPIC_IP_DOCS_URL,
  extractRipestatAsn,
  isAnthropicIpDocsUrl,
  isRipestatAnnouncedPrefixesUrl,
  loadAnthropicDocsIpRules,
  loadOpenAiVoiceIpRules,
  loadRipestatAsnRules,
} from '../lib/primary-ip-sources';
import { RuleSourceProcessor } from '../lib/rule-source-processor';
import { specialRules } from '../lib/rule-sources';
import { createSpan } from '../trace';
import { loadRules } from '../utils/rule-loader';

const RIPESTAT_AS399358_URL = 'https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS399358';
const OPENAI_VOICE_URL = 'https://openai.com/chatgpt-voice.json';

function readRulesFile(file: string): string[] {
  const rules: string[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) rules.push(trimmed);
  }
  return rules.sort();
}

function readSingboxConditions(file: string): Record<string, string[]> {
  const json = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    version: number;
    rules: Array<Record<string, string[]>>;
  };
  assert.equal(json.version, 2);
  assert.equal(json.rules.length, 1);
  const conditions: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(json.rules[0])) {
    if (values.length > 0) conditions[key] = values.sort();
  }
  return conditions;
}

test('publishes aggregate and provider AI rules with their original IP matching behavior on all four platforms', async t => {
  const ai = specialRules.find(rule => rule.targetFile === 'List/ai.list');
  const openai = specialRules.find(rule => rule.targetFile === 'List/openai.list');
  const anthropic = specialRules.find(rule => rule.targetFile === 'List/anthropic.list');
  assert.ok(ai);
  assert.ok(openai);
  assert.ok(anthropic);
  assert.ok(ai.sourceFiles.includes(ANTHROPIC_IP_DOCS_URL));
  assert.ok(ai.sourceFiles.includes(RIPESTAT_AS399358_URL));

  const textFixtures: Record<string, string | undefined> = {
    'https://ruleset.skk.moe/List/non_ip/ai.conf': 'DOMAIN-SUFFIX,claude.ai\n',
    'https://ruleset.skk.moe/List/ip/ai.conf': 'IP-CIDR,198.51.100.0/24,no-resolve\nIP-ASN,399358\n',
    'https://github.com/dler-io/Rules/raw/main/Surge/Surge%203/Provider/AI%20Suite.list': 'DOMAIN,api.ai.test,AI\nDOMAIN,maps.googleapis.com,AI\nDOMAIN-SUFFIX,intercom.io,AI\n',
    'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ai-!cn.list': '+.openai.com\n+.anthropic.com\nfull:meta.ai.test\n',
    'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/openai.list': [
      '+.openai.com', '+.chatgpt.com', '+.chatgpt.livekit.cloud', '+.host.livekit.cloud', '+.turn.livekit.cloud',
      'openaiassets.blob.core.windows.net', 'o33249.ingest.sentry.io', 'browser-intake-datadoghq.com',
    ].join('\n'),
    'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/anthropic.list': [
      '+.anthropic.com', '+.claude.ai', '+.claude.com', '+.claudeusercontent.com', '+.claudemcpcontent.com',
      'servd-anthropic-website.b-cdn.net', 'http-intake.logs.us5.datadoghq.com', 'o1158394.ingest.us.sentry.io',
    ].join('\n'),
    [OPENAI_VOICE_URL]: JSON.stringify({
      creationTime: '2026-11-23T00:00:00Z',
      prefixes: [{ ipv4Prefix: '198.51.100.0/24' }, { ipv6Prefix: '2001:db8:1::/48' }],
    }),
    [ANTHROPIC_IP_DOCS_URL]: [
      '## Inbound IP addresses',
      '### IPv4',
      '`160.79.104.0/23`',
      '`153.61.224.0/22`',
      '### IPv6',
      '`2607:6bc0::/48`',
      '## Outbound IP addresses',
      '`160.79.104.0/21`',
      '`153.61.208.0/20`',
    ].join('\n'),
    [RIPESTAT_AS399358_URL]: JSON.stringify({
      status: 'ok',
      data: {
        resource: '399358',
        query_endtime: '2026-11-18T16:00:00',
        prefixes: [
          { prefix: '160.79.104.0/23', timelines: [{ endtime: '2026-11-18T16:00:00' }] },
          { prefix: '2607:6bc0::/48', timelines: [{ endtime: '2026-11-18T16:00:00' }] },
          { prefix: '2607:6bc0:11::/48', timelines: [{ endtime: '2026-11-18T16:00:00' }] },
          { prefix: '203.0.113.0/24', timelines: [{ endtime: '2026-11-10T00:00:00' }] },
        ],
      },
    }),
  };

  const rdapFixtures: Record<string, unknown> = {
    '/rdap/autnum/399358': {
      startAutnum: 399358,
      endAutnum: 399358,
      entities: [{ handle: 'AP-2440', roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', 'Anthropic, PBC']]] }],
    },
    '/rdap/ip/160.79.104.0/23': {
      cidr0_cidrs: [{ v4prefix: '160.79.104.0', length: 21 }],
      entities: [{ handle: 'AP-2440', roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', 'Anthropic, PBC']]] }],
    },
    '/rdap/ip/153.61.224.0/22': {
      cidr0_cidrs: [{ v4prefix: '153.61.0.0', length: 16 }],
      entities: [{ handle: 'AP-2440', roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', 'Anthropic, PBC']]] }],
    },
    '/rdap/ip/2607:6bc0::/48': {
      cidr0_cidrs: [{ v6prefix: '2607:6BC0::', length: 32 }],
      entities: [{ handle: 'AP-2440', roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', 'Anthropic, PBC']]] }],
    },
    '/rdap/ip/2607:6bc0:11::/48': {
      cidr0_cidrs: [{ v6prefix: '2607:6BC0::', length: 32 }],
      entities: [{ handle: 'AP-2440', roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', 'Anthropic, PBC']]] }],
    },
  };

  const server = http.createServer((request, response) => {
    const reqUrl = request.url ?? '';
    if (reqUrl.startsWith('/rdap/')) {
      const body = rdapFixtures[reqUrl];
      response.writeHead(body ? 200 : 404, {
        'content-type': 'application/rdap+json',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify(body ?? { errorCode: 404 }));
      return;
    }

    const source = decodeURIComponent(reqUrl.slice(1));
    const body = textFixtures[source];
    response.writeHead(body ? 200 : 404, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    });
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

  const rdapBaseUrl = `http://127.0.0.1:${port}/rdap`;
  const testRuleLoader: typeof loadRules = async (source, options) => {
    if (source.endsWith('.ts')) return loadRules(source, options);
    assert.ok(textFixtures[source], `missing AI fixture: ${source}`);
    const localUrl = `http://127.0.0.1:${port}/${encodeURIComponent(source)}`;
    if (source === OPENAI_VOICE_URL) return loadOpenAiVoiceIpRules(localUrl, options);
    if (isAnthropicIpDocsUrl(source)) {
      return loadAnthropicDocsIpRules(localUrl, {
        ...options,
        rdapBaseUrl,
        fallbackRdapBaseUrl: null,
      });
    }
    if (isRipestatAnnouncedPrefixesUrl(source)) {
      return loadRipestatAsnRules(localUrl, {
        ...options,
        asn: extractRipestatAsn(source) ?? undefined,
        rdapBaseUrl,
        fallbackRdapBaseUrl: null,
      });
    }
    return loadRules(localUrl, options);
  };

  const processor = new RuleSourceProcessor(createSpan('ai-rules'), outputDir, testRuleLoader);
  const stats = await processor.processSpecialRules([ai, openai, anthropic]);
  assert.deepEqual(stats.errors, []);
  assert.equal(stats.filesProcessed, 3);

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
    'IP-CIDR,153.61.224.0/22',
    'IP-CIDR,160.79.104.0/23',
    'IP-CIDR,198.51.100.0/24,no-resolve',
    'IP-CIDR6,2607:6bc0::/48',
    'IP-CIDR6,2607:6bc0:11::/48',
    'IP-ASN,399358',
  ];
  for (const [variant, expected] of [
    ['', [...nonIpRules, ...ipRules]],
    ['non_ip', nonIpRules],
    ['ip', ipRules],
  ] as const) {
    for (const [directory, extension] of [['List', 'list'], ['Clash', 'txt'], ['Loon', 'list']]) {
      if (directory === 'List' && !variant) {
        assert.equal(fs.existsSync(path.join(outputDir, directory, 'ai.list')), false);
        continue;
      }
      const outputPath = path.join(outputDir, directory, variant, `ai.${extension}`);
      assert.deepEqual(readRulesFile(outputPath), [...expected].sort(), `${directory}/${variant || 'flat'}`);
    }

    assert.deepEqual(readSingboxConditions(path.join(outputDir, 'sing-box', variant, 'ai.json')), {
      ...(variant !== 'ip' && { domain: [...domains].sort(), domain_suffix: [...suffixes].sort() }),
      ...(variant !== 'non_ip' && {
        ip_cidr: [
          '153.61.224.0/22',
          '160.79.104.0/23',
          '198.51.100.0/24',
          '2607:6bc0::/48',
          '2607:6bc0:11::/48',
        ].sort(),
      }),
    }, `sing-box/${variant || 'flat'}`);
  }

  for (const provider of [
    {
      id: 'openai',
      domains: [
        'cdn.openaimerge.com', 'o207216.ingest.sentry.io',
        'o33249.ingest.sentry.io', 'openaiassets.blob.core.windows.net',
      ],
      suffixes: ['chatgpt.com', 'chatgpt.livekit.cloud', 'openai.com'],
      ips: ['IP-CIDR,198.51.100.0/24,no-resolve', 'IP-CIDR6,2001:db8:1::/48,no-resolve'],
    },
    {
      id: 'anthropic',
      domains: ['o1158394.ingest.us.sentry.io', 'servd-anthropic-website.b-cdn.net'],
      suffixes: ['anthropic.com', 'claude.ai', 'claude.com', 'claudemcpcontent.com', 'claudeusercontent.com'],
      ips: ipRules.filter(rule => !rule.includes('no-resolve')),
    },
  ]) {
    const nonIp = [
      ...provider.domains.map(domain => `DOMAIN,${domain}`),
      ...provider.suffixes.map(suffix => `DOMAIN-SUFFIX,${suffix}`),
    ].sort();
    assert.equal(fs.existsSync(path.join(outputDir, 'List', `${provider.id}.list`)), false);
    for (const [directory, extension] of [['List', 'conf'], ['Clash', 'txt'], ['Loon', 'list']]) {
      const outputName = `${provider.id}.${extension}`;
      assert.deepEqual(readRulesFile(path.join(outputDir, directory, 'non_ip', outputName)), nonIp);
      assert.deepEqual(readRulesFile(path.join(outputDir, directory, 'ip', outputName)), provider.ips.sort());
    }
    assert.deepEqual(readSingboxConditions(path.join(outputDir, 'sing-box', 'non_ip', `${provider.id}.json`)), {
      domain: provider.domains.sort(),
      domain_suffix: provider.suffixes.sort(),
    });
    assert.deepEqual(readSingboxConditions(path.join(outputDir, 'sing-box', 'ip', `${provider.id}.json`)), {
      ip_cidr: provider.ips.flatMap(rule => (rule.startsWith('IP-CIDR') ? [rule.split(',')[1]] : [])).sort(),
    });
  }
});

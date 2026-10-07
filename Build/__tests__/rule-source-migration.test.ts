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

function getSpecialRule(id: string) {
  const rule = specialRules.find(item => item.targetFile === `List/${id}.list`);
  assert.ok(rule, `missing subscription: ${id}`);
  return rule;
}

async function publishSukkaFixtures(fixtures: Record<string, string | undefined>, ids: string[], verify: (outputDir: string) => void) {
  const server = http.createServer((request, response) => {
    const body = fixtures[request.url?.slice(1) ?? ''];
    response.writeHead(body ? 200 : 404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(body ?? 'Missing fixture');
  });
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-sukka-migration-'));
  try {
    const configs = ids.map(id => {
      const rule = getSpecialRule(id);
      return {
        ...rule,
        sourceFiles: rule.sourceFiles.map(url => {
          const source = new URL(url).pathname.replace('/List/', '');
          assert.ok(fixtures[source], `missing fixture: ${source}`);
          return `http://127.0.0.1:${port}/${source}`;
        }),
      };
    });
    const processor = new RuleSourceProcessor(createSpan('sukka-source-migration'), outputDir);
    const stats = await processor.processSpecialRules(configs);
    assert.deepEqual(stats.errors, []);
    assert.equal(stats.filesProcessed, ids.length);
    verify(outputDir);
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

describe('service source migration', () => {
  it('keeps service output identities and merges complementary upstreams', () => {
    const services = ['netflix', 'disney', 'spotify', 'primevideo', 'youtube', 'bilibili', 'tiktok', 'google', 'github'];
    const allPaths = [
      ...ruleGroups.flatMap(group => group.files.map(file => file.path)),
      ...specialRules.map(rule => rule.targetFile),
    ];
    assert.equal(new Set(allPaths).size, allPaths.length, 'an output must have exactly one publisher');
    for (const id of services) {
      const rule = specialRules.find(item => item.targetFile === `List/${id}.list`);
      assert.ok(rule, id);
      assert.ok(rule.sourceFiles.some(url => url.includes('blackmatrix7/ios_rule_script')));
      assert.ok(rule.sourceFiles.some(url => url.includes('meta-rules-dat/meta/geo/geosite/')));
      assert.deepEqual(rule.targets, ['surge', 'clash', 'singbox', 'loon']);
    }
    const wechat = specialRules.find(rule => rule.targetFile === 'List/wechat.list');
    assert.equal(wechat?.sourceFiles.length, 1, 'do not substitute a broad Tencent category for WeChat');
    const ai = specialRules.find(rule => rule.targetFile === 'List/ai.list');
    assert.ok(ai?.sourceFiles.some(url => url.endsWith('/category-ai-!cn.list')));
    assert.equal(ai?.sourceFiles.some(url => url.endsWith('.json')), false);
  });

  it('publishes a mixed Surge/geosite/geoip subscription on all four platforms', async () => {
    const bodies = [
      '# blackmatrix-style rules\nDOMAIN,api.video.test,Video\nDOMAIN-SUFFIX,video.test\n',
      '# meta geosite\n+.video.test\nfull:meta.video.test\n2mdn.net\n',
      '# meta geoip\n203.0.113.0/24\n2001:db8::/32\n',
    ];
    const server = http.createServer((request, response) => {
      const index = Number(request.url?.slice(1));
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(bodies[index]);
    });
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-mixed-source-'));
    const netflix = specialRules.find(rule => rule.targetFile === 'List/netflix.list');
    assert.ok(netflix);
    try {
      const processor = new RuleSourceProcessor(createSpan('source-migration'), tempDir);
      const stats = await processor.processSpecialRules([{
        ...netflix,
        sourceFiles: bodies.map((_body, index) => `http://127.0.0.1:${port}/${index}`),
      }]);
      assert.deepEqual(stats.errors, []);
      assert.equal(stats.filesProcessed, 1);
      for (const [directory, extension] of [['List', 'list'], ['Clash', 'txt'], ['Loon', 'list']]) {
        const text = fs.readFileSync(path.join(tempDir, directory, `netflix.${extension}`), 'utf8');
        assert.match(text, /DOMAIN,2mdn\.net/);
        assert.match(text, /DOMAIN-SUFFIX,video\.test/);
        assert.match(text, /IP-CIDR,203\.0\.113\.0\/24,no-resolve/);
        assert.match(text, /IP-CIDR6,2001:db8::\/32,no-resolve/);
        assert.equal(text.split('\n').filter(line => line.startsWith('DOMAIN-SUFFIX,video.test')).length, 1);
        assert.equal(text.includes(',Video'), false, 'upstream policy must not leak into a subscription');
      }
      const json = JSON.parse(fs.readFileSync(path.join(tempDir, 'sing-box', 'netflix.json'), 'utf8'));
      assert.ok(json.rules[0].domain.includes('2mdn.net'));
      assert.ok(json.rules[0].domain_suffix.includes('video.test'));
      assert.ok(json.rules[0].ip_cidr.includes('203.0.113.0/24'));
      assert.ok(json.rules[0].ip_cidr.includes('2001:db8::/32'));
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
});

describe('Sukka source migration', () => {
  it('keeps policy-specific Apple and Microsoft subscriptions alongside compatible aggregates', () => {
    const appleSources = {
      apple_cdn: 'domainset/apple_cdn',
      apple_cn: 'non_ip/apple_cn',
      apple_services: 'non_ip/apple_services',
      apple_services_ip: 'ip/apple_services',
      icloud_private_relay: 'domainset/icloud_private_relay',
    };
    for (const [id, source] of Object.entries({
      ...appleSources,
      apple_intelligence: 'non_ip/apple_intelligence',
      microsoft_cdn: 'non_ip/microsoft_cdn',
    })) {
      const rule = getSpecialRule(id);
      assert.deepEqual(rule.sourceFiles, [`https://ruleset.skk.moe/List/${source}.conf`]);
      assert.deepEqual(rule.targets, ['surge', 'clash', 'singbox', 'loon']);
      assert.equal(rule.defaultPolicy, null, 'split subscriptions leave policy selection to the client');
    }
    const apple = getSpecialRule('apple');
    assert.deepEqual(new Set(apple.sourceFiles), new Set(Object.values(appleSources).map(source => `https://ruleset.skk.moe/List/${source}.conf`)));
    assert.equal(apple.sourceFiles.some(source => source.includes('apple_intelligence')), false);
    const microsoft = getSpecialRule('microsoft');
    assert.deepEqual(new Set(microsoft.sourceFiles), new Set([
      'https://ruleset.skk.moe/List/non_ip/microsoft.conf',
      ...getSpecialRule('microsoft_cdn').sourceFiles,
    ]));
  });

  it('uses current nonempty sources and leaves URL regex blocking opt-in', () => {
    const regions = ['us', 'hk', 'jp', 'tw', 'kr', 'eu'];
    for (const region of regions) {
      const regional = getSpecialRule(`stream_${region}`);
      assert.deepEqual(regional.sourceFiles, [`https://ruleset.skk.moe/List/non_ip/stream_${region}.conf`]);
      assert.notEqual(regional.allowEmpty, true, 'an empty regional domain source must fail');
    }
    const stream = getSpecialRule('stream');
    assert.equal(stream.sourceFiles.length, 8);
    assert.equal(new Set(stream.sourceFiles).size, 8);
    assert.notEqual(stream.allowEmpty, true);
    const telegram = getSpecialRule('telegram');
    assert.deepEqual(telegram.sourceFiles, [
      'https://ruleset.skk.moe/List/non_ip/telegram.conf',
      'https://ruleset.skk.moe/List/ip/teleproto.conf',
      'https://ruleset.skk.moe/List/ip/telegram_asn.conf',
    ]);
    const regex = getSpecialRule('reject_url_regex');
    assert.deepEqual(regex.sourceFiles, ['https://ruleset.skk.moe/List/non_ip/reject-url-regex.conf']);
    assert.deepEqual(regex.targets, ['surge']);
    assert.equal(regex.defaultPolicy, null);
    for (const aggregate of ['reject', 'reject_extra', 'ads']) {
      assert.equal(getSpecialRule(aggregate).sourceFiles.some(url => regex.sourceFiles.includes(url)), false);
    }
    const sources = new Set([
      ...ruleGroups.flatMap(group => group.files.map(file => file.url)),
      ...specialRules.flatMap(rule => rule.sourceFiles),
    ]);
    const removedSources = [
      'ip/telegram', 'non_ip/reject_sukka', 'non_ip/global_plus', 'non_ip/apple_cdn', 'ip/stream_biliintl',
      ...regions.map(region => `ip/stream_${region}`),
    ];
    for (const source of removedSources) {
      assert.equal(sources.has(`https://ruleset.skk.moe/List/${source}.conf`), false, source);
    }
  });

  it('publishes Apple and Microsoft splits without mixing their policy categories', async () => {
    const fixtures = {
      'domainset/apple_cdn.conf': '.updates.cdn-apple.com\n',
      'non_ip/apple_cn.conf': 'DOMAIN-SUFFIX,icloud.com.cn\n',
      'non_ip/apple_services.conf': 'DOMAIN-SUFFIX,apple.com\nDOMAIN-SUFFIX,icloud.com\n',
      'ip/apple_services.conf': 'IP-CIDR,17.0.0.0/8,no-resolve\nIP-CIDR6,2403:300::/32,no-resolve\n',
      'domainset/icloud_private_relay.conf': 'mask.icloud.com\n',
      'non_ip/apple_intelligence.conf': 'DOMAIN,apple-relay.fastly-edge.com\n',
      'non_ip/microsoft.conf': 'DOMAIN,account.microsoft.com\n',
      'non_ip/microsoft_cdn.conf': 'DOMAIN-SUFFIX,download.microsoft.com\n',
    };
    const splitDomains = {
      apple_cdn: 'DOMAIN-SUFFIX,updates.cdn-apple.com',
      apple_cn: 'DOMAIN-SUFFIX,icloud.com.cn',
      apple_services: 'DOMAIN-SUFFIX,apple.com',
      icloud_private_relay: 'DOMAIN,mask.icloud.com',
      apple_intelligence: 'DOMAIN,apple-relay.fastly-edge.com',
      microsoft_cdn: 'DOMAIN-SUFFIX,download.microsoft.com',
    };
    const ids = [...Object.keys(splitDomains), 'apple_services_ip', 'apple', 'microsoft'];
    await publishSukkaFixtures(fixtures, ids, outputDir => {
      for (const [directory, extension] of [['List', 'list'], ['Clash', 'txt'], ['Loon', 'list']]) {
        for (const [id, expected] of Object.entries(splitDomains)) {
          const output = fs.readFileSync(path.join(outputDir, directory, `${id}.${extension}`), 'utf8');
          assert.ok(output.split('\n').includes(expected), `${directory}/${id}`);
          for (const [otherId, otherRule] of Object.entries(splitDomains)) {
            if (otherId !== id) assert.equal(output.split('\n').includes(otherRule), false, `${id} must not include ${otherId}`);
          }
        }
        const apple = fs.readFileSync(path.join(outputDir, directory, `apple.${extension}`), 'utf8');
        assert.match(apple, /DOMAIN-SUFFIX,updates\.cdn-apple\.com/);
        assert.match(apple, /DOMAIN-SUFFIX,icloud\.com\.cn/);
        assert.match(apple, /DOMAIN-SUFFIX,apple\.com/);
        assert.match(apple, /DOMAIN-SUFFIX,icloud\.com/, 'the aggregate covers Private Relay through its broader iCloud suffix');
        assert.match(apple, /IP-CIDR,17\.0\.0\.0\/8,no-resolve/);
        assert.match(apple, /IP-CIDR6,2403:300::\/32,no-resolve/);
        assert.equal(apple.includes('apple-relay.fastly-edge.com'), false);
        const appleIp = fs.readFileSync(path.join(outputDir, directory, `apple_services_ip.${extension}`), 'utf8');
        assert.match(appleIp, /IP-CIDR,17\.0\.0\.0\/8,no-resolve/);
        assert.equal(appleIp.includes('DOMAIN'), false);
        const microsoft = fs.readFileSync(path.join(outputDir, directory, `microsoft.${extension}`), 'utf8');
        assert.match(microsoft, /DOMAIN,account\.microsoft\.com/);
        assert.match(microsoft, /DOMAIN-SUFFIX,download\.microsoft\.com/);
      }
      for (const id of ids) assert.ok(fs.existsSync(path.join(outputDir, 'sing-box', `${id}.json`)), id);
      const apple = JSON.parse(fs.readFileSync(path.join(outputDir, 'sing-box/apple.json'), 'utf8')).rules[0];
      assert.ok(apple.domain_suffix.includes('icloud.com'));
      assert.ok(apple.domain_suffix.includes('updates.cdn-apple.com'));
      assert.deepEqual(new Set(apple.ip_cidr), new Set(['17.0.0.0/8', '2403:300::/32']));
      assert.equal(apple.domain.includes('apple-relay.fastly-edge.com'), false);
      const intelligence = JSON.parse(fs.readFileSync(path.join(outputDir, 'sing-box/apple_intelligence.json'), 'utf8')).rules[0];
      assert.deepEqual(intelligence.domain, ['apple-relay.fastly-edge.com']);
    });
  });

  it('retains Teleproto no-resolve semantics and publishes exact URL regex rules only for Surge', async () => {
    const upstreamRegexRules = [
      String.raw`URL-REGEX,^http://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/(adgateway|adv)/`,
      String.raw`URL-REGEX,^http://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/(EcomResourceServer/AdPlayPage/adinfo|MobileAdServer/)`,
    ];
    const policyRegexRule = String.raw`URL-REGEX,^https?://ads\.example\.test/items/\d{1,3}\,promo$`;
    const fixtures = {
      'non_ip/telegram.conf': 'DOMAIN-SUFFIX,telegram.org\n',
      'ip/teleproto.conf': 'IP-CIDR,149.154.160.0/20,no-resolve\nIP-CIDR6,2001:b28:f23d::/48,no-resolve\n',
      'ip/telegram_asn.conf': 'IP-ASN,62041\n',
      'non_ip/reject-url-regex.conf': [...upstreamRegexRules, `${policyRegexRule},REJECT`].join('\n') + '\n',
    };
    await publishSukkaFixtures(fixtures, ['telegram', 'reject_url_regex'], outputDir => {
      for (const [directory, extension] of [['List', 'list'], ['Clash', 'txt'], ['Loon', 'list']]) {
        const telegram = fs.readFileSync(path.join(outputDir, directory, `telegram.${extension}`), 'utf8');
        assert.match(telegram, /DOMAIN-SUFFIX,telegram\.org/);
        assert.match(telegram, /IP-CIDR,149\.154\.160\.0\/20,no-resolve/);
        assert.match(telegram, /IP-CIDR6,2001:b28:f23d::\/48,no-resolve/);
        assert.ok(telegram.split('\n').includes('IP-ASN,62041'), 'a plain ASN must not gain no-resolve');
      }
      const telegram = JSON.parse(fs.readFileSync(path.join(outputDir, 'sing-box/telegram.json'), 'utf8')).rules[0];
      assert.deepEqual(telegram.domain_suffix, ['telegram.org']);
      assert.deepEqual(new Set(telegram.ip_cidr), new Set(['149.154.160.0/20', '2001:b28:f23d::/48']));
      const regex = fs.readFileSync(path.join(outputDir, 'List/reject_url_regex.list'), 'utf8');
      const activeRules = regex.split('\n').filter(line => line && !line.startsWith('#'));
      assert.deepEqual(new Set(activeRules), new Set([...upstreamRegexRules, policyRegexRule]));
      for (const [directory, extension] of [['Clash', 'txt'], ['Loon', 'list'], ['sing-box', 'json']]) {
        assert.equal(fs.existsSync(path.join(outputDir, directory, `reject_url_regex.${extension}`)), false);
      }
    });
  });
});

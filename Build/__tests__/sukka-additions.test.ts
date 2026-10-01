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

describe('additional Sukka subscriptions', () => {
  it('publishes every requested category separately without deprecated inputs', () => {
    const paths = [
      ...ruleGroups.flatMap(group => group.files.map(file => file.path)),
      ...specialRules.map(rule => rule.targetFile),
    ];
    assert.equal(new Set(paths).size, paths.length, 'each output has one publisher');
    const ids = [
      'apple_intelligence', 'game_download',
      'stream_us', 'stream_hk', 'stream_jp', 'stream_tw', 'stream_kr', 'stream_eu',
      'reject_phishing', 'domestic_cdn', 'gitlab', 'sogouinput', 'cloudmounter',
    ];
    for (const id of ids) {
      const rule = specialRules.find(item => item.targetFile === `List/${id}.list`);
      assert.ok(rule, id);
      assert.equal(rule.defaultPolicy, null, 'the client chooses a policy for each subscription');
      assert.deepEqual(rule.targets, id === 'cloudmounter' ? ['surge'] : ['surge', 'clash', 'singbox', 'loon']);
      assert.ok(rule.sourceFiles.every(url => url.startsWith('https://ruleset.skk.moe/List/')));
      if (id.startsWith('stream_')) {
        assert.ok(rule.sourceFiles.some(url => url.includes(`/non_ip/${id}.conf`)));
        assert.ok(rule.sourceFiles.some(url => url.includes(`/ip/${id}.conf`)));
      }
    }
    const sources = specialRules.flatMap(rule => rule.sourceFiles);
    assert.equal(sources.some(url => url.endsWith('/non_ip/global_plus.conf')), false);
    assert.equal(sources.some(url => url.endsWith('/non_ip/apple_cdn.conf')), false);
  });

  it('converts domainsets and regional IPs while retaining CloudMounter conditions only for Surge', async () => {
    const condition = 'AND,((DOMAIN-SUFFIX,sharepoint.com),(PROCESS-NAME,*CloudMounter))';
    const sourceIpCondition = 'AND,((DOMAIN,www.googleapis.com),(SRC-IP,10.0.0.0/8))';
    const wildcardCondition = 'AND,((DOMAIN-WILDCARD,*-medi*.svc.ms),(SRC-IP,192.168.0.0/16))';
    const bodies = [
      '# game download\n.steamcontent.com\n',
      '# regional streaming\nDOMAIN-SUFFIX,netflix.com\n',
      '# streaming IP\nIP-CIDR,203.0.113.0/24\nIP-CIDR6,2001:db8::/32\n',
      `# CloudMounter\n${condition}\n${sourceIpCondition}\n${wildcardCondition}\n`,
    ];
    const server = http.createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(bodies[Number(request.url?.slice(1))]);
    });
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-sukka-additions-'));
    try {
      const processor = new RuleSourceProcessor(createSpan('sukka-additions'), outputDir);
      const inputs = [['game_download', [0]], ['stream_us', [1, 2]], ['cloudmounter', [3]]] as const;
      const configs = inputs.map(([id, indexes]) => {
        const config = specialRules.find(rule => rule.targetFile === `List/${id}.list`);
        assert.ok(config);
        return { ...config, sourceFiles: indexes.map(index => `http://127.0.0.1:${port}/${index}`) };
      });
      const stats = await processor.processSpecialRules(configs);
      assert.deepEqual(stats.errors, []);
      assert.equal(stats.filesProcessed, 3);
      for (const [directory, extension] of [['List', 'list'], ['Clash', 'txt'], ['Loon', 'list']]) {
        const game = fs.readFileSync(path.join(outputDir, directory, `game_download.${extension}`), 'utf8');
        const stream = fs.readFileSync(path.join(outputDir, directory, `stream_us.${extension}`), 'utf8');
        assert.match(game, /DOMAIN-SUFFIX,steamcontent\.com/);
        assert.match(stream, /DOMAIN-SUFFIX,netflix\.com/);
        assert.match(stream, /IP-CIDR,203\.0\.113\.0\/24,no-resolve/);
        assert.match(stream, /IP-CIDR6,2001:db8::\/32,no-resolve/);
      }
      const gameJson = JSON.parse(fs.readFileSync(path.join(outputDir, 'sing-box/game_download.json'), 'utf8'));
      const streamJson = JSON.parse(fs.readFileSync(path.join(outputDir, 'sing-box/stream_us.json'), 'utf8'));
      assert.ok(gameJson.rules[0].domain_suffix.includes('steamcontent.com'));
      assert.ok(streamJson.rules[0].domain_suffix.includes('netflix.com'));
      assert.deepEqual(new Set(streamJson.rules[0].ip_cidr), new Set(['203.0.113.0/24', '2001:db8::/32']));
      const cloud = fs.readFileSync(path.join(outputDir, 'List/cloudmounter.list'), 'utf8');
      for (const rule of [condition, sourceIpCondition, wildcardCondition]) assert.ok(cloud.includes(rule));
      assert.equal(cloud.split('\n').some(line => /^(?:DOMAIN|DOMAIN-SUFFIX|DOMAIN-WILDCARD),/.test(line)), false);
      for (const directory of ['Clash', 'Loon', 'sing-box']) {
        assert.equal(fs.readdirSync(path.join(outputDir, directory)).some(name => name.startsWith('cloudmounter.')), false);
      }
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
      await new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });
});

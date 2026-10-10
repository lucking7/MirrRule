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
      assert.notEqual(rule.allowEmpty, true);
      if (id.startsWith('stream_')) {
        assert.deepEqual(rule.sourceFiles, [`https://ruleset.skk.moe/List/non_ip/${id}.conf`]);
      }
    }
    const sources = specialRules.flatMap(rule => rule.sourceFiles);
    assert.equal(sources.some(url => url.endsWith('/non_ip/global_plus.conf')), false);
    assert.equal(sources.some(url => url.endsWith('/non_ip/apple_cdn.conf')), false);
  });

  it('converts domainsets and regional domains while retaining CloudMounter conditions only for Surge', async () => {
    const condition = 'AND,((DOMAIN-SUFFIX,sharepoint.com),(PROCESS-NAME,*CloudMounter))';
    const sourceIpCondition = 'AND,((DOMAIN,www.googleapis.com),(SRC-IP,10.0.0.0/8))';
    const wildcardCondition = 'AND,((DOMAIN-WILDCARD,*-medi*.svc.ms),(SRC-IP,192.168.0.0/16))';
    const watermark = '7h15.ru1353t.1s.m4d3.by.5ukk4w.skk.moe';
    const bodies = [
      `# game download\n${watermark}\n.steamcontent.com\n`,
      `# regional streaming\nDOMAIN,${watermark}\nDOMAIN-SUFFIX,netflix.com\n`,
      `# CloudMounter\nDOMAIN,${watermark}\n${condition}\n${sourceIpCondition}\n${wildcardCondition}\n`,
      `# empty source\nDOMAIN,${watermark}\n`,
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
      const inputs = [['game_download', [0]], ['stream_us', [1]], ['cloudmounter', [2]]] as const;
      const configs = inputs.map(([id, indexes]) => {
        const config = specialRules.find(rule => rule.targetFile === `List/${id}.list`);
        assert.ok(config);
        return { ...config, sourceFiles: indexes.map(index => `http://127.0.0.1:${port}/${index}`) };
      });
      const stats = await processor.processSpecialRules(configs);
      assert.deepEqual(stats.errors, []);
      assert.equal(stats.filesProcessed, 3);
      for (const directory of ['List', 'Clash', 'Loon', 'sing-box']) {
        for (const entry of fs.readdirSync(path.join(outputDir, directory), { recursive: true, withFileTypes: true })) {
          if (!entry.isFile()) continue;
          const file = path.join(entry.parentPath, entry.name);
          assert.equal(fs.readFileSync(file, 'utf8').includes(watermark), false, path.relative(outputDir, file));
        }
      }
      for (const [directory, extension] of [['List', 'list'], ['Clash', 'txt'], ['Loon', 'list']]) {
        const game = fs.readFileSync(path.join(outputDir, directory, `game_download.${extension}`), 'utf8');
        const stream = fs.readFileSync(path.join(outputDir, directory, `stream_us.${extension}`), 'utf8');
        assert.match(game, /DOMAIN-SUFFIX,steamcontent\.com/);
        assert.match(stream, /DOMAIN-SUFFIX,netflix\.com/);
        assert.equal(stream.includes('IP-CIDR'), false);
      }
      const gameJson = JSON.parse(fs.readFileSync(path.join(outputDir, 'sing-box/game_download.json'), 'utf8'));
      const streamJson = JSON.parse(fs.readFileSync(path.join(outputDir, 'sing-box/stream_us.json'), 'utf8'));
      assert.ok(gameJson.rules[0].domain_suffix.includes('steamcontent.com'));
      assert.ok(streamJson.rules[0].domain_suffix.includes('netflix.com'));
      assert.equal(streamJson.rules[0].ip_cidr, undefined);
      const cloud = fs.readFileSync(path.join(outputDir, 'List/cloudmounter.list'), 'utf8');
      for (const rule of [condition, sourceIpCondition, wildcardCondition]) assert.ok(cloud.includes(rule));
      assert.equal(cloud.split('\n').some(line => /^(?:DOMAIN|DOMAIN-SUFFIX|DOMAIN-WILDCARD),/.test(line)), false);
      for (const directory of ['Clash', 'Loon', 'sing-box']) {
        assert.equal(fs.readdirSync(path.join(outputDir, directory)).some(name => name.startsWith('cloudmounter.')), false);
      }
      const regional = configs[1];
      const regionalOutput = fs.readFileSync(path.join(outputDir, 'List/stream_us.list'), 'utf8');
      assert.match(regionalOutput, /DOMAIN-SUFFIX,netflix\.com/);
      assert.equal(regionalOutput.includes(watermark), false);
      assert.equal(regionalOutput.includes('IP-CIDR'), false);

      const emptySourceStats = await processor.processSpecialRules([
        { ...regional, sourceFiles: [`http://127.0.0.1:${port}/1`, `http://127.0.0.1:${port}/3`] },
      ]);
      assert.equal(emptySourceStats.filesProcessed, 0);
      assert.equal(emptySourceStats.errors.length, 1);
      assert.equal(fs.readFileSync(path.join(outputDir, 'List/stream_us.list'), 'utf8'), regionalOutput);

      const emptyAllStats = await processor.processSpecialRules([
        { ...regional, sourceFiles: [`http://127.0.0.1:${port}/3`] },
      ]);
      assert.equal(emptyAllStats.filesProcessed, 0);
      assert.equal(emptyAllStats.errors.length, 1);
      assert.match(emptyAllStats.errors[0].error, /empty response/);
      assert.equal(fs.readFileSync(path.join(outputDir, 'List/stream_us.list'), 'utf8'), regionalOutput);
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

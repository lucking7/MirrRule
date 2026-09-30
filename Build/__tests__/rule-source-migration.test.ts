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

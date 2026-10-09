import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { RuleSourceProcessor } from '../lib/rule-source-processor';
import type { RuleGroup } from '../lib/rule-source-types';
import { ruleGroups } from '../lib/rule-sources';
import { createSpan } from '../trace';

it('rebuilds registered fmz subscriptions without routing the upstream proxy exception directly', async () => {
  const fixtures: Record<string, string> = {
    '/direct-fmz': [
      '#!name=分流修正',
      'host, ad.12306.cn, direct',
      'host-keyword, push.apple.com, direct',
      'host-suffix, weather-data.apple.com, direct',
      'host-keyword, amp-api.podcasts.apple.com, proxy',
      'ip-cidr, 192.168.0.1/24, direct',
      'ip-cidr, 192.168.1.1/24, direct',
    ].join('\n'),
    '/reject-fmz': 'host-KEYWORD, adproxy.autohome.com, reject\nIP6-CIDR, 2001:db8::/32, reject\n',
  };
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(fixtures[request.url ?? ''] ?? '');
  });
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-fmz-source-'));
  try {
    const groups: RuleGroup[] = [];
    for (const group of ruleGroups) {
      const files: RuleGroup['files'] = [];
      for (const file of group.files) {
        if (!/\/(?:direct|reject)-fmz\.list$/.test(file.path)) continue;
        assert.match(file.url, /^https:\/\/raw\.githubusercontent\.com\/fmz200\/wool_scripts\/main\/QuantumultX\/filter\//);
        files.push({ ...file, url: `http://127.0.0.1:${port}/${path.basename(file.path, '.list')}` });
      }
      if (files.length) groups.push({ ...group, files });
    }
    const stats = await new RuleSourceProcessor(createSpan('fmz-source'), outputDir).processRuleGroups(groups);
    assert.deepEqual(stats.errors, []);
    assert.equal(stats.filesProcessed, 2, 'both historical identities must have a current publisher');
    for (const [directory, extension] of [['List', 'list'], ['Clash', 'txt'], ['Loon', 'list']]) {
      const direct = fs.readFileSync(path.join(outputDir, directory, `direct-fmz.${extension}`), 'utf8');
      assert.match(direct, /^DOMAIN,ad\.12306\.cn$/m);
      assert.match(direct, /^DOMAIN-KEYWORD,push\.apple\.com$/m);
      assert.match(direct, /^DOMAIN-SUFFIX,weather-data\.apple\.com$/m);
      assert.match(direct, /^IP-CIDR,192\.168\.0\.0\/23$/m);
      assert.equal(direct.includes('amp-api.podcasts.apple.com'), false);
      assert.doesNotMatch(direct, /,(?:direct|proxy)\b/i);
      const reject = fs.readFileSync(path.join(outputDir, directory, `reject-fmz.${extension}`), 'utf8');
      assert.match(reject, /^DOMAIN-KEYWORD,adproxy\.autohome\.com$/m);
      assert.match(reject, /^IP-CIDR6,2001:db8::\/32$/m);
    }
    const direct = JSON.parse(fs.readFileSync(path.join(outputDir, 'sing-box/direct-fmz.json'), 'utf8')).rules[0];
    assert.deepEqual(direct.domain, ['ad.12306.cn']);
    assert.deepEqual(direct.domain_keyword, ['push.apple.com']);
    assert.deepEqual(direct.domain_suffix, ['weather-data.apple.com']);
    assert.deepEqual(direct.ip_cidr, ['192.168.0.0/23']);
    const reject = JSON.parse(fs.readFileSync(path.join(outputDir, 'sing-box/reject-fmz.json'), 'utf8')).rules[0];
    assert.deepEqual(reject.domain_keyword, ['adproxy.autohome.com']);
    assert.deepEqual(reject.ip_cidr, ['2001:db8::/32']);
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

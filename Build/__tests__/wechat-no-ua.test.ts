import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { EnhancedFileOutput } from '../lib/enhanced-file-output';
import { RuleSourceProcessor } from '../lib/rule-source-processor';
import { specialRules } from '../lib/rule-sources';
import { createSpan } from '../trace';

const uaExpressions = [
  'USER-AGENT,WeChat*,DIRECT',
  'user-agent,MicroMessenger*,DIRECT',
  'AND,((DOMAIN,only-if-wechat.example),(USER-AGENT,WeChat*)),DIRECT',
  'OR,((DOMAIN,only-if-wechat.example),(NOT,((USER-AGENT,MicroMessenger*)))),DIRECT',
  'NOT,((AND,((DOMAIN,only-if-wechat.example),( USER-AGENT ,WeChat*)))),DIRECT',
];

describe('WeChat without User-Agent bypass', () => {
  it('adds a continuously generated canonical variant without changing the existing WeChat subscription', () => {
    const variant = specialRules.find(rule => rule.targetFile === 'List/wechat_no_ua.list');
    assert.ok(variant);
    assert.deepEqual(variant.sourceFiles, ['https://raw.githubusercontent.com/NobyDa/Script/master/Surge/WeChat.list']);
    assert.deepEqual(variant.targets, ['surge', 'clash', 'singbox', 'loon']);
    assert.equal(variant.defaultPolicy, null);
    assert.deepEqual(variant.excludedRuleTypes, ['USER-AGENT']);
    assert.notEqual(variant.allowEmpty, true);
    assert.equal(variant.applyNoResolve, undefined, 'preserve source DNS resolution behavior');

    const existing = specialRules.find(rule => rule.targetFile === 'List/wechat.list');
    assert.ok(existing);
    assert.deepEqual(existing.sourceFiles, ['https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Surge/WeChat/WeChat.list']);
    assert.equal(existing.excludedRuleTypes, undefined);
  });

  it('removes whole UA expressions without changing other predicates or values', async () => {
    const output = new EnhancedFileOutput(
      createSpan('wechat-no-ua-expressions'), 'wechat-no-ua', ['surge'], null,
      { excludedRuleTypes: [' user-agent '] }
    );
    const retained = 'AND,((DOMAIN,conditional.example),(PROTOCOL,TCP))';
    output.addRules([
      ...uaExpressions,
      retained + ',DIRECT',
      'DOMAIN,user-agent.example,DIRECT',
      'URL-REGEX,^https://example.com/user-agent,Proxy',
    ]);
    const text = (await output.compile())[0].join('\n');
    assert.equal(text.includes('only-if-wechat.example'), false, 'no child is published on its own');
    assert.equal(/\bUSER-AGENT\s*,/i.test(text), false);
    assert.ok(text.includes(retained));
    assert.match(text, /DOMAIN,user-agent\.example/);
    assert.match(text, /URL-REGEX,\^https:\/\/example\.com\/user-agent/);
  });

  it('keeps default UA behavior and applies exclusions after format normalization', async () => {
    const unchanged = new EnhancedFileOutput(createSpan('wechat-base'), 'wechat', ['surge'], null);
    unchanged.addRules(uaExpressions.slice(0, 3));
    const unchangedText = (await unchanged.compile())[0].join('\n');
    assert.match(unchangedText, /USER-AGENT,WeChat\*/);
    assert.match(unchangedText, /USER-AGENT,MicroMessenger\*/);
    assert.ok(unchangedText.includes('AND,((DOMAIN,only-if-wechat.example),(USER-AGENT,WeChat*))'));

    const normalized = new EnhancedFileOutput(
      createSpan('wechat-normalized-filter'), 'normalized-filter', ['surge'], null,
      { excludedRuleTypes: ['DOMAIN-SUFFIX'] }
    );
    normalized.addRules(['host-suffix,excluded.example,DIRECT', 'DOMAIN,retained.example,DIRECT']);
    const normalizedText = (await normalized.compile())[0].join('\n');
    assert.equal(normalizedText.includes('excluded.example'), false);
    assert.match(normalizedText, /DOMAIN,retained\.example/);
  });

  it('publishes domain and IP rules with upstream resolution flags on all four platforms', async () => {
    const source = [
      '# WeChat fixture',
      'DOMAIN-SUFFIX,wechat.example,DIRECT',
      'DOMAIN,exact.example,DIRECT',
      'DOMAIN-KEYWORD,101.226.211.,DIRECT',
      'IP-CIDR,203.0.113.0/24,DIRECT,no-resolve',
      'IP-CIDR,198.51.100.0/24,DIRECT',
      'IP-CIDR6,2001:db8::/32,DIRECT,no-resolve',
      ...uaExpressions,
    ].join('\n');
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(source);
    });
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-wechat-no-ua-'));
    try {
      const variant = specialRules.find(rule => rule.targetFile === 'List/wechat_no_ua.list');
      assert.ok(variant);
      const processor = new RuleSourceProcessor(createSpan('wechat-no-ua-publication'), outputDir);
      const stats = await processor.processSpecialRules([
        { ...variant, sourceFiles: [`http://127.0.0.1:${port}/WeChat.list`] },
      ]);
      assert.deepEqual(stats.errors, []);
      assert.equal(stats.filesProcessed, 1);
      for (const [directory, extension] of [['List', 'list'], ['Clash', 'txt'], ['Loon', 'list']]) {
        const text = fs.readFileSync(path.join(outputDir, directory, `wechat_no_ua.${extension}`), 'utf8');
        assert.match(text, /DOMAIN-SUFFIX,wechat\.example/);
        assert.match(text, /DOMAIN,exact\.example/);
        assert.match(text, /DOMAIN-KEYWORD,101\.226\.211\./);
        assert.match(text, /^IP-CIDR,203\.0\.113\.0\/24,no-resolve$/m);
        assert.match(text, /^IP-CIDR,198\.51\.100\.0\/24$/m);
        assert.match(text, /^IP-CIDR6,2001:db8::\/32,no-resolve$/m);
        assert.equal(/\bUSER-AGENT\s*,/i.test(text), false, directory);
        assert.equal(text.includes('only-if-wechat.example'), false, directory);
        assert.equal(text.includes(',DIRECT'), false, directory);
      }
      const json = JSON.parse(fs.readFileSync(path.join(outputDir, 'sing-box/wechat_no_ua.json'), 'utf8'));
      assert.ok(json.rules[0].domain.includes('exact.example'));
      assert.ok(json.rules[0].domain_suffix.includes('wechat.example'));
      assert.ok(json.rules[0].domain_keyword.includes('101.226.211.'));
      assert.deepEqual(new Set(json.rules[0].ip_cidr), new Set(['203.0.113.0/24', '198.51.100.0/24', '2001:db8::/32']));
      assert.equal(JSON.stringify(json).includes('WeChat*'), false);
      assert.equal(JSON.stringify(json).includes('only-if-wechat.example'), false);
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

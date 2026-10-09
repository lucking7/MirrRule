import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { EnhancedFileOutput } from '../lib/enhanced-file-output';
import { ClashClassicRuleSet } from '../core/output/writing-strategy/clash';
import { createSpan } from '../trace';

const platforms = ['surge', 'clash', 'singbox', 'loon'] as const;
function makeOutput(id: string, directory = 'out') {
  return new EnhancedFileOutput(createSpan(id), id, [...platforms], null, undefined, directory)
    .withTitle(id)
.withDescription([]);
}

describe('platform rule semantics', () => {
  it('retains RULE-SET-wide extended matching after the flagged domain is pruned', async () => {
    const output = makeOutput('extended');
    output.addRules([
      'DOMAIN,sub.example.com,Proxy,extended-matching',
      'DOMAIN-SUFFIX,example.com',
      'DOMAIN,other.test',
      'DOMAIN-KEYWORD,keyword',
      'DOMAIN-WILDCARD,*.wild.test',
    ]);
    const [surge, clash, singbox, loon] = await output.compile();
    assert.ok(surge.includes('DOMAIN-SUFFIX,example.com,extended-matching'));
    assert.ok(surge.includes('DOMAIN,other.test,extended-matching'));
    assert.ok(surge.includes('DOMAIN-KEYWORD,keyword,extended-matching'));
    assert.ok(surge.includes('DOMAIN-WILDCARD,*.wild.test,extended-matching'));
    assert.equal(surge.some(rule => rule.includes('sub.example.com')), false);
    for (const content of [clash, singbox, loon]) {
      assert.equal(content.some(rule => rule.includes('extended-matching')), false);
    }
    assert.ok(clash.includes('DOMAIN-SUFFIX,example.com'));
    assert.ok(loon.includes('DOMAIN-SUFFIX,example.com'));
    assert.deepEqual(JSON.parse(singbox.join('\n')).rules[0].domain_suffix, ['example.com']);
  });

  it('classifies explicit process paths for all platforms and accounts for unsupported output', async () => {
    const output = makeOutput('process-path');
    output.addRules(['PROCESS-PATH,/Applications/example.app/Contents/MacOS/example,Proxy']);
    const [surge, clash, singbox, loon] = await output.compile();
    assert.deepEqual(surge, ['PROCESS-NAME,/Applications/example.app/Contents/MacOS/example']);
    assert.deepEqual(clash, ['PROCESS-PATH,/Applications/example.app/Contents/MacOS/example']);
    assert.deepEqual(loon, clash);
    assert.equal(singbox.join('\n').includes('example.app'), false);
    assert.equal(output.getRuleDropSummaries().singbox?.unsupported['PROCESS-PATH'], 1);
    assert.deepEqual(output.getRuleDropSummaries().surge?.unknown, {});
  });

  it('recursively adapts logical child types, ports and source IP predicates', () => {
    const writer = new ClashClassicRuleSet('');
    writer.writeOtherRules([
      'AND,((PROTOCOL,UDP),(OR,((DEST-PORT,443),(NOT,((SRC-IP,2001:db8::1)))))),Proxy',
    ]);
    assert.deepEqual(writer.content, [
      'AND,((NETWORK,UDP),(OR,((DST-PORT,443),(NOT,((SRC-IP-CIDR6,2001:db8::1/128))))))',
    ]);
    assert.deepEqual(writer.ruleDropSummary, { unsupported: {}, malformed: 0, unknown: {} });
  });

  it('adapts a compound predicate without changing the other platform contracts', async () => {
    const output = makeOutput('logical-platforms');
    const original = 'AND,((PROTOCOL,UDP),(DOMAIN-SUFFIX,example.com))';
    output.addRules([original]);
    const [surge, clash, singbox, loon] = await output.compile();
    assert.deepEqual(surge, [original]);
    assert.deepEqual(loon, [original]);
    assert.deepEqual(clash, ['AND,((NETWORK,UDP),(DOMAIN-SUFFIX,example.com))']);
    assert.equal(singbox.join('\n').includes('example.com'), false);
    assert.equal(output.getRuleDropSummaries().singbox?.unsupported.AND, 1);
  });

  it('rejects entire AND, OR and NOT trees when any descendant is unsupported or malformed', () => {
    const writer = new ClashClassicRuleSet('');
    writer.writeOtherRules([
      'AND,((DOMAIN,example.com),(OR,((DOMAIN,test.com),(URL-REGEX,"a,b"))))',
      'OR,((DOMAIN,example.com),(USER-AGENT,test))',
      'NOT,((FUTURE-RULE,value))',
      'AND,((DOMAIN,example.com),(PROTOCOL,ICMP))',
      'AND,((DOMAIN,example.com),(DOMAIN,test.com)',
    ]);
    assert.deepEqual(writer.content, []);
    assert.deepEqual(writer.ruleDropSummary, {
      unsupported: { 'URL-REGEX': 1, 'USER-AGENT': 1 },
      malformed: 2,
      unknown: { 'FUTURE-RULE': 1 },
    });
  });

  it('preflights all platforms before touching existing files if sing-box has no condition', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-preflight-'));
    try {
      const files = ['List/empty.list', 'Clash/empty.txt', 'sing-box/empty.json', 'Loon/empty.list'];
      await Promise.all(files.map(async file => {
        await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
        await fs.writeFile(path.join(directory, file), 'previous');
      }));
      const output = makeOutput('empty', directory);
      output.addRules(['IP-ASN,1234']);
      await assert.rejects(output.write(), /without matching conditions/);
      assert.deepEqual(await Promise.all(files.map(file => fs.readFile(path.join(directory, file), 'utf8'))), files.map(() => 'previous'));
      const mixed = makeOutput('mixed', directory);
      mixed.addRules(['IP-ASN,1234', 'DOMAIN,example.com']);
      await mixed.write();
      const result = JSON.parse(await fs.readFile(path.join(directory, 'sing-box/mixed.json'), 'utf8'));
      assert.deepEqual(result.rules[0].domain, ['example.com']);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

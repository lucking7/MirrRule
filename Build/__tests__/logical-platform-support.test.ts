import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LoonRuleSet } from '../core/output/writing-strategy/loon';
import { SurgeRuleSet } from '../core/output/writing-strategy/surge';
import { ClashClassicRuleSet } from '../core/output/writing-strategy/clash';
import { SingboxSource } from '../core/output/writing-strategy/singbox';

const unsupportedProcess = 'AND,((PROCESS-NAME,Telegram),(DOMAIN,b.example))';

describe('logical platform support', () => {
  it('rejects the whole Loon expression with an unsupported nested predicate', () => {
    for (const rule of [unsupportedProcess, 'OR,((DOMAIN,a.example),(NOT,((PROCESS-NAME,Telegram))))']) {
      const writer = new LoonRuleSet('');
      writer.writeOtherRules([rule]);
      assert.deepEqual(writer.content, []);
      assert.deepEqual(writer.ruleDropSummary.unsupported, { 'PROCESS-NAME': 1 });
    }
  });

  it('preserves supported Loon children and IP modifiers without broadening the expression', () => {
    const rule = 'AND,((DOMAIN,b.example),(IP-CIDR,192.0.2.0/24,no-resolve)),no-resolve';
    const writer = new LoonRuleSet('');
    writer.writeOtherRules([rule]);
    assert.deepEqual(writer.content, [rule]);
    assert.deepEqual(writer.ruleDropSummary, { unsupported: {}, unknown: {}, malformed: 0 });
  });

  it('rejects nested unsupported types, unknown types and malformed logical structure', () => {
    const writer = new LoonRuleSet('');
    writer.writeOtherRules([
      'AND,((DOMAIN,b.example),(SRC-IP-CIDR,192.0.2.0/24))',
      'AND,((DOMAIN,b.example),(UNKNOWN,value))',
      'NOT,((DOMAIN,a.example),(DOMAIN,b.example))',
      'AND,((DOMAIN,b.example)',
    ]);
    assert.deepEqual(writer.content, []);
    assert.deepEqual(writer.ruleDropSummary, { unsupported: { 'SRC-IP-CIDR': 1 }, unknown: { UNKNOWN: 1 }, malformed: 2 });
  });

  it('keeps supported process predicates on Surge and Clash', () => {
    for (const writer of [new SurgeRuleSet(''), new SurgeRuleSet('', undefined, true), new ClashClassicRuleSet('')]) {
      writer.writeOtherRules([unsupportedProcess]);
      assert.deepEqual(writer.content, [unsupportedProcess]);
      assert.deepEqual(writer.ruleDropSummary, { unsupported: {}, unknown: {}, malformed: 0 });
    }
  });

  it('uses Surge conversions inside logical children and preserves modifiers', () => {
    const writer = new SurgeRuleSet('');
    writer.writeOtherRules(['AND,((PROCESS-PATH,/Applications/Test.app),(SRC-IP-CIDR,192.0.2.0/24)),no-resolve']);
    assert.deepEqual(writer.content, ['AND,((PROCESS-NAME,/Applications/Test.app),(SRC-IP,192.0.2.0/24)),no-resolve']);
  });

  it('does not interpret quoted commas as child separators', () => {
    const writer = new LoonRuleSet('');
    const rule = 'AND,((URL-REGEX,"https://example.com/a,b"),(DOMAIN,b.example))';
    writer.writeOtherRules([rule]);
    assert.deepEqual(writer.content, [rule]);
  });

  it('retains Surge logical policies when stripPolicy is false', () => {
    const rule = 'AND,((DOMAIN,b.example),(IP-CIDR,192.0.2.0/24,no-resolve)),Proxy,no-resolve';
    const retained = new SurgeRuleSet('');
    retained.writeOtherRules([rule]);
    assert.deepEqual(retained.content, [rule]);
    const stripped = new SurgeRuleSet('', undefined, true);
    stripped.writeOtherRules([rule]);
    assert.deepEqual(stripped.content, [rule.replace(',Proxy,no-resolve', ',no-resolve')]);
  });

  it('rejects supported children with missing values', () => {
    for (const writer of [new LoonRuleSet(''), new SurgeRuleSet(''), new SurgeRuleSet('', undefined, true), new ClashClassicRuleSet('')]) {
      writer.writeOtherRules(['AND,((DOMAIN,),(DOMAIN,b.example))', 'AND,((DOMAIN, ,extended-matching),(DOMAIN,b.example))']);
      assert.deepEqual(writer.content, []);
      assert.equal(writer.ruleDropSummary.malformed, 2);
    }
  });

  it('preserves Surge input order and rejects unknown logical children in both modes', () => {
    for (const writer of [new SurgeRuleSet(''), new SurgeRuleSet('', undefined, true)]) {
      writer.writeOtherRules(['DOMAIN,a.example', unsupportedProcess, 'DOMAIN,c.example', 'AND,((UNKNOWN,value),(DOMAIN,b.example))']);
      assert.deepEqual(writer.content, ['DOMAIN,a.example', unsupportedProcess, 'DOMAIN,c.example']);
      assert.deepEqual(writer.ruleDropSummary.unknown, { UNKNOWN: 1 });
    }
  });

  it('bounds nested logical expressions before recursion can exhaust the stack', () => {
    const writer = new LoonRuleSet('');
    let rule = 'DOMAIN,b.example';
    for (let depth = 0; depth < 66; depth++) rule = `NOT,((${rule}))`;
    writer.writeOtherRules([rule]);
    assert.deepEqual(writer.content, []);
    assert.equal(writer.ruleDropSummary.malformed, 1);
  });

  it('retains Clash whole-expression rejection and sing-box outer logical rejection', () => {
    const clash = new ClashClassicRuleSet('');
    clash.writeOtherRules(['AND,((USER-AGENT,Test),(DOMAIN,b.example))']);
    assert.deepEqual(clash.content, []);
    assert.deepEqual(clash.ruleDropSummary.unsupported, { 'USER-AGENT': 1 });
    const singbox = new SingboxSource('');
    singbox.writeOtherRules([unsupportedProcess]);
    assert.deepEqual(singbox.ruleDropSummary.unsupported, { AND: 1 });
  });
});

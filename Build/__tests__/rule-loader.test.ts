import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { loadRules } from '../utils/rule-loader';
import { RuleLineUtils } from '../utils/validation/validators';

async function loadJson(json: unknown, options?: Parameters<typeof loadRules>[1]) {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(json));
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  try {
    const { port } = server.address() as AddressInfo;
    return await loadRules(`http://127.0.0.1:${port}/sing-box/rules.json`, { throwOnError: true, ...options });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close(error => { if (error) reject(error); else resolve(); });
    });
  }
}

describe('sing-box JSON rule loading', () => {
  it('flattens the supported destination OR group and OR between rules', async () => {
    await Promise.all([1, 2].map(async version => {
      assert.deepEqual(await loadJson({ version, rules: [{
        type: 'default',
        invert: false,
        domain: ['one.example', 'two.example'],
        domain_suffix: 'suffix.example',
        domain_keyword: ['video'],
        ip_cidr: ['192.0.2.0/24', '2001:db8::/32'],
      }, { domain: 'separate.example' }] }), [
        'DOMAIN,one.example', 'DOMAIN,two.example', 'DOMAIN-SUFFIX,suffix.example',
        'DOMAIN-KEYWORD,video', 'IP-CIDR,192.0.2.0/24,no-resolve', 'IP-CIDR6,2001:db8::/32,no-resolve',
        'DOMAIN,separate.example',
      ]);
    }));
  });

  it('rejects additional AND constraints, inversion and unsupported logical rules', async () => {
    await Promise.all([
      { invert: true }, { port: [443] }, { source_port: [53] },
      { source_ip_cidr: ['192.168.0.0/16'] }, { network: 'tcp' },
      { domain_regex: ['^example'] },
    ].map(constraint => assert.rejects(loadJson({ version: 2, rules: [
        { domain: ['valid.example'] }, { domain: ['example.com'], ...constraint },
      ] }), /Unsupported sing-box rule field/)));
    await assert.rejects(loadJson({ version: 2, rules: [{
      type: 'logical', mode: 'and', rules: [{ domain: ['example.com'] }, { ip_cidr: ['192.0.2.0/24'] }],
    }] }), /Unsupported sing-box rule field/);
  });

  it('rejects malformed roots, matcher values and unconvertible empty rules', async () => {
    await Promise.all([null, [], {}, { rules: [] }, { version: 3, rules: [] }, { version: 2, rules: {} }]
      .map(json => assert.rejects(loadJson(json), /Expected a sing-box rule-set/)));
    await assert.rejects(loadJson({ version: 2, rules: [], unknown: true }), /Unsupported sing-box rule-set fields/);
    await Promise.all([null, [], { domain: 123 }, { domain: null, ip_cidr: '192.0.2.0/24' }, { domain: [''] }, { domain: ['a.example,REJECT'] }, { domain: ['a.example\nb.example'] }]
      .map(rule => assert.rejects(loadJson({ version: 2, rules: [rule] }), /Invalid sing-box/)));
    await assert.rejects(loadJson({ version: 2, rules: [{ ip_cidr: '192.0.2.1/99' }] }), /Invalid sing-box ip_cidr/);
    await Promise.all([{}, { domain: [] }, { type: 'default', invert: false }]
      .map(rule => assert.rejects(loadJson({ version: 2, rules: [rule] }, { throwOnError: true, allowEmpty: true }), /has no supported matchers/)));
  });

  it('honors empty-source and error-propagation options without returning partial rules', async () => {
    await assert.rejects(loadJson({ version: 2, rules: [] }), /Empty sing-box rule-set/);
    assert.deepEqual(await loadJson({ version: 2, rules: [] }, { throwOnError: true, allowEmpty: true }), []);
    assert.deepEqual(await loadJson({ version: 2, rules: [
      { domain: ['valid.example'] }, { domain: ['inverted.example'], invert: true },
    ] }, { throwOnError: false }), []);
  });
});

describe('rule type validation', () => {
  it('accepts source-address aliases while rejecting unknown and valueless types', () => {
    assert.equal(RuleLineUtils.isValidRule('SRC-IP,192.168.1.1'), true);
    assert.equal(RuleLineUtils.isValidRule('SRC-IP-CIDR6,2001:db8::/64'), true);
    assert.equal(RuleLineUtils.isValidRule('FUTURE-RULE,example.com'), false);
    assert.equal(RuleLineUtils.isValidRule('DOMAIN,'), false);
  });
});

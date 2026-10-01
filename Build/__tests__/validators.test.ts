/* eslint-disable @typescript-eslint/no-require-imports -- CJS project, node:test requires require() for SWC compat */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { IPValidator, RuleLineUtils } = require('../utils/validation/validators');

describe('Sukka watermark filtering', () => {
  it('recognizes current domainset and rule forms alongside legacy watermarks', () => {
    const watermark = '7h15.ru1353t.1s.m4d3.by.5ukk4w.skk.moe';
    for (const line of [
      watermark, `.${watermark}`, `DOMAIN,${watermark}`,
      `DOMAIN-SUFFIX,${watermark},REJECT`, ` DOMAIN, ${watermark} `,
      `DOMAIN,${watermark.toUpperCase()}`,
      'DOMAIN,7h1s_rul35et_i5_mad3_by_5ukk4w.ruleset.skk.moe',
      'DOMAIN,this_ruleset_is_made_by_sukkaw.ruleset.skk.moe',
    ]) {
      assert.equal(RuleLineUtils.isSukkaWatermark(line), true, line);
      assert.equal(RuleLineUtils.shouldSkipLine(line), true, line);
    }
  });

  it('retains legitimate numeric domains and watermark lookalikes', () => {
    const watermark = '7h15.ru1353t.1s.m4d3.by.5ukk4w.skk.moe';
    for (const line of [
      'DOMAIN,2mdn.net', '0x0.st', 'DOMAIN,skk.moe', 'DOMAIN,ruleset.skk.moe',
      `DOMAIN,prefix${watermark}`, `DOMAIN,${watermark}.example.com`,
    ]) {
      assert.equal(RuleLineUtils.isSukkaWatermark(line), false, line);
      assert.equal(RuleLineUtils.shouldSkipLine(line), false, line);
    }
  });
});

describe('IPValidator', () => {
  it('validates IPv6 addresses and CIDR prefix bounds', () => {
    const valid = [
      '::',
      '::1',
      '2001:db8::/32',
      '::ffff:192.0.2.1/96',
      '2001:0db8:0000:0000:0000:ff00:0042:8329',
      '2001:db8::/0',
      '2001:db8::/128',
      '2001:db8::1',
    ];
    const invalid = [
      '2001:db8::/129',
      '2001:db8::/999',
      'not-an-ip',
      '2001:db8::/',
      '2001:db8::/32/64',
      '2001:db8::/+32',
    ];

    for (const value of valid) assert.equal(IPValidator.isIPv6Cidr(value), true, value);
    for (const value of invalid) assert.equal(IPValidator.isIPv6Cidr(value), false, value);
  });

  it('validates IPv4 addresses and CIDR prefix bounds', () => {
    const valid = ['192.0.2.1', '192.0.2.1/0', '192.0.2.1/32'];
    const invalid = [
      '192.0.2.1/33',
      '192.0.2.1/99',
      '256.0.2.1',
      'not-an-ip',
      '192.0.2.1/',
      '192.0.2.1/24/32',
      '192.0.2.1/2x',
    ];

    for (const value of valid) assert.equal(IPValidator.isIPv4Cidr(value), true, value);
    for (const value of invalid) assert.equal(IPValidator.isIPv4Cidr(value), false, value);
  });

  it('identifies either IP family through the public helpers', () => {
    assert.equal(IPValidator.isIpCidr('192.0.2.1/24'), true);
    assert.equal(IPValidator.isIpCidr('2001:db8::/32'), true);
    assert.equal(IPValidator.isIpCidr('192.0.2.1/33'), false);
    assert.equal(IPValidator.isIpCidr('2001:db8::/129'), false);

    assert.equal(IPValidator.getIpType('192.0.2.1/24'), 'ipv4');
    assert.equal(IPValidator.getIpType('2001:db8::/32'), 'ipv6');
    assert.equal(IPValidator.getIpType('not-an-ip'), null);
  });
});

/* eslint-disable @typescript-eslint/no-require-imports -- CJS project, node:test requires require() for SWC compat */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { IPValidator } = require('../utils/validation/validators');

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

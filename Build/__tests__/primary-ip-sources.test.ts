import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import {
  ANTHROPIC_ASN,
  ANTHROPIC_IP_DOCS_URL,
  excludeGoogleCloudRanges,
  extractRipestatAsn,
  GOOGLE_CLOUD_IP_RANGES_URL,
  GOOGLE_IP_RANGES_URL,
  isAnthropicIpDocsUrl,
  isGoogleIpRangesUrl,
  isRipestatAnnouncedPrefixesUrl,
  loadAnthropicDocsIpRules,
  loadGoogleOwnedIpRules,
  loadRipestatAsnRules,
  parseAnthropicInboundCidrs,
  parseGoogleIpRanges,
  parseRipestatAnnouncedPrefixes,
  verifyCidrsWithRdap,
} from '../lib/primary-ip-sources';

const SAMPLE_ANTHROPIC_DOCS = `---
title: IP addresses
url: https://platform.claude.com/docs/en/api/ip-addresses
---

<Note>
  Ignore outbound ranges in note: 192.0.2.0/24
</Note>

## Inbound IP addresses

These are the IP addresses where Anthropic services receive incoming connections.

### IPv4

\`160.79.104.0/23\`

\`153.61.224.0/22\`

### IPv6

\`2607:6BC0::/48\`

### Phased out inbound addresses

\`34.162.46.92/32\`

## Outbound IP addresses

### IPv4

\`160.79.104.0/21\`

\`153.61.208.0/20\`

### Phased out IP addresses

\`\`\`text wrap
34.162.46.92/32
34.162.102.82/32
\`\`\`
`;

const SAMPLE_RDAP_AUTNUM_399358 = {
  handle: 'AS399358',
  name: 'ANTHROPIC',
  startAutnum: 399358,
  endAutnum: 399358,
  entities: [
    {
      handle: 'AP-2440',
      roles: ['registrant'],
      vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'Anthropic, PBC']]],
    },
  ],
};

function createRdapIp(
  handle: string,
  orgName: string,
  cidrs: Array<{ v4prefix?: string; v6prefix?: string; length: number }>
) {
  return {
    cidr0_cidrs: cidrs,
    entities: [
      {
        handle,
        roles: ['registrant'],
        vcardArray: ['vcard', [['fn', {}, 'text', orgName]]],
      },
    ],
  };
}

async function withHttpServer(
  handler: http.RequestListener,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  try {
    const { port } = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close(error => { if (error) reject(error); else resolve(); });
    });
  }
}

describe('primary IP source URL detection', () => {
  it('matches only authoritative Anthropic docs and RIPEstat announced-prefixes URLs', () => {
    assert.equal(isAnthropicIpDocsUrl(ANTHROPIC_IP_DOCS_URL), true);
    assert.equal(isAnthropicIpDocsUrl('https://platform.claude.com/docs/en/api/ip-addresses'), false);
    assert.equal(isAnthropicIpDocsUrl('https://evil.example/docs/en/api/ip-addresses.md'), false);

    assert.equal(
      isRipestatAnnouncedPrefixesUrl('https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS399358'),
      true
    );
    assert.equal(
      extractRipestatAsn('https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS399358'),
      399358
    );
    assert.equal(
      extractRipestatAsn('https://stat.ripe.net/data/announced-prefixes/data.json?resource=399358'),
      399358
    );
    assert.equal(
      isRipestatAnnouncedPrefixesUrl('https://stat.ripe.net/data/announced-prefixes/data.json?resource=160.79.104.0/21'),
      false
    );
    assert.equal(
      isRipestatAnnouncedPrefixesUrl('https://evil.example/data/announced-prefixes/data.json?resource=AS399358'),
      false
    );
  });
});

describe('Anthropic official Markdown parser', () => {
  it('extracts only Inbound IPv4 and IPv6 CIDRs and ignores Outbound and Phased out ranges', () => {
    assert.deepEqual(
      parseAnthropicInboundCidrs(SAMPLE_ANTHROPIC_DOCS),
      ['160.79.104.0/23', '153.61.224.0/22', '2607:6bc0::/48']
    );
  });

  it('ignores headings inside fenced code blocks', () => {
    const markdown = [
      '## Inbound IP addresses',
      '```markdown',
      '## Fake Next Heading',
      '160.79.104.0/23',
      '```',
      '### IPv6',
      '`2607:6bc0::/48`',
      '## Outbound IP addresses',
      '`160.79.104.0/21`',
    ].join('\n');
    assert.deepEqual(parseAnthropicInboundCidrs(markdown), ['160.79.104.0/23', '2607:6bc0::/48']);
  });

  it('excludes nested headings in deprecated IP sections', () => {
    const markdown = [
      '## Inbound IP addresses',
      '### Deprecated addresses',
      '#### IPv4',
      '192.0.2.0/24',
      '#### IPv6',
      '2001:db8::/48',
      '### Current addresses',
      '#### IPv4',
      '198.51.100.0/24',
    ].join('\n');
    assert.deepEqual(parseAnthropicInboundCidrs(markdown), ['198.51.100.0/24']);
  });

  it('rejects HTML challenge pages, missing Inbound heading, and empty sections', () => {
    assert.throws(
      () => parseAnthropicInboundCidrs('<!doctype html><html>Just a moment</html>'),
      /empty or HTML/
    );
    assert.throws(
      () => parseAnthropicInboundCidrs('## Outbound IP addresses\n`160.79.104.0/21`\n'),
      /missing the "Inbound IP addresses" section/
    );
    assert.throws(
      () => parseAnthropicInboundCidrs('## Inbound IP addresses\nNo CIDRs here.\n'),
      /No valid inbound CIDRs/
    );
    assert.deepEqual(
      parseAnthropicInboundCidrs('## Inbound IP addresses\nNo CIDRs here.\n', true),
      []
    );
  });
});

describe('RIPEstat live BGP announced-prefixes parser', () => {
  it('keeps only prefixes active at query_endtime and drops withdrawn historical prefixes', () => {
    const payload = {
      status: 'ok',
      data: {
        resource: '399358',
        query_starttime: '2026-11-04T16:00:00',
        query_endtime: '2026-11-18T16:00:00',
        prefixes: [
          {
            prefix: '160.79.104.0/23',
            timelines: [{ starttime: '2026-11-04T16:00:00', endtime: '2026-11-18T16:00:00' }],
          },
          {
            prefix: '198.51.100.0/24',
            timelines: [{ starttime: '2026-11-04T16:00:00', endtime: '2026-11-10T00:00:00' }],
          },
          {
            prefix: '2607:6BC0::/48',
            timelines: [{ starttime: '2026-11-04T16:00:00', endtime: '2026-11-18T16:00:00' }],
          },
          {
            prefix: '2607:6bc0:11::/48',
            timelines: [{ starttime: '2026-11-04T16:00:00', endtime: '2026-11-18T16:00:00' }],
          },
        ],
      },
    };
    assert.deepEqual(
      parseRipestatAnnouncedPrefixes(payload, 399358),
      ['160.79.104.0/23', '2607:6bc0::/48', '2607:6bc0:11::/48']
    );
  });

  it('rejects error status, mismatched resource, and invalid prefixes', () => {
    assert.throws(
      () => parseRipestatAnnouncedPrefixes({ status: 'error', data: {} }, 399358),
      /Invalid RIPEstat/
    );
    assert.throws(
      () => parseRipestatAnnouncedPrefixes({
        status: 'ok',
        data: { resource: '13335', query_endtime: '2026-11-18T16:00:00', prefixes: [] },
      }, 399358),
      /resource mismatch/
    );
    assert.throws(
      () => parseRipestatAnnouncedPrefixes({
        status: 'ok',
        data: {
          resource: '399358',
          query_endtime: '2026-11-18T16:00:00',
          prefixes: [{ prefix: '160.79.104.1', timelines: [{ endtime: '2026-11-18T16:00:00' }] }],
        },
      }, 399358),
      /Invalid BGP prefix/
    );
  });
});

describe('RIR RDAP ownership and containment verification', () => {
  it('verifies each prefix via the ASN registrant and falls back on 404', async () => {
    const requestedPaths: string[] = [];
    await withHttpServer((request, response) => {
      const reqPath = request.url ?? '';
      requestedPaths.push(reqPath);
      const routes: Record<string, unknown> = {
        '/primary/autnum/399358': SAMPLE_RDAP_AUTNUM_399358,
        '/primary/ip/160.79.104.0/23': createRdapIp('AP-2440', 'Anthropic, PBC', [
          { v4prefix: '160.79.104.0', length: 21 },
        ]),
        '/fallback/ip/153.61.224.0/22': createRdapIp('ORG-AP-RIPE', 'Anthropic, PBC', [
          { v4prefix: '153.61.0.0', length: 16 },
        ]),
        '/primary/ip/2607:6bc0::/48': {
          startAddress: '2607:6bc0::',
          endAddress: '2607:6bc0:ffff:ffff:ffff:ffff:ffff:ffff',
          entities: [
            { handle: 'AP-2440', roles: ['registrant'] },
          ],
        },
        '/primary/ip/2607:6bc0:11::/48': createRdapIp('AP-2440', 'Anthropic, PBC', [
          { v6prefix: '2607:6BC0::', length: 32 },
        ]),
      };
      const body = routes[reqPath];
      response.writeHead(body ? 200 : 404, {
        'content-type': 'application/rdap+json',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify(body ?? { errorCode: 404 }));
    }, async baseUrl => {
      const verified = await verifyCidrsWithRdap(
        ['160.79.104.0/23', '153.61.224.0/22', '2607:6bc0::/48', '2607:6bc0:11::/48'],
        ANTHROPIC_ASN,
        {
          rdapBaseUrl: `${baseUrl}/primary`,
          fallbackRdapBaseUrl: `${baseUrl}/fallback`,
        }
      );
      assert.deepEqual(verified, [
        '160.79.104.0/23',
        '153.61.224.0/22',
        '2607:6bc0::/48',
        '2607:6bc0:11::/48',
      ]);
      assert.ok(requestedPaths.includes('/primary/ip/2607:6bc0:11::/48'));
      assert.equal(requestedPaths.includes('/fallback/ip/153.61.224.0/22'), true);
    });
  });

  it('rejects third-party cloud IPs and overly broad prefixes outside the registered RDAP block', async () => {
    await withHttpServer((request, response) => {
      const routes: Record<string, unknown> = {
        '/rdap/autnum/399358': SAMPLE_RDAP_AUTNUM_399358,
        '/rdap/ip/34.162.46.92/32': createRdapIp('GOOGL-2', 'Google LLC', [
          { v4prefix: '34.128.0.0', length: 10 },
        ]),
        '/rdap/ip/2001:db8:1::/48': createRdapIp('AP-2440', 'Anthropic, PBC', [
          { v6prefix: '2001:db8::', length: 32 },
        ]),
        '/rdap/ip/2001:db8:2::/48': createRdapIp('OTHER', 'Unrelated registrant', [
          { v6prefix: '2001:db8:2::', length: 48 },
        ]),
        '/rdap/ip/160.79.104.0/8': createRdapIp('AP-2440', 'Anthropic, PBC', [
          { v4prefix: '160.79.104.0', length: 21 },
        ]),
      };
      const body = routes[request.url ?? ''];
      response.writeHead(body ? 200 : 404, {
        'content-type': 'application/rdap+json',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify(body ?? { errorCode: 404 }));
    }, async baseUrl => {
      await assert.rejects(
        verifyCidrsWithRdap(['34.162.46.92/32'], ANTHROPIC_ASN, {
          rdapBaseUrl: `${baseUrl}/rdap`,
          fallbackRdapBaseUrl: null,
        }),
        /RDAP registrant mismatch/
      );
      await assert.rejects(
        verifyCidrsWithRdap(['2001:db8:1::/48', '2001:db8:2::/48'], ANTHROPIC_ASN, {
          rdapBaseUrl: `${baseUrl}/rdap`,
          fallbackRdapBaseUrl: null,
        }),
        /RDAP registrant mismatch for 2001:db8:2::/
      );
      await assert.rejects(
        verifyCidrsWithRdap(['160.79.104.0/8'], ANTHROPIC_ASN, {
          rdapBaseUrl: `${baseUrl}/rdap`,
          fallbackRdapBaseUrl: null,
        }),
        /do not contain candidate CIDR/
      );
    });
  });
});

describe('end-to-end automated primary IP loaders', () => {
  it('loads and RDAP-verifies both Anthropic docs and RIPEstat BGP prefixes', async () => {
    await withHttpServer((request, response) => {
      const reqUrl = request.url ?? '';
      if (reqUrl === '/docs/ip-addresses.md') {
        response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' });
        response.end(SAMPLE_ANTHROPIC_DOCS);
        return;
      }
      if (reqUrl === '/bgp?resource=AS399358') {
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify({
          status: 'ok',
          data: {
            resource: '399358',
            query_endtime: '2026-11-18T16:00:00',
            prefixes: [
              { prefix: '160.79.104.0/23', timelines: [{ endtime: '2026-11-18T16:00:00' }] },
              { prefix: '2607:6bc0::/48', timelines: [{ endtime: '2026-11-18T16:00:00' }] },
              { prefix: '2607:6bc0:11::/48', timelines: [{ endtime: '2026-11-18T16:00:00' }] },
            ],
          },
        }));
        return;
      }
      const rdapRoutes: Record<string, unknown> = {
        '/rdap/autnum/399358': SAMPLE_RDAP_AUTNUM_399358,
        '/rdap/ip/160.79.104.0/23': createRdapIp('AP-2440', 'Anthropic, PBC', [
          { v4prefix: '160.79.104.0', length: 21 },
        ]),
        '/rdap/ip/153.61.224.0/22': createRdapIp('AP-2440', 'Anthropic, PBC', [
          { v4prefix: '153.61.0.0', length: 16 },
        ]),
        '/rdap/ip/2607:6bc0::/48': createRdapIp('AP-2440', 'Anthropic, PBC', [
          { v6prefix: '2607:6BC0::', length: 32 },
        ]),
        '/rdap/ip/2607:6bc0:11::/48': createRdapIp('AP-2440', 'Anthropic, PBC', [
          { v6prefix: '2607:6BC0::', length: 32 },
        ]),
      };
      const body = rdapRoutes[reqUrl];
      response.writeHead(body ? 200 : 404, {
        'content-type': 'application/rdap+json',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify(body ?? { errorCode: 404 }));
    }, async baseUrl => {
      const rdapOptions = {
        throwOnError: true,
        rdapBaseUrl: `${baseUrl}/rdap`,
        fallbackRdapBaseUrl: null,
      };
      const docsRules = await loadAnthropicDocsIpRules(`${baseUrl}/docs/ip-addresses.md`, rdapOptions);
      assert.deepEqual(docsRules, [
        'IP-CIDR,160.79.104.0/23',
        'IP-CIDR,153.61.224.0/22',
        'IP-CIDR6,2607:6bc0::/48',
      ]);

      const bgpRules = await loadRipestatAsnRules(`${baseUrl}/bgp?resource=AS399358`, {
        ...rdapOptions,
        asn: 399358,
      });
      assert.deepEqual(bgpRules, [
        'IP-CIDR,160.79.104.0/23',
        'IP-CIDR6,2607:6bc0::/48',
        'IP-CIDR6,2607:6bc0:11::/48',
        'IP-ASN,399358',
      ]);

      // Non-throwing mode returns empty array on upstream failure.
      assert.deepEqual(
        await loadAnthropicDocsIpRules(`${baseUrl}/missing`, { ...rdapOptions, throwOnError: false }),
        []
      );
    });
  });
});

function googleRanges(prefixes: Array<Record<string, string>>) {
  return { syncToken: '1795400000000', creationTime: '2026-11-22T18:05:36.039917', prefixes };
}

describe('Google published IP ranges', () => {
  it('matches only the gstatic goog.json URL', () => {
    assert.equal(isGoogleIpRangesUrl(GOOGLE_IP_RANGES_URL), true);
    assert.equal(isGoogleIpRangesUrl(GOOGLE_CLOUD_IP_RANGES_URL), false);
    assert.equal(isGoogleIpRangesUrl('https://www.gstatic.com/ipranges/cloud.json'), false);
    assert.equal(isGoogleIpRangesUrl('http://www.gstatic.com/ipranges/goog.json'), false);
    assert.equal(isGoogleIpRangesUrl('https://www.gstatic.com/ipranges/goog.json?x=1'), false);
    assert.equal(isGoogleIpRangesUrl('https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/google.list'), false);
  });

  it('parses both address families and rejects malformed documents', () => {
    assert.deepEqual(
      parseGoogleIpRanges(googleRanges([{ ipv4Prefix: '8.8.8.0/24' }, { ipv6Prefix: '2001:4860::/32' }]), 'goog.json'),
      ['8.8.8.0/24', '2001:4860::/32']
    );
    assert.throws(() => parseGoogleIpRanges({ prefixes: [] }, 'goog.json'), /syncToken/);
    assert.throws(() => parseGoogleIpRanges(googleRanges([]), 'goog.json'), /no prefixes/);
    assert.throws(() => parseGoogleIpRanges(googleRanges([{ ipv4Prefix: '8.8.8.0/24', ipv6Prefix: '2001:4860::/32' }]), 'goog.json'), /exactly one/);
    assert.throws(() => parseGoogleIpRanges(googleRanges([{ ipv4Prefix: '2001:4860::/32' }]), 'goog.json'), /wrong address family/);
    assert.throws(() => parseGoogleIpRanges(googleRanges([{ ipv4Prefix: '0.0.0.0/0' }]), 'goog.json'), /invalid prefix/);
    assert.throws(() => parseGoogleIpRanges(googleRanges([{ ipv4Prefix: '1.2.3.4/33' }]), 'goog.json'), /invalid prefix/);
    assert.throws(() => parseGoogleIpRanges(googleRanges([{ ipv6Prefix: '2001:4860::/129' }]), 'goog.json'), /invalid prefix/);
  });

  it('removes Google Cloud customer ranges, including partial overlaps', () => {
    assert.deepEqual(
      excludeGoogleCloudRanges(['34.0.0.0/15', '8.8.8.0/24'], ['34.1.0.0/16']),
      ['8.8.8.0/24', '34.0.0.0/16']
    );
    assert.deepEqual(excludeGoogleCloudRanges(['8.8.4.0/24'], ['8.8.4.0/25']), ['8.8.4.128/25']);
    assert.deepEqual(excludeGoogleCloudRanges(['8.8.4.0/24'], ['8.8.4.0/23']), []);
    // IPv6 keeps its prefix length and compresses zero groups.
    assert.deepEqual(excludeGoogleCloudRanges(['2001:4860::/32'], []), ['2001:4860::/32']);
    assert.deepEqual(
      excludeGoogleCloudRanges(['2600:1900::/28'], ['2600:1900::/29']),
      ['2600:1908::/29']
    );
    assert.deepEqual(
      excludeGoogleCloudRanges(['2001:4860::/32'], ['2001:4860:8000::/33']),
      ['2001:4860::/33']
    );
    // IPv4-embedded IPv6 prefixes keep their embedded IPv4 bits intact.
    assert.deepEqual(
      excludeGoogleCloudRanges(['::ffff:192.0.2.0/120'], []),
      ['::ffff:c000:200/120']
    );
    // IPv4 results stay ordered before IPv6 results even when IPv6 has a smaller numeric value.
    assert.deepEqual(
      excludeGoogleCloudRanges(['::1/128', '8.8.8.0/24'], []),
      ['8.8.8.0/24', '::1/128']
    );
  });

  it('loads goog.json minus cloud.json and fails closed on an invalid cloud document', async () => {
    await withHttpServer((request, response) => {
      const routes: Record<string, unknown> = {
        '/goog.json': googleRanges([{ ipv4Prefix: '34.0.0.0/15' }, { ipv4Prefix: '8.8.8.0/24' }, { ipv6Prefix: '2001:4860::/32' }]),
        '/cloud.json': googleRanges([{ ipv4Prefix: '34.1.0.0/16' }]),
        '/broken-cloud.json': { prefixes: [] },
      };
      const body = routes[request.url ?? ''];
      response.writeHead(body ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify(body ?? {}));
    }, async baseUrl => {
      assert.deepEqual(
        await loadGoogleOwnedIpRules(`${baseUrl}/goog.json`, { throwOnError: true, cloudUrl: `${baseUrl}/cloud.json` }),
        ['IP-CIDR,8.8.8.0/24', 'IP-CIDR,34.0.0.0/16', 'IP-CIDR6,2001:4860::/32']
      );
      await assert.rejects(
        loadGoogleOwnedIpRules(`${baseUrl}/goog.json`, { throwOnError: true, cloudUrl: `${baseUrl}/broken-cloud.json` }),
        /cloud\.json/
      );
    });
  });
});

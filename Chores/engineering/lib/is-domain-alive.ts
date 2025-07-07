import DNS2 from 'dns2';
import asyncRetry from 'async-retry';
import picocolors from 'picocolors';
import tldts from 'tldts-experimental';
import * as whoiser from 'whoiser';
import process from 'node:process';

const domainAliveMap = new Map<string, boolean>();

class DnsError extends Error {
  name = 'DnsError';
  constructor(readonly message: string, public readonly server: string) {
    super(message);
  }
}

interface DnsResponse {
  answers: any[];
  dns: string;
}

// 国外 DoH 服务器
const dohServers: Array<[string, any]> = (
  [
    '8.8.8.8',
    '8.8.4.4',
    '1.0.0.1',
    '1.1.1.1',
    '162.159.36.1',
    '162.159.46.1',
    'dns.cloudflare.com',
    '101.101.101.101', // TWNIC
    '185.222.222.222', // DNS.SB
    '45.11.45.11', // DNS.SB
    'doh.dns.sb',
    'dns10.quad9.net',
    'doh.sandbox.opendns.com',
    'unfiltered.adguard-dns.com',
    'dns.nextdns.io',
    'anycast.dns.nextdns.io',
    'wikimedia-dns.org',
    'puredns.org',
    'basic.rethinkdns.com',
  ] as const
).map(
  dns =>
    [
      dns,
      DNS2.DOHClient({
        dns,
        http: false,
      }),
    ] as const
);

// 国内 DoH 服务器
const domesticDohServers: Array<[string, any]> = (
  ['223.5.5.5', '223.6.6.6', '120.53.53.53', '1.12.12.12'] as const
).map(
  dns =>
    [
      dns,
      DNS2.DOHClient({
        dns,
        http: false,
      }),
    ] as const
);

// 简单的互斥锁实现
const domainAliveMutex = new Map<string, Promise<boolean>>();

async function acquireMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = domainAliveMutex.get(key);
  if (existing) {
    return existing as any;
  }

  const promise = fn();
  domainAliveMutex.set(key, promise as any);

  try {
    const result = await promise;
    return result;
  } finally {
    domainAliveMutex.delete(key);
  }
}

export async function isDomainAlive(
  domain: string,
  isIncludeAllSubdomain: boolean
): Promise<boolean> {
  if (domainAliveMap.has(domain)) {
    return domainAliveMap.get(domain)!;
  }

  const tldtsOpt = {
    allowPrivateDomains: true,
    detectIp: false,
  };

  const apexDomain = tldts.getDomain(domain, tldtsOpt);
  if (!apexDomain) {
    domainAliveMap.set('.' + domain, true);
    return true;
  }

  const apexDomainAlive = await isApexDomainAlive(apexDomain);
  if (isIncludeAllSubdomain || domain.length > apexDomain.length) {
    return apexDomainAlive;
  }
  if (!apexDomainAlive) {
    return false;
  }

  return acquireMutex(domain, async () => {
    domain = domain[0] === '.' ? domain.slice(1) : domain;

    const aDns: string[] = [];
    const aaaaDns: string[] = [];

    // 测试 2 次确保记录为空
    const servers = pickRandom(dohServers, 2);
    for (let i = 0; i < 2; i++) {
      const aRecords = await $resolve(domain, 'A', servers[i]);
      if (aRecords.answers.length > 0) {
        domainAliveMap.set(domain, true);
        return true;
      }
      aDns.push(aRecords.dns);
    }

    for (let i = 0; i < 2; i++) {
      const aaaaRecords = await $resolve(domain, 'AAAA', servers[i]);
      if (aaaaRecords.answers.length > 0) {
        domainAliveMap.set(domain, true);
        return true;
      }
      aaaaDns.push(aaaaRecords.dns);
    }

    // 再用国内 DoH 服务器测试
    for (let i = 0; i < 2; i++) {
      const aRecords = await $resolve(domain, 'A', pickOne(domesticDohServers));
      if (aRecords.answers.length > 0) {
        domainAliveMap.set(domain, true);
        return true;
      }
      aDns.push(aRecords.dns);
    }

    for (let i = 0; i < 2; i++) {
      const aaaaRecords = await $resolve(domain, 'AAAA', pickOne(domesticDohServers));
      if (aaaaRecords.answers.length > 0) {
        domainAliveMap.set(domain, true);
        return true;
      }
      aaaaDns.push(aaaaRecords.dns);
    }

    console.log(picocolors.red('[domain dead]'), 'no A/AAAA records', {
      domain,
      a: aDns,
      aaaa: aaaaDns,
    });

    domainAliveMap.set(domain, false);
    return false;
  });
}

async function isApexDomainAlive(apexDomain: string): Promise<boolean> {
  if (domainAliveMap.has(apexDomain)) {
    return domainAliveMap.get(apexDomain)!;
  }

  return acquireMutex(apexDomain, async () => {
    const servers = pickRandom(dohServers, 2);
    for (let i = 0; i < servers.length; i++) {
      const server = servers[i];
      const resp = await $resolve(apexDomain, 'NS', server);
      if (resp.answers.length > 0) {
        domainAliveMap.set(apexDomain, true);
        return true;
      }
    }

    let whois;
    try {
      whois = await getWhois(apexDomain);
    } catch (e) {
      console.log(picocolors.red('[whois error]'), { domain: apexDomain }, e);
      domainAliveMap.set(apexDomain, true);
      return true;
    }

    const whoisError = noWhois(whois);
    if (!whoisError) {
      console.log(picocolors.gray('[domain alive]'), picocolors.gray('whois found'), {
        domain: apexDomain,
      });
      domainAliveMap.set(apexDomain, true);
      return true;
    }

    console.log(picocolors.red('[domain dead]'), 'whois not found', {
      domain: apexDomain,
      err: whoisError,
    });

    domainAliveMap.set(apexDomain, false);
    return false;
  });
}

async function $resolve(name: string, type: string, server: [string, any]): Promise<DnsResponse> {
  try {
    return await asyncRetry(
      async () => {
        const [dohServer, dohClient] = server;

        try {
          const result = await dohClient(name, type);
          return {
            ...result,
            dns: dohServer,
          } satisfies DnsResponse;
        } catch (e) {
          throw new DnsError((e as Error).message, dohServer);
        }
      },
      { retries: 5 }
    );
  } catch (e) {
    console.log('[doh error]', name, type, e);
    throw e;
  }
}

async function getWhois(domain: string) {
  return asyncRetry(() => whoiser.domain(domain, { raw: true }), { retries: 5 });
}

// WHOIS 关键词检测
const whoisNotFoundKeywords = [
  'no match for',
  'does not exist',
  'not found',
  'no found',
  'no entries',
  'no data found',
  'is available for registration',
  'currently available for application',
  'no matching record',
  'no information available about domain name',
  'not been registered',
  'no match!!',
  'status: available',
  ' is free',
  'no object found',
  'nothing found',
  'status: free',
  ' has been blocked by ',
];

function noWhois(whois: whoiser.WhoisSearchResult): null | string {
  let empty = true;

  for (const key in whois) {
    if (Object.hasOwn(whois, key)) {
      empty = false;

      if (key === '__raw' && typeof whois.__raw === 'string') {
        const lines = whois.__raw
          .trim()
          .toLowerCase()
          .replaceAll(/[\t ]+/g, ' ')
          .split(/\r?\n/);

        if (process.env.DEBUG) {
          console.log({ lines });
        }

        for (const line of lines) {
          for (const keyword of whoisNotFoundKeywords) {
            if (line.includes(keyword)) {
              return line;
            }
          }
        }
        continue;
      }

      if (typeof whois[key] === 'object' && !Array.isArray(whois[key])) {
        const tmp = noWhois(whois[key]);
        if (tmp) {
          return tmp;
        }
        continue;
      }
    }
  }

  if (empty) {
    return 'whois is empty';
  }

  return null;
}

// 辅助函数
function pickRandom<T>(arr: readonly T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function pickOne<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

import { Resolver } from 'node:dns/promises';
import net from 'node:net';
import picocolors from 'picocolors';
import type { Span } from '../trace/index.js';
import { pickRandom } from 'foxts/pick-random';
import { createRetrieKeywordFilter } from 'foxts/retrie';
import { newQueue } from '@henrygd/queue';
import cliProgress from 'cli-progress';

// DNS over HTTPS 服务器配置
const DOH_SERVERS_INTL = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/dns-query',
  'https://dns.quad9.net/dns-query',
  'https://doh.opendns.com/dns-query',
  'https://dns.sb/dns-query',
];

const DOH_SERVERS_CN = [
  'https://223.5.5.5/dns-query', // 阿里 DNS
  'https://doh.pub/dns-query', // 腾讯 DNS
  'https://1.12.12.12/dns-query', // DNSPod
];

// 创建 DNS 解析器
const resolver = new Resolver();
resolver.setServers(['1.1.1.1', '8.8.8.8', '9.9.9.9']);

// 域名活性缓存
const domainAliveMap = new Map<string, boolean>();

// 创建互斥锁
const mutexMap = new Map<string, Promise<boolean>>();

/**
 * 检查域名是否是 IP 地址
 */
function isIPAddress(domain: string): boolean {
  return net.isIP(domain) !== 0;
}

/**
 * 获取 Apex Domain（顶级域名）
 */
function getApexDomain(domain: string): string {
  const parts = domain.split('.');
  if (parts.length <= 2) return domain;

  // 处理常见的二级域名后缀
  const twoLevelTlds = ['co.uk', 'com.cn', 'net.cn', 'org.cn', 'gov.cn'];
  const lastTwo = parts.slice(-2).join('.');

  if (twoLevelTlds.includes(lastTwo) && parts.length > 2) {
    return parts.slice(-3).join('.');
  }

  return parts.slice(-2).join('.');
}

/**
 * 通过 DoH 查询检查域名
 */
async function checkDoH(domain: string, servers: string[]): Promise<boolean> {
  // 随机选择 2 个服务器
  const selectedServers = pickRandom(servers, 2);

  for (const server of selectedServers) {
    try {
      const url = new URL(server);
      url.searchParams.set('name', domain);
      url.searchParams.set('type', 'A');

      const response = await fetch(url.toString(), {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.Answer && data.Answer.length > 0) {
          return true;
        }
      }
    } catch {
      // 继续尝试下一个服务器
    }
  }
  return false;
}

/**
 * 通过 DNS 查询检查域名是否存活
 */
async function checkDNS(domain: string): Promise<boolean> {
  try {
    // 尝试解析 A 记录
    const addresses = await resolver.resolve4(domain).catch(() => []);
    if (addresses.length > 0) return true;

    // 尝试解析 AAAA 记录
    const addresses6 = await resolver.resolve6(domain).catch(() => []);
    if (addresses6.length > 0) return true;

    // 尝试解析 CNAME 记录
    const cname = await resolver.resolveCname(domain).catch(() => []);
    if (cname.length > 0) return true;

    // 尝试解析 NS 记录
    const ns = await resolver.resolveNs(domain).catch(() => []);
    if (ns.length > 0) return true;

    // 尝试解析 MX 记录
    const mx = await resolver.resolveMx(domain).catch(() => []);
    if (mx.length > 0) return true;

    return false;
  } catch {
    return false;
  }
}

/**
 * 检查单个域名是否存活
 */
async function checkSingleDomain(domain: string): Promise<boolean> {
  // 跳过 IP 地址
  if (isIPAddress(domain)) {
    return true;
  }

  // 检查缓存
  if (domainAliveMap.has(domain)) {
    return domainAliveMap.get(domain)!;
  }

  // 使用简单的互斥锁防止重复查询
  if (mutexMap.has(domain)) {
    return mutexMap.get(domain)!;
  }

  const promise = (async () => {
    // 1. 先检查 Apex Domain
    const apexDomain = getApexDomain(domain);
    if (apexDomain !== domain && domainAliveMap.has(apexDomain)) {
      const apexAlive = domainAliveMap.get(apexDomain)!;
      domainAliveMap.set(domain, apexAlive);
      return apexAlive;
    }

    // 2. DNS 查询
    let alive = await checkDNS(domain);

    // 3. 如果 DNS 无记录，尝试 DoH 查询
    if (!alive) {
      // 先尝试国际 DoH 服务器
      alive = await checkDoH(domain, DOH_SERVERS_INTL);

      // 如果还是无记录，尝试国内 DoH 服务器
      if (!alive) {
        alive = await checkDoH(domain, DOH_SERVERS_CN);
      }
    }

    // 缓存结果
    domainAliveMap.set(domain, alive);

    // 如果是 apex domain，也缓存它
    if (domain === apexDomain) {
      domainAliveMap.set(apexDomain, alive);
    }

    // 清理互斥锁
    mutexMap.delete(domain);

    return alive;
  })();

  mutexMap.set(domain, promise);
  return promise;
}

/**
 * 批量检查域名是否存活
 */
export async function checkDomainsAlive(
  span: Span,
  domains: string[],
  options?: {
    concurrency?: number;
    showProgress?: boolean;
  }
): Promise<Map<string, boolean>> {
  const concurrency = options?.concurrency || 32;
  const showProgress = options?.showProgress ?? true;

  console.log(`🔍 开始检查 ${domains.length} 个域名的活跃性...`);

  // 创建进度条
  let progressBar: cliProgress.SingleBar | null = null;
  if (showProgress) {
    progressBar = new cliProgress.SingleBar({
      format: '检查进度 |{bar}| {percentage}% | {value}/{total} | {eta_formatted}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
    });
    progressBar.start(domains.length, 0);
  }

  // 创建队列
  const queue = newQueue(concurrency);
  const results = new Map<string, boolean>();
  let processed = 0;

  // 处理函数
  const processDomain = async (domain: string) => {
    const alive = await checkSingleDomain(domain);
    results.set(domain, alive);

    if (!alive) {
      console.log(picocolors.red(`\n❌ 死域名: ${domain}`));
    }

    processed++;
    if (progressBar) {
      progressBar.update(processed);
    }
  };

  // 添加所有任务到队列
  const promises = domains.map(domain => queue.add(() => processDomain(domain)));

  // 等待所有任务完成
  await Promise.all(promises);

  if (progressBar) {
    progressBar.stop();
  }

  const aliveCount = Array.from(results.values()).filter(v => v).length;
  const deadCount = domains.length - aliveCount;

  console.log(`\n✅ 检查完成: ${aliveCount}/${domains.length} 个域名存活`);
  if (deadCount > 0) {
    console.log(picocolors.red(`❌ 发现 ${deadCount} 个死域名`));
  }

  return results;
}

/**
 * 过滤出存活的域名
 */
export async function filterAliveDomains(
  span: Span,
  domains: string[],
  options?: {
    concurrency?: number;
    showProgress?: boolean;
  }
): Promise<string[]> {
  const results = await checkDomainsAlive(span, domains, options);
  return domains.filter(domain => results.get(domain) === true);
}

/**
 * 获取死域名列表
 */
export async function getDeadDomains(
  span: Span,
  domains: string[],
  options?: {
    concurrency?: number;
    showProgress?: boolean;
  }
): Promise<string[]> {
  const results = await checkDomainsAlive(span, domains, options);
  return domains.filter(domain => results.get(domain) === false);
}

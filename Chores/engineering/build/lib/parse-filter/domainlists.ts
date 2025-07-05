/**
 * 域名列表解析器
 * 处理纯域名列表文件
 */

import { normalizeDomain } from '../utils.js';
import { parse as parseTldts } from 'tldts';

export interface ParsedDomain {
  /**
   * 完整域名
   */
  domain: string;

  /**
   * 子域名部分
   */
  subdomain?: string;

  /**
   * 主域名
   */
  mainDomain: string;

  /**
   * 顶级域名
   */
  tld: string;

  /**
   * 是否是 IP 地址
   */
  isIp: boolean;

  /**
   * 原始输入
   */
  raw: string;
}

/**
 * 解析域名
 */
export function parseDomain(input: string): ParsedDomain | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 检查是否是 IP 地址
  const isIp = isIpAddress(trimmed);
  if (isIp) {
    return {
      domain: trimmed,
      mainDomain: trimmed,
      tld: '',
      isIp: true,
      raw: input,
    };
  }

  // 使用 tldts 解析域名
  const parsed = parseTldts(trimmed, { allowPrivateDomains: true });

  if (!parsed.domain) {
    return null;
  }

  return {
    domain: trimmed,
    ...(parsed.subdomain && { subdomain: parsed.subdomain }),
    mainDomain: parsed.domain,
    tld: parsed.publicSuffix || '',
    isIp: false,
    raw: input,
  };
}

/**
 * 检查是否是 IP 地址
 */
function isIpAddress(str: string): boolean {
  // IPv4
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(str)) {
    const parts = str.split('.');
    return parts.every(part => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }

  // IPv6（简化检查）
  if (str.includes(':')) {
    return /^[0-9a-fA-F:]+$/.test(str);
  }

  return false;
}

/**
 * 从域名列表中提取和处理域名
 */
export function extractDomainsFromList(
  lines: string[],
  options: {
    /**
     * 是否标准化域名（转小写、去除 www）
     */
    normalize?: boolean;

    /**
     * 是否跳过 IP 地址
     */
    skipIps?: boolean;

    /**
     * 是否跳过无效域名
     */
    skipInvalid?: boolean;

    /**
     * 是否提取主域名
     */
    extractMainDomain?: boolean;
  } = {}
): string[] {
  const {
    normalize = true,
    skipIps = true,
    skipInvalid = true,
    extractMainDomain = false,
  } = options;

  const domains = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();

    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
      continue;
    }

    // 处理可能的行内注释
    const commentIndex = trimmed.indexOf('#');
    const domain = commentIndex > 0 ? trimmed.substring(0, commentIndex).trim() : trimmed;

    // 解析域名
    const parsed = parseDomain(domain);
    if (!parsed) {
      if (!skipInvalid) {
        domains.add(domain);
      }
      continue;
    }

    // 跳过 IP 地址
    if (parsed.isIp && skipIps) {
      continue;
    }

    // 选择要添加的域名
    let targetDomain = extractMainDomain && !parsed.isIp ? parsed.mainDomain : parsed.domain;

    // 标准化域名
    if (normalize && !parsed.isIp) {
      targetDomain = normalizeDomain(targetDomain);
    }

    domains.add(targetDomain);
  }

  return Array.from(domains).sort();
}

/**
 * 分析域名列表
 */
export function analyzeDomainList(domains: string[]): {
  total: number;
  valid: number;
  invalid: number;
  ips: number;
  mainDomains: Set<string>;
  tldDistribution: Map<string, number>;
  subdomainDepth: Map<number, number>;
} {
  const mainDomains = new Set<string>();
  const tldDistribution = new Map<string, number>();
  const subdomainDepth = new Map<number, number>();

  let valid = 0;
  let invalid = 0;
  let ips = 0;

  for (const domain of domains) {
    const parsed = parseDomain(domain);

    if (!parsed) {
      invalid++;
      continue;
    }

    if (parsed.isIp) {
      ips++;
      continue;
    }

    valid++;
    mainDomains.add(parsed.mainDomain);

    // TLD 分布
    if (parsed.tld) {
      const count = tldDistribution.get(parsed.tld) || 0;
      tldDistribution.set(parsed.tld, count + 1);
    }

    // 子域名深度
    const depth = parsed.subdomain ? parsed.subdomain.split('.').length : 0;
    const depthCount = subdomainDepth.get(depth) || 0;
    subdomainDepth.set(depth, depthCount + 1);
  }

  return {
    total: domains.length,
    valid,
    invalid,
    ips,
    mainDomains,
    tldDistribution,
    subdomainDepth,
  };
}

/**
 * 合并域名列表并去重
 */
export function mergeDomainLists(
  lists: string[][],
  options: {
    /**
     * 是否保留子域名（如果主域名存在）
     */
    keepSubdomains?: boolean;

    /**
     * 是否标准化
     */
    normalize?: boolean;

    /**
     * 白名单域名（不会被过滤）
     */
    whitelist?: string[];
  } = {}
): string[] {
  const { keepSubdomains = false, normalize = true, whitelist = [] } = options;

  // 收集所有域名
  const allDomains = new Set<string>();
  const mainDomains = new Set<string>();
  const whitelistSet = new Set(whitelist.map(d => (normalize ? normalizeDomain(d) : d)));

  // 第一遍：收集所有域名和主域名
  for (const list of lists) {
    for (const domain of list) {
      const normalizedDomain = normalize ? normalizeDomain(domain) : domain;
      allDomains.add(normalizedDomain);

      const parsed = parseDomain(normalizedDomain);
      if (parsed && !parsed.isIp) {
        mainDomains.add(parsed.mainDomain);
      }
    }
  }

  // 第二遍：过滤域名
  const result: string[] = [];

  for (const domain of allDomains) {
    // 白名单域名直接保留
    if (whitelistSet.has(domain)) {
      result.push(domain);
      continue;
    }

    const parsed = parseDomain(domain);
    if (!parsed || parsed.isIp) {
      result.push(domain);
      continue;
    }

    // 如果不保留子域名，且主域名存在，则跳过子域名
    if (!keepSubdomains && parsed.subdomain && mainDomains.has(parsed.mainDomain)) {
      continue;
    }

    result.push(domain);
  }

  return result.sort();
}

/**
 * 将域名列表转换为指定格式
 */
export function convertDomainListFormat(
  domains: string[],
  format: 'surge' | 'clash' | 'quantumultx' | 'hosts' | 'dnsmasq'
): string[] {
  const result: string[] = [];

  switch (format) {
    case 'surge':
      for (const domain of domains) {
        const parsed = parseDomain(domain);
        if (parsed && !parsed.isIp) {
          // 如果是主域名，使用 DOMAIN-SUFFIX
          if (parsed.domain === parsed.mainDomain) {
            result.push(`DOMAIN-SUFFIX,${domain}`);
          } else {
            result.push(`DOMAIN,${domain}`);
          }
        }
      }
      break;

    case 'clash':
      for (const domain of domains) {
        result.push(`  - '${domain}'`);
      }
      break;

    case 'quantumultx':
      for (const domain of domains) {
        const parsed = parseDomain(domain);
        if (parsed && !parsed.isIp) {
          if (parsed.domain === parsed.mainDomain) {
            result.push(`HOST-SUFFIX,${domain},PROXY`);
          } else {
            result.push(`HOST,${domain},PROXY`);
          }
        }
      }
      break;

    case 'hosts':
      for (const domain of domains) {
        result.push(`0.0.0.0 ${domain}`);
      }
      break;

    case 'dnsmasq':
      for (const domain of domains) {
        result.push(`address=/${domain}/`);
      }
      break;
  }

  return result;
}

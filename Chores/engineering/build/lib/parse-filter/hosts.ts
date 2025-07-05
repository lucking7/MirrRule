/**
 * Hosts 文件解析器
 * 解析 hosts 格式的域名列表
 */

import { normalizeDomain } from '../utils.js';

export interface ParsedHostsEntry {
  /**
   * IP 地址
   */
  ip: string;

  /**
   * 域名列表
   */
  domains: string[];

  /**
   * 原始行
   */
  raw: string;
}

/**
 * 解析 hosts 文件行
 */
export function parseHostsLine(line: string): ParsedHostsEntry | null {
  const trimmed = line.trim();

  // 跳过空行和注释
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  // 移除行内注释
  const commentIndex = trimmed.indexOf('#');
  const content = commentIndex > 0 ? trimmed.substring(0, commentIndex).trim() : trimmed;

  // 分离 IP 和域名
  const parts = content.split(/\s+/);
  if (parts.length < 2) {
    return null;
  }

  const ip = parts[0];
  const domains = parts.slice(1);

  // 验证 IP 格式（简单检查）
  if (!isValidIp(ip)) {
    return null;
  }

  return {
    ip,
    domains,
    raw: line,
  };
}

/**
 * 简单的 IP 验证
 */
function isValidIp(ip: string): boolean {
  // IPv4
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    const parts = ip.split('.');
    return parts.every(part => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }

  // IPv6（简化检查）
  if (ip.includes(':')) {
    return /^[0-9a-fA-F:]+$/.test(ip);
  }

  return false;
}

/**
 * 从 hosts 文件中提取域名
 */
export function extractDomainsFromHosts(
  lines: string[],
  options: {
    /**
     * 目标 IP（只提取指向该 IP 的域名）
     */
    targetIp?: string;

    /**
     * 是否标准化域名
     */
    normalize?: boolean;

    /**
     * 是否包含子域名
     */
    includeSubdomains?: boolean;
  } = {}
): string[] {
  const { targetIp, normalize = true, includeSubdomains = true } = options;
  const domains = new Set<string>();

  for (const line of lines) {
    const entry = parseHostsLine(line);
    if (!entry) continue;

    // 如果指定了目标 IP，只处理匹配的条目
    if (targetIp && entry.ip !== targetIp) {
      continue;
    }

    // 添加域名
    for (let domain of entry.domains) {
      if (normalize) {
        domain = normalizeDomain(domain);
      }

      // 跳过特殊域名
      if (
        domain === 'localhost' ||
        domain === 'localhost.localdomain' ||
        domain === 'local' ||
        domain === 'broadcasthost'
      ) {
        continue;
      }

      domains.add(domain);
    }
  }

  return Array.from(domains).sort();
}

/**
 * 将域名列表转换为 hosts 格式
 */
export function convertDomainsToHosts(
  domains: string[],
  options: {
    /**
     * 目标 IP
     */
    ip?: string;

    /**
     * 每行最大域名数
     */
    domainsPerLine?: number;

    /**
     * 是否添加注释
     */
    includeComments?: boolean;
  } = {}
): string[] {
  const { ip = '0.0.0.0', domainsPerLine = 1, includeComments = true } = options;
  const lines: string[] = [];

  if (includeComments) {
    lines.push('# Generated hosts file');
    lines.push(`# Total domains: ${domains.length}`);
    lines.push(`# Generated at: ${new Date().toISOString()}`);
    lines.push('');
  }

  // 分组域名
  for (let i = 0; i < domains.length; i += domainsPerLine) {
    const batch = domains.slice(i, i + domainsPerLine);
    lines.push(`${ip} ${batch.join(' ')}`);
  }

  return lines;
}

/**
 * 合并多个 hosts 文件
 */
export function mergeHostsFiles(
  filesContent: string[],
  options: {
    /**
     * 是否去重
     */
    deduplicate?: boolean;

    /**
     * 是否保留注释
     */
    preserveComments?: boolean;

    /**
     * 默认 IP
     */
    defaultIp?: string;
  } = {}
): string[] {
  const { deduplicate = true, preserveComments = false, defaultIp = '0.0.0.0' } = options;
  const ipToDomains = new Map<string, Set<string>>();
  const comments: string[] = [];

  // 解析所有文件
  for (const content of filesContent) {
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // 处理注释
      if (trimmed.startsWith('#') || !trimmed) {
        if (preserveComments) {
          comments.push(line);
        }
        continue;
      }

      const entry = parseHostsLine(line);
      if (!entry) continue;

      // 收集域名
      const domainSet = ipToDomains.get(entry.ip) || new Set<string>();
      entry.domains.forEach(domain => domainSet.add(domain));
      ipToDomains.set(entry.ip, domainSet);
    }
  }

  // 生成合并后的内容
  const result: string[] = [];

  if (preserveComments && comments.length > 0) {
    result.push(...comments);
    result.push('');
  }

  // 按 IP 分组输出
  for (const [ip, domainSet] of ipToDomains) {
    const domains = Array.from(domainSet).sort();

    if (deduplicate) {
      // 每个域名一行
      for (const domain of domains) {
        result.push(`${ip} ${domain}`);
      }
    } else {
      // 可以多个域名一行
      result.push(`${ip} ${domains.join(' ')}`);
    }
  }

  return result;
}

/**
 * 统计 hosts 文件信息
 */
export function analyzeHostsFile(content: string): {
  totalLines: number;
  commentLines: number;
  entryLines: number;
  uniqueDomains: number;
  uniqueIps: number;
  ipDistribution: Map<string, number>;
} {
  const lines = content.split('\n');
  const domains = new Set<string>();
  const ips = new Set<string>();
  const ipDistribution = new Map<string, number>();

  let totalLines = 0;
  let commentLines = 0;
  let entryLines = 0;

  for (const line of lines) {
    totalLines++;
    const trimmed = line.trim();

    if (!trimmed) continue;

    if (trimmed.startsWith('#')) {
      commentLines++;
      continue;
    }

    const entry = parseHostsLine(line);
    if (entry) {
      entryLines++;
      ips.add(entry.ip);

      entry.domains.forEach(domain => domains.add(domain));

      const count = ipDistribution.get(entry.ip) || 0;
      ipDistribution.set(entry.ip, count + entry.domains.length);
    }
  }

  return {
    totalLines,
    commentLines,
    entryLines,
    uniqueDomains: domains.size,
    uniqueIps: ips.size,
    ipDistribution,
  };
}

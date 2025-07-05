/**
 * CIDR IP 段优化模块
 * 实现 IP 段自动合并和 IPv4/IPv6 分离处理
 */

import { merge as mergeCidr, exclude as excludeCidr } from 'fast-cidr-tools';
import { isIPv4, isIPv6 } from 'node:net';
import picocolors from 'picocolors';

export interface CidrOptimizationResult {
  ipv4: string[];
  ipv6: string[];
  totalReduced: number;
  originalCount: number;
  optimizedCount: number;
}

/**
 * 检测 IP 版本
 */
function getIpVersion(ip: string): 4 | 6 | 0 {
  // 处理 CIDR 格式
  const ipOnly = ip.includes('/') ? ip.split('/')[0] : ip;

  if (isIPv4(ipOnly)) return 4;
  if (isIPv6(ipOnly)) return 6;
  return 0;
}

/**
 * 优化 CIDR IP 段列表
 * - 自动合并相邻和重叠的 IP 段
 * - 分离 IPv4 和 IPv6
 * - 移除重复项
 */
export function optimizeCidrList(cidrs: string[]): CidrOptimizationResult {
  const ipv4List: string[] = [];
  const ipv6List: string[] = [];
  const invalidCidrs: string[] = [];

  // 分离 IPv4 和 IPv6，同时验证格式
  for (const cidr of cidrs) {
    const trimmedCidr = cidr.trim();
    if (!trimmedCidr) continue;

    try {
      const version = getIpVersion(trimmedCidr);
      if (version === 4) {
        ipv4List.push(trimmedCidr);
      } else if (version === 6) {
        ipv6List.push(trimmedCidr);
      } else {
        invalidCidrs.push(trimmedCidr);
      }
    } catch (error) {
      invalidCidrs.push(trimmedCidr);
    }
  }

  if (invalidCidrs.length > 0) {
    console.log(picocolors.yellow('[CIDR] 发现无效的 CIDR:'), invalidCidrs);
  }

  // 合并 IPv4 段
  const mergedIpv4 = ipv4List.length > 0 ? mergeCidr(ipv4List) : [];

  // 合并 IPv6 段
  const mergedIpv6 = ipv6List.length > 0 ? mergeCidr(ipv6List) : [];

  const originalCount = cidrs.length;
  const optimizedCount = mergedIpv4.length + mergedIpv6.length;
  const totalReduced = originalCount - optimizedCount;

  if (totalReduced > 0) {
    console.log(
      picocolors.green(
        `[CIDR] 优化成功: ${originalCount} -> ${optimizedCount} (减少 ${totalReduced} 条)`
      )
    );
  }

  return {
    ipv4: mergedIpv4,
    ipv6: mergedIpv6,
    totalReduced,
    originalCount,
    optimizedCount,
  };
}

/**
 * 从 CIDR 列表中排除指定的 IP 段
 */
export function excludeFromCidrList(
  baseCidrs: string[],
  excludeCidrs: string[]
): CidrOptimizationResult {
  // 先分别优化基础列表和排除列表
  const baseOptimized = optimizeCidrList(baseCidrs);
  const excludeOptimized = optimizeCidrList(excludeCidrs);

  // 分别处理 IPv4 和 IPv6
  const resultIpv4 =
    baseOptimized.ipv4.length > 0 && excludeOptimized.ipv4.length > 0
      ? excludeCidr(baseOptimized.ipv4, excludeOptimized.ipv4)
      : baseOptimized.ipv4;

  const resultIpv6 =
    baseOptimized.ipv6.length > 0 && excludeOptimized.ipv6.length > 0
      ? excludeCidr(baseOptimized.ipv6, excludeOptimized.ipv6)
      : baseOptimized.ipv6;

  const originalCount = baseCidrs.length;
  const optimizedCount = resultIpv4.length + resultIpv6.length;

  return {
    ipv4: resultIpv4,
    ipv6: resultIpv6,
    totalReduced: originalCount - optimizedCount,
    originalCount,
    optimizedCount,
  };
}

/**
 * 检查 IP 是否在 CIDR 列表中
 */
export function isIpInCidrList(ip: string, cidrs: string[]): boolean {
  const version = getIpVersion(ip);
  if (!version) return false;

  // 只检查相同版本的 CIDR
  const relevantCidrs = cidrs.filter(cidr => {
    try {
      return getIpVersion(cidr) === version;
    } catch {
      return false;
    }
  });

  // 使用 fast-cidr-tools 的内置函数进行检查
  // 这里可以添加更高效的实现
  for (const cidr of relevantCidrs) {
    if (isIpInCidr(ip, cidr)) {
      return true;
    }
  }

  return false;
}

/**
 * 检查 IP 是否在单个 CIDR 中
 */
function isIpInCidr(ip: string, cidr: string): boolean {
  // 简单实现：检查 IP 是否与 CIDR 的基础 IP 相同
  const [cidrIp] = cidr.split('/');
  if (ip === cidrIp) {
    return true;
  }

  // TODO: 实现完整的 CIDR 包含检查
  // 可以使用 ip-address 或 netmask 等库来实现
  return false;
}

/**
 * 格式化 CIDR 列表输出
 */
export function formatCidrOutput(
  result: CidrOptimizationResult,
  options: {
    noResolve?: boolean;
    includeComments?: boolean;
  } = {}
): string[] {
  const output: string[] = [];

  if (options.includeComments) {
    output.push(`# 原始 IP 段数量: ${result.originalCount}`);
    output.push(`# 优化后数量: ${result.optimizedCount}`);
    output.push(
      `# 减少: ${result.totalReduced} (${(
        (result.totalReduced / result.originalCount) *
        100
      ).toFixed(2)}%)`
    );
    output.push('');
  }

  if (result.ipv4.length > 0) {
    if (options.includeComments) {
      output.push(`# IPv4 段 (${result.ipv4.length} 条)`);
    }
    for (const cidr of result.ipv4) {
      output.push(options.noResolve ? `IP-CIDR,${cidr},no-resolve` : `IP-CIDR,${cidr}`);
    }
  }

  if (result.ipv6.length > 0) {
    if (options.includeComments && result.ipv4.length > 0) {
      output.push('');
    }
    if (options.includeComments) {
      output.push(`# IPv6 段 (${result.ipv6.length} 条)`);
    }
    for (const cidr of result.ipv6) {
      output.push(options.noResolve ? `IP-CIDR6,${cidr},no-resolve` : `IP-CIDR6,${cidr}`);
    }
  }

  return output;
}

/**
 * 批量优化多个 CIDR 列表文件
 */
export async function optimizeCidrFiles(
  files: Array<{ path: string; cidrs: string[] }>,
  options: {
    merge?: boolean;
    excludePrivate?: boolean;
  } = {}
): Promise<CidrOptimizationResult> {
  let allCidrs: string[] = [];

  // 收集所有 CIDR
  for (const file of files) {
    allCidrs = allCidrs.concat(file.cidrs);
  }

  // 如果需要排除私有 IP 段
  if (options.excludePrivate) {
    const privateRanges = [
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '127.0.0.0/8',
      'fc00::/7',
      'fe80::/10',
      '::1/128',
    ];
    return excludeFromCidrList(allCidrs, privateRanges);
  }

  // 优化 CIDR 列表
  return optimizeCidrList(allCidrs);
}

/**
 * 验证 CIDR 格式
 */
export function validateCidr(cidr: string): { valid: boolean; error?: string } {
  const parts = cidr.split('/');
  if (parts.length !== 2) {
    return { valid: false, error: 'Invalid CIDR format: missing prefix length' };
  }

  const [ip, prefixStr] = parts;
  const prefix = parseInt(prefixStr, 10);

  const version = getIpVersion(ip);
  if (!version) {
    return { valid: false, error: 'Invalid IP address' };
  }

  if (version === 4) {
    if (prefix < 0 || prefix > 32) {
      return { valid: false, error: 'IPv4 prefix must be between 0 and 32' };
    }
  } else if (version === 6) {
    if (prefix < 0 || prefix > 128) {
      return { valid: false, error: 'IPv6 prefix must be between 0 and 128' };
    }
  }

  return { valid: true };
}

/**
 * 获取常见的中国大陆 IP 段
 */
export function getChinaCidrRanges(): string[] {
  // 这里只是示例，实际应该从权威数据源获取
  return [
    // 中国电信
    '1.0.1.0/24',
    '1.0.2.0/23',
    '1.0.8.0/21',
    '1.0.32.0/19',
    '1.1.0.0/24',
    '1.1.2.0/23',
    '1.1.4.0/22',
    '1.1.8.0/21',
    '1.1.16.0/20',
    '1.1.32.0/19',
    '1.1.64.0/18',
    '1.2.0.0/23',
    '1.2.2.0/24',
    '1.2.4.0/22',
    '1.2.8.0/21',
    '1.2.16.0/20',
    '1.2.32.0/19',
    '1.2.64.0/18',
    '1.2.128.0/17',
    '1.3.0.0/16',
    '1.4.1.0/24',
    '1.4.2.0/23',
    '1.4.4.0/22',
    '1.4.8.0/21',
    '1.4.16.0/20',
    '1.4.32.0/19',
    '1.4.64.0/18',
    '1.4.128.0/17',
    '1.8.0.0/16',
    '1.10.0.0/21',
    '1.10.8.0/23',
    '1.10.11.0/24',
    '1.10.12.0/22',
    '1.10.16.0/20',
    '1.10.32.0/19',
    '1.10.64.0/18',
    '1.10.128.0/17',
    '1.12.0.0/14',
    '1.24.0.0/13',
    '1.45.0.0/16',
    '1.48.0.0/14',
    '1.56.0.0/13',
    '1.68.0.0/14',
    '1.80.0.0/12',
    '1.116.0.0/14',
    '1.180.0.0/14',
    '1.184.0.0/15',
    '1.188.0.0/14',
    '1.192.0.0/13',
    '1.202.0.0/15',
    '1.204.0.0/14',
    // ... 更多 IP 段
  ];
}

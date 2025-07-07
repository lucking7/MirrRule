import { merge } from 'fast-cidr-tools';

export class CIDROptimizer {
  /**
   * 优化 CIDR 列表，返回合并后的结果
   * @param cidrs CIDR 列表
   * @param sort 是否排序（默认 true）
   * @returns 优化后的 CIDR 列表
   */
  static optimize(cidrs: string[], sort = true): string[] {
    if (!cidrs.length) return [];

    const ipv4List: string[] = [];
    const ipv6List: string[] = [];

    // 分离 IPv4 和 IPv6
    for (const cidr of cidrs) {
      if (cidr.includes(':')) {
        ipv6List.push(cidr);
      } else {
        ipv4List.push(cidr);
      }
    }

    // 只优化 IPv4，IPv6 保持原样
    const optimizedIPv4 = ipv4List.length > 0 ? merge(ipv4List, sort) : [];

    return [...optimizedIPv4, ...ipv6List];
  }
}

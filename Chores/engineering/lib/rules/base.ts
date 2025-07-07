import { HostnameSmolTrie } from '../trie.js';
import { CIDROptimizer } from '../cidr-optimizer.js';

/**
 * 基础规则输出类，包含 CIDR 优化功能
 */
export class FileOutput {
  public domainTrie = new HostnameSmolTrie(null);
  public wildcardTrie = new HostnameSmolTrie(null);

  protected ipcidr = new Set<string>();
  protected ipcidrNoResolve = new Set<string>();
  protected ipcidr6 = new Set<string>();
  protected ipcidr6NoResolve = new Set<string>();

  protected domains = new Set<string>();
  protected domainSuffixes = new Set<string>();
  protected domainKeywords = new Set<string>();

  constructor(protected id: string) {}

  /**
   * 添加 IPv4 CIDR
   */
  addCIDR4(cidrs: string[], noResolve = false) {
    const targetSet = noResolve ? this.ipcidrNoResolve : this.ipcidr;
    for (const cidr of cidrs) {
      targetSet.add(cidr.includes('/') ? cidr : cidr + '/32');
    }
    return this;
  }

  /**
   * 添加 IPv6 CIDR
   */
  addCIDR6(cidrs: string[], noResolve = false) {
    const targetSet = noResolve ? this.ipcidr6NoResolve : this.ipcidr6;
    for (const cidr of cidrs) {
      targetSet.add(cidr.includes('/') ? cidr : cidr + '/128');
    }
    return this;
  }

  /**
   * 获取优化后的 CIDR 列表
   */
  getOptimizedCIDRs(): {
    ipv4: string[];
    ipv4NoResolve: string[];
    ipv6: string[];
    ipv6NoResolve: string[];
  } {
    return {
      ipv4: this.ipcidr.size > 0 ? CIDROptimizer.optimize(Array.from(this.ipcidr)) : [],
      ipv4NoResolve:
        this.ipcidrNoResolve.size > 0
          ? CIDROptimizer.optimize(Array.from(this.ipcidrNoResolve))
          : [],
      ipv6: Array.from(this.ipcidr6),
      ipv6NoResolve: Array.from(this.ipcidr6NoResolve),
    };
  }

  /**
   * 添加域名
   */
  addDomain(domain: string) {
    this.domainTrie.add(domain, false);
    return this;
  }

  /**
   * 添加域名后缀
   */
  addDomainSuffix(domain: string) {
    this.domainTrie.add(domain, true);
    return this;
  }

  /**
   * 批量添加域名
   */
  bulkAddDomains(domains: string[]) {
    for (const domain of domains) {
      this.addDomain(domain);
    }
    return this;
  }

  /**
   * 批量添加域名后缀
   */
  bulkAddDomainSuffixes(suffixes: string[]) {
    for (const suffix of suffixes) {
      this.addDomainSuffix(suffix);
    }
    return this;
  }
}

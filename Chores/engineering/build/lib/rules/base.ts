/**
 * FileOutput 基类
 * 提供规则文件输出的基础功能，包括自动化优化
 */

import { writeFile } from 'fs/promises';
import { dirname } from 'path';
import { ensureDir } from '../utils.js';
import { HostnameTrie } from '../trie.js';
import { createKeywordFilter } from '../keyword-filter.js';
import { optimizeCidrList } from '../cidr-optimizer.js';

export interface FileOutputOptions {
  /**
   * 输出文件路径
   */
  outputPath: string;

  /**
   * 文件头部注释
   */
  header?: string[];

  /**
   * 是否自动优化（启用所有优化功能）
   */
  autoOptimize?: boolean;

  /**
   * 是否使用 Trie 树优化域名
   */
  useTrie?: boolean;

  /**
   * 是否合并 CIDR
   */
  mergeCidr?: boolean;

  /**
   * 是否使用关键词过滤
   */
  useKeywordFilter?: boolean;

  /**
   * 是否去重
   */
  deduplicate?: boolean;

  /**
   * 是否排序
   */
  sort?: boolean;

  /**
   * 关键词列表（用于过滤）
   */
  keywords?: string[];
}

export abstract class FileOutput {
  protected options: FileOutputOptions;
  protected rules: Set<string> = new Set();
  protected domainRules: Set<string> = new Set();
  protected ipRules: Set<string> = new Set();
  protected keywordRules: Set<string> = new Set();
  protected otherRules: Set<string> = new Set();

  constructor(options: FileOutputOptions) {
    this.options = {
      autoOptimize: true,
      useTrie: true,
      mergeCidr: true,
      useKeywordFilter: true,
      deduplicate: true,
      sort: true,
      ...options,
    };
  }

  /**
   * 添加规则
   */
  add(rule: string): void {
    const trimmed = rule.trim();
    if (!trimmed) return;

    // 分类规则
    if (this.isDomainRule(trimmed)) {
      this.domainRules.add(trimmed);
    } else if (this.isIpRule(trimmed)) {
      this.ipRules.add(trimmed);
    } else if (this.isKeywordRule(trimmed)) {
      this.keywordRules.add(trimmed);
    } else {
      this.otherRules.add(trimmed);
    }

    this.rules.add(trimmed);
  }

  /**
   * 批量添加规则
   */
  addAll(rules: string[]): void {
    rules.forEach(rule => this.add(rule));
  }

  /**
   * 获取优化后的规则
   */
  async getOptimizedRules(): Promise<string[]> {
    const { autoOptimize, useTrie, mergeCidr, useKeywordFilter, deduplicate, sort } = this.options;

    if (!autoOptimize) {
      return Array.from(this.rules);
    }

    let optimizedDomains = Array.from(this.domainRules);
    let optimizedIps = Array.from(this.ipRules);
    let optimizedKeywords = Array.from(this.keywordRules);
    let optimizedOthers = Array.from(this.otherRules);

    // 1. 域名去重和 Trie 优化
    if (deduplicate || useTrie) {
      optimizedDomains = this.optimizeDomains(optimizedDomains);
    }

    // 2. IP 段合并
    if (mergeCidr) {
      optimizedIps = await this.optimizeIps(optimizedIps);
    }

    // 3. 关键词过滤（移除被关键词覆盖的域名）
    if (useKeywordFilter && optimizedKeywords.length > 0) {
      optimizedDomains = this.filterDomainsByKeywords(optimizedDomains, optimizedKeywords);
    }

    // 4. 合并所有规则
    const allRules = [
      ...optimizedDomains,
      ...optimizedIps,
      ...optimizedKeywords,
      ...optimizedOthers,
    ];

    // 5. 排序
    if (sort) {
      allRules.sort();
    }

    return allRules;
  }

  /**
   * 优化域名规则
   */
  protected optimizeDomains(domains: string[]): string[] {
    const { useTrie, deduplicate } = this.options;

    // 提取纯域名
    const domainMap = new Map<string, string>();
    domains.forEach(rule => {
      const domain = this.extractDomain(rule);
      if (domain) {
        domainMap.set(domain, rule);
      }
    });

    let optimizedDomains = Array.from(domainMap.keys());

    // 去重
    if (deduplicate) {
      optimizedDomains = [...new Set(optimizedDomains)];
    }

    // Trie 优化
    if (useTrie) {
      const trie = new HostnameTrie();
      optimizedDomains.forEach(domain => trie.add(domain));
      optimizedDomains = trie.dump();
    }

    // 恢复规则格式
    return optimizedDomains.map(domain => {
      const originalRule = domainMap.get(domain);
      if (originalRule) {
        return originalRule.replace(this.extractDomain(originalRule) || '', domain);
      }
      return domain;
    });
  }

  /**
   * 优化 IP 规则
   */
  protected async optimizeIps(ips: string[]): Promise<string[]> {
    // 分离 IPv4 和 IPv6
    const ipv4Cidrs: string[] = [];
    const ipv6Cidrs: string[] = [];
    const ipRuleMap = new Map<string, string>();

    ips.forEach(rule => {
      const cidr = this.extractCidr(rule);
      if (cidr) {
        ipRuleMap.set(cidr, rule);
        if (cidr.includes(':')) {
          ipv6Cidrs.push(cidr);
        } else {
          ipv4Cidrs.push(cidr);
        }
      }
    });

    // 合并 CIDR
    const optimizedIpv4 = optimizeCidrList(ipv4Cidrs);
    const optimizedIpv6 = optimizeCidrList(ipv6Cidrs);

    // 恢复规则格式
    const mergedRules: string[] = [];

    [...optimizedIpv4.ipv4, ...optimizedIpv6.ipv6].forEach(cidr => {
      // 查找原始规则格式
      const originalRule = ipRuleMap.get(cidr);
      if (originalRule) {
        mergedRules.push(originalRule);
      } else {
        // 新合并的 CIDR，使用默认格式
        const ruleType = cidr.includes(':') ? 'IP-CIDR6' : 'IP-CIDR';
        mergedRules.push(`${ruleType},${cidr}`);
      }
    });

    return mergedRules;
  }

  /**
   * 使用关键词过滤域名
   */
  protected filterDomainsByKeywords(domains: string[], keywords: string[]): string[] {
    // 提取纯关键词
    const pureKeywords = keywords.map(rule => {
      const match = rule.match(/KEYWORD,(.+)$/i);
      return match ? match[1] : rule;
    });

    const filter = createKeywordFilter(pureKeywords);

    return domains.filter(domainRule => {
      const domain = this.extractDomain(domainRule);
      return domain ? !filter.matches(domain) : true;
    });
  }

  /**
   * 写入文件
   */
  async write(): Promise<void> {
    const { outputPath, header } = this.options;

    // 确保目录存在
    await ensureDir(dirname(outputPath));

    // 获取优化后的规则
    const rules = await this.getOptimizedRules();

    // 构建文件内容
    const lines: string[] = [];

    // 添加头部注释
    if (header && header.length > 0) {
      lines.push(...header);
      lines.push(''); // 空行分隔
    }

    // 添加规则
    lines.push(...rules);

    // 写入文件
    await writeFile(outputPath, lines.join('\n'), 'utf-8');

    console.log(`Written ${rules.length} rules to ${outputPath}`);
  }

  /**
   * 获取规则统计
   */
  getStatistics(): {
    total: number;
    domains: number;
    ips: number;
    keywords: number;
    others: number;
  } {
    return {
      total: this.rules.size,
      domains: this.domainRules.size,
      ips: this.ipRules.size,
      keywords: this.keywordRules.size,
      others: this.otherRules.size,
    };
  }

  /**
   * 清空规则
   */
  clear(): void {
    this.rules.clear();
    this.domainRules.clear();
    this.ipRules.clear();
    this.keywordRules.clear();
    this.otherRules.clear();
  }

  // 抽象方法，子类需要实现
  protected abstract isDomainRule(rule: string): boolean;
  protected abstract isIpRule(rule: string): boolean;
  protected abstract isKeywordRule(rule: string): boolean;
  protected abstract extractDomain(rule: string): string | null;
  protected abstract extractCidr(rule: string): string | null;
}

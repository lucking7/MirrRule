import path from 'node:path';
import fs from 'node:fs/promises';
import { HostnameSmolTrie } from '../lib/trie.js';
import { EnhancedTldValidator, RuleSource } from '../lib/enhanced-tld-validator.js';
import picocolors from 'picocolors';

interface RejectOptimizationOptions {
  enableTldValidation?: boolean;
  enableDomainMerge?: boolean;
  enableWhitelist?: boolean;
  whitelistDomains?: string[];
}

interface OptimizationResult {
  totalRules: number;
  validRules: number;
  invalidRules: number;
  mergedRules: number;
  whitelistedRules: number;
  finalRules: number;
}

export class RejectOptimizer {
  private validator: EnhancedTldValidator;
  private whitelistDomains: Set<string>;

  constructor() {
    this.validator = new EnhancedTldValidator();
    this.whitelistDomains = new Set();
  }

  /**
   * 设置白名单域名
   */
  setWhitelist(domains: string[]): void {
    this.whitelistDomains = new Set(domains);
  }

  /**
   * 优化 reject 规则文件
   *
   * 注意：reject 规则作为 RulesetOutput 类型，根据设计不应进行 tldts 规范化
   * 这是因为 reject 规则可能包含特殊格式的域名或 IP 地址
   */
  async optimizeFile(
    filePath: string,
    options: RejectOptimizationOptions = {}
  ): Promise<OptimizationResult> {
    const {
      enableTldValidation = false, // 默认不启用，因为 RulesetOutput 不应进行 TLD 验证
      enableDomainMerge = true,
      enableWhitelist = true,
      whitelistDomains = [],
    } = options;

    // 添加白名单
    if (whitelistDomains.length > 0) {
      whitelistDomains.forEach(domain => this.whitelistDomains.add(domain));
    }

    console.log(`\n🔧 优化文件: ${path.basename(filePath)}`);

    // 读取文件
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    // 初始化数据结构
    const domainTrie = new HostnameSmolTrie();
    const ipRules: string[] = [];
    const otherRules: string[] = [];
    const comments: string[] = [];

    let totalDomains = 0;
    let invalidDomains = 0;
    let whitelistedCount = 0;

    // 处理每一行
    for (const line of lines) {
      const trimmed = line.trim();

      // 保留注释和空行
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
        comments.push(line);
        continue;
      }

      // 处理域名规则
      if (trimmed.startsWith('DOMAIN,')) {
        const domain = trimmed.substring(7).split(',')[0];
        totalDomains++;

        // 检查白名单
        if (enableWhitelist && this.isWhitelisted(domain)) {
          whitelistedCount++;
          console.log(`⚪ 白名单域名: ${domain}`);
          continue;
        }

        // 验证 TLD
        if (enableTldValidation) {
          const result = this.validator.validate(domain, { source: RuleSource.LocalFile });
          if (!result.valid) {
            invalidDomains++;
            console.log(`❌ 无效域名: ${domain} - ${result.reason}`);
            continue;
          }
        }

        // 添加到 Trie
        if (enableDomainMerge) {
          domainTrie.add(domain, false);
        } else {
          otherRules.push(trimmed);
        }
      } else if (trimmed.startsWith('DOMAIN-SUFFIX,')) {
        const domain = trimmed.substring(14).split(',')[0];
        totalDomains++;

        // 检查白名单
        if (enableWhitelist && this.isWhitelisted(domain)) {
          whitelistedCount++;
          console.log(`⚪ 白名单域名: .${domain}`);
          continue;
        }

        // 验证 TLD
        if (enableTldValidation) {
          const result = this.validator.validate(domain, { source: RuleSource.LocalFile });
          if (!result.valid) {
            invalidDomains++;
            console.log(`❌ 无效域名: .${domain} - ${result.reason}`);
            continue;
          }
        }

        // 添加到 Trie
        if (enableDomainMerge) {
          domainTrie.add(domain, true);
        } else {
          otherRules.push(trimmed);
        }
      } else if (trimmed.startsWith('DOMAIN-KEYWORD,')) {
        const keyword = trimmed.substring(15).split(',')[0];

        // 检查关键词白名单
        if (enableWhitelist && this.whitelistDomains.has(keyword)) {
          whitelistedCount++;
          console.log(`⚪ 白名单关键词: ${keyword}`);
          continue;
        }

        otherRules.push(trimmed);
      } else if (trimmed.startsWith('IP-CIDR,') || trimmed.startsWith('IP-CIDR6,')) {
        ipRules.push(trimmed);
      } else {
        otherRules.push(trimmed);
      }
    }

    // 获取优化后的域名
    const optimizedDomains: { domain: string; isSuffix: boolean }[] = [];
    if (enableDomainMerge) {
      domainTrie.dump((domain, isIncludeSubdomain) => {
        optimizedDomains.push({ domain, isSuffix: isIncludeSubdomain });
      });
    }

    // 计算合并的规则数
    const mergedRules = totalDomains - invalidDomains - whitelistedCount - optimizedDomains.length;

    // 生成新文件内容
    const newLines: string[] = [];

    // 添加优化统计注释
    const hasOptimization = enableTldValidation || enableDomainMerge || enableWhitelist;
    if (hasOptimization) {
      newLines.push("# Sukka's Surge Reject Rules - Optimized");
      newLines.push('# NOTE: This file has been optimized and merged in-place');
      newLines.push(`# Total Rules: ${totalDomains}`);
      if (enableWhitelist && whitelistedCount > 0) {
        newLines.push(`# Removed by Whitelist: ${whitelistedCount}`);
      }
      if (enableTldValidation && invalidDomains > 0) {
        newLines.push(`# Invalid TLD Removed: ${invalidDomains}`);
      }
      if (enableDomainMerge && mergedRules > 0) {
        newLines.push(`# Domain Optimization: ${mergedRules} rules merged`);
      }
      newLines.push(`# IP Optimization: 0 CIDRs merged`);
      newLines.push(`# Last Updated: ${new Date().toISOString()}`);
      newLines.push('');
    }

    // 添加优化后的域名规则
    if (enableDomainMerge) {
      for (const { domain, isSuffix } of optimizedDomains) {
        if (isSuffix) {
          newLines.push(`DOMAIN-SUFFIX,${domain}`);
        } else {
          newLines.push(`DOMAIN,${domain}`);
        }
      }
    }

    // 添加其他规则
    if (otherRules.length > 0) {
      if (newLines.length > 0 && !newLines[newLines.length - 1].startsWith('#')) {
        newLines.push('');
      }
      newLines.push(...otherRules);
    }

    // 添加 IP 规则
    if (ipRules.length > 0) {
      if (newLines.length > 0 && !newLines[newLines.length - 1].startsWith('#')) {
        newLines.push('');
      }
      newLines.push('# IP Rules');
      newLines.push(...ipRules);
    }

    // 写回文件
    await fs.writeFile(filePath, newLines.join('\n'), 'utf-8');

    const result: OptimizationResult = {
      totalRules: totalDomains + ipRules.length + otherRules.length,
      validRules: totalDomains - invalidDomains,
      invalidRules: invalidDomains,
      mergedRules,
      whitelistedRules: whitelistedCount,
      finalRules: optimizedDomains.length + ipRules.length + otherRules.length,
    };

    // 输出报告
    console.log(`\n📊 优化报告 - ${path.basename(filePath)}`);
    console.log(`✅ 总规则数: ${result.totalRules}`);
    if (enableWhitelist && whitelistedCount > 0) {
      console.log(`⚪ 白名单移除: ${result.whitelistedRules}`);
    }
    if (enableTldValidation && invalidDomains > 0) {
      console.log(`❌ 无效 TLD: ${result.invalidRules}`);
    }
    if (enableDomainMerge && mergedRules > 0) {
      console.log(`🔄 域名合并: ${result.mergedRules}`);
    }
    console.log(`📝 最终规则数: ${result.finalRules}`);

    return result;
  }

  /**
   * 检查域名是否在白名单中
   */
  private isWhitelisted(domain: string): boolean {
    // 检查完全匹配
    if (this.whitelistDomains.has(domain)) {
      return true;
    }

    // 检查子域名匹配
    const parts = domain.split('.');
    for (let i = 0; i < parts.length; i++) {
      const suffix = parts.slice(i).join('.');
      if (this.whitelistDomains.has('.' + suffix)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 批量优化 reject 规则文件
   */
  async optimizeRejectRules(
    repoPath: string,
    options: RejectOptimizationOptions = {}
  ): Promise<void> {
    const rejectDir = path.join(repoPath, 'Surge/Rulesets/reject');

    // 需要优化的文件列表
    const filesToOptimize = [
      'block.list',
      'reject-drop.list',
      'reject-no-drop.list',
      'reject-QX.list',
      'reject-Loon.list',
    ];

    console.log(picocolors.bold('\n🚫 开始优化 Reject 规则集...'));

    let totalStats = {
      totalRules: 0,
      validRules: 0,
      invalidRules: 0,
      mergedRules: 0,
      whitelistedRules: 0,
      finalRules: 0,
    };

    for (const fileName of filesToOptimize) {
      const filePath = path.join(rejectDir, fileName);

      try {
        // 检查文件是否存在
        await fs.access(filePath);

        // 优化文件
        const result = await this.optimizeFile(filePath, options);

        // 累计统计
        totalStats.totalRules += result.totalRules;
        totalStats.validRules += result.validRules;
        totalStats.invalidRules += result.invalidRules;
        totalStats.mergedRules += result.mergedRules;
        totalStats.whitelistedRules += result.whitelistedRules;
        totalStats.finalRules += result.finalRules;
      } catch (error) {
        if ((error as any).code === 'ENOENT') {
          console.log(`⏭️  跳过不存在的文件: ${fileName}`);
        } else {
          console.error(`❌ 处理文件 ${fileName} 时出错:`, error);
        }
      }
    }

    // 输出总体统计
    console.log(picocolors.bold('\n📊 Reject 规则优化总结'));
    console.log('=====================================');
    console.log(`📁 处理文件数: ${filesToOptimize.length}`);
    console.log(`📋 原始规则总数: ${totalStats.totalRules}`);
    console.log(`✅ 有效规则: ${totalStats.validRules}`);
    console.log(`❌ 无效 TLD: ${totalStats.invalidRules}`);
    console.log(`⚪ 白名单移除: ${totalStats.whitelistedRules}`);
    console.log(`🔄 域名合并: ${totalStats.mergedRules}`);
    console.log(`📝 最终规则总数: ${totalStats.finalRules}`);
    console.log(
      `📉 优化比例: ${((1 - totalStats.finalRules / totalStats.totalRules) * 100).toFixed(2)}%`
    );

    // 设置 GitHub Actions 输出（使用新语法）
    if (process.env.GITHUB_OUTPUT) {
      const fs = await import('fs');
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `reject_processed=${totalStats.totalRules}\n`);
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `reject_invalid=${totalStats.invalidRules}\n`);
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `reject_merged=${totalStats.mergedRules}\n`);
    }
  }
}

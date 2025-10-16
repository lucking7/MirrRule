#!/usr/bin/env node
/**
 * 规则合并脚本（重构版）
 * 使用统一CLI框架重构，支持多源规则智能合并和去重
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CLIFramework, registerGlobalErrorHandlers } from './utils/cli';
import type { CLIContext } from './utils/cli';
import { outputFile } from './lib/create-file';
import { cleanPolicy } from './core/parsers/policy-cleaner';

/**
 * 合并策略类型
 */
type MergeStrategy = 'smart' | 'aggressive' | 'conservative';

/**
 * 规则合并器类
 */
class RuleMerger {
  private readonly strategy: MergeStrategy;
  private readonly ruleSet = new Set<string>();
  private readonly domainSet = new Set<string>();
  private readonly ipSet = new Set<string>();
  private readonly keywordSet = new Set<string>();

  constructor(strategy: MergeStrategy) {
    this.strategy = strategy;
  }

  /**
   * 添加规则
   */
  addRule(rule: string): void {
    const cleanedRule = cleanPolicy(rule);
    const trimmedRule = cleanedRule.trim();

    if (!trimmedRule || trimmedRule.startsWith('#') || trimmedRule.startsWith('//')) {
      return;
    }

    // 解析规则类型
    if (trimmedRule.startsWith('DOMAIN-SUFFIX,')) {
      const domain = trimmedRule.split(',')[1];
      this.addDomain(domain);
    } else if (trimmedRule.startsWith('DOMAIN,')) {
      const domain = trimmedRule.split(',')[1];
      this.domainSet.add(domain);
      this.ruleSet.add(trimmedRule);
    } else if (trimmedRule.startsWith('DOMAIN-KEYWORD,')) {
      const keyword = trimmedRule.split(',')[1];
      this.addKeyword(keyword);
    } else if (trimmedRule.startsWith('IP-CIDR,')) {
      const ip = trimmedRule.split(',')[1];
      this.addIP(ip);
    } else {
      this.ruleSet.add(trimmedRule);
    }
  }

  /**
   * 添加域名（智能去重）
   */
  private addDomain(domain: string): void {
    if (this.strategy === 'smart') {
      let shouldAdd = true;
      const parts = domain.split('.');

      for (let i = 1; i < parts.length; i++) {
        const parentDomain = parts.slice(i).join('.');
        if (this.domainSet.has(parentDomain)) {
          shouldAdd = false;
          break;
        }
      }

      if (shouldAdd) {
        const toRemove: string[] = [];
        for (const existingDomain of this.domainSet) {
          if (existingDomain.endsWith(`.${domain}`)) {
            toRemove.push(existingDomain);
          }
        }
        toRemove.forEach(d => this.domainSet.delete(d));

        this.domainSet.add(domain);
        this.ruleSet.add(`DOMAIN-SUFFIX,${domain}`);
      }
    } else if (this.strategy === 'aggressive') {
      this.domainSet.add(domain);
      this.ruleSet.add(`DOMAIN-SUFFIX,${domain}`);
    } else {
      const parts = domain.split('.');
      if (parts.length <= 2) {
        this.domainSet.add(domain);
        this.ruleSet.add(`DOMAIN-SUFFIX,${domain}`);
      }
    }
  }

  /**
   * 添加关键词（去重）
   */
  private addKeyword(keyword: string): void {
    if (this.strategy === 'smart' || this.strategy === 'conservative') {
      let shouldAdd = true;
      for (const existingKeyword of this.keywordSet) {
        if (existingKeyword.includes(keyword) || keyword.includes(existingKeyword)) {
          if (keyword.length < existingKeyword.length) {
            this.keywordSet.delete(existingKeyword);
          } else {
            shouldAdd = false;
          }
          break;
        }
      }
      if (shouldAdd) {
        this.keywordSet.add(keyword);
        this.ruleSet.add(`DOMAIN-KEYWORD,${keyword}`);
      }
    } else {
      this.keywordSet.add(keyword);
      this.ruleSet.add(`DOMAIN-KEYWORD,${keyword}`);
    }
  }

  /**
   * 添加IP规则
   */
  private addIP(ip: string): void {
    if (!this.ipSet.has(ip)) {
      this.ipSet.add(ip);
      this.ruleSet.add(`IP-CIDR,${ip}`);
    }
  }

  /**
   * 获取合并后的规则
   */
  getMergedRules(): string[] {
    return Array.from(this.ruleSet).sort((a, b) => {
      const typeOrder = ['DOMAIN,', 'DOMAIN-SUFFIX,', 'DOMAIN-KEYWORD,', 'IP-CIDR,', 'GEOIP,'];
      const aType = typeOrder.findIndex(t => a.startsWith(t));
      const bType = typeOrder.findIndex(t => b.startsWith(t));

      if (aType !== bType) {
        return aType - bType;
      }

      return a.localeCompare(b);
    });
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    return {
      total: this.ruleSet.size,
      domains: this.domainSet.size,
      ips: this.ipSet.size,
      keywords: this.keywordSet.size
    };
  }
}

/**
 * 规则合并CLI命令类
 */
class MergeRulesCLI extends CLIFramework {
  constructor() {
    super({
      name: 'merge-rules',
      description: '规则合并工具 - 支持多源规则智能合并和去重',
      version: '2.0.0',
      options: [
        {
          name: 'strategy',
          alias: 's',
          type: 'string',
          description: '合并策略',
          choices: ['smart', 'aggressive', 'conservative'],
          defaultValue: 'smart'
        },
        {
          name: 'source',
          type: 'string',
          description: '源规则目录',
          defaultValue: path.join(process.cwd(), 'temp', 'rules')
        },
        {
          name: 'output',
          alias: 'o',
          type: 'string',
          description: '输出目录',
          defaultValue: path.join(process.cwd(), 'public', 'Rules', 'Merged')
        }
      ]
    });
  }

  /**
   * 执行规则合并
   */
  protected async execute(context: CLIContext): Promise<number> {
    const { logger, args } = context;

    const strategy = args.strategy as MergeStrategy;
    const sourceDir = args.source as string;
    const outputDir = args.output as string;

    // 显示配置信息
    logger.info('合并配置:');
    logger.progress(`策略: ${strategy}`);
    logger.progress(`源目录: ${sourceDir}`);
    logger.progress(`输出目录: ${outputDir}`);

    try {
      // 创建合并器
      const merger = new RuleMerger(strategy);

      // 确保输出目录存在
      await this.ensureDir(outputDir);

      // 读取规则文件
      const filesProcessed = await this.loadRules(sourceDir, merger, logger);

      if (filesProcessed === 0) {
        logger.warn('未找到规则文件，使用示例规则');
        this.loadSampleRules(merger);
      }

      // 获取合并后的规则
      const mergedRules = merger.getMergedRules();
      const stats = merger.getStatistics();

      // 显示统计信息
      this.showStats('合并统计', {
        总规则数: stats.total,
        域名规则: stats.domains,
        IP规则: stats.ips,
        关键词规则: stats.keywords,
        处理文件数: filesProcessed
      });

      // 生成输出文件
      await this.generateOutputFiles(outputDir, mergedRules, strategy, logger);

      return this.success(`规则合并完成！共 ${stats.total} 条规则`);
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`合并失败: ${error.message}`);
      }
      return 1;
    }
  }

  /**
   * 加载规则文件
   */
  private async loadRules(sourceDir: string, merger: RuleMerger, logger: any): Promise<number> {
    let count = 0;

    try {
      const files = await fs.readdir(sourceDir);
      logger.progress(`找到 ${files.length} 个文件`);

      for (const file of files) {
        if (file.endsWith('.list') || file.endsWith('.txt')) {
          const filePath = path.join(sourceDir, file);
          logger.progress(`处理 ${file}...`);

          const content = await fs.readFile(filePath, 'utf-8');
          const rules = content.split('\n');

          rules.forEach(rule => merger.addRule(rule));
          count++;
        }
      }
    } catch {
      // 源目录不存在，返回0
    }

    return count;
  }

  /**
   * 加载示例规则
   */
  private loadSampleRules(merger: RuleMerger): void {
    const sampleRules = [
      'DOMAIN-SUFFIX,doubleclick.net',
      'DOMAIN-SUFFIX,ads.doubleclick.net',
      'DOMAIN-SUFFIX,googleadservices.com',
      'DOMAIN-KEYWORD,adserver',
      'IP-CIDR,117.177.248.0/24',
      'DOMAIN,example-ad.com',
      'GEOIP,CN'
    ];

    sampleRules.forEach(rule => merger.addRule(rule));
  }

  /**
   * 生成输出文件
   */
  private async generateOutputFiles(
    outputDir: string,
    mergedRules: string[],
    strategy: MergeStrategy,
    logger: any
  ): Promise<void> {
    const categories: Record<string, string[]> = {
      all: mergedRules,
      domain: mergedRules.filter(r => r.startsWith('DOMAIN')),
      ip: mergedRules.filter(r => r.startsWith('IP-CIDR')),
      keyword: mergedRules.filter(r => r.startsWith('DOMAIN-KEYWORD')),
      geo: mergedRules.filter(r => r.startsWith('GEOIP'))
    };

    logger.divider();
    logger.info('生成输出文件:');

    for (const [category, rules] of Object.entries(categories)) {
      if (rules.length > 0) {
        const outputPath = path.join(outputDir, `merged-${category}.list`);
        const content = [
          `# Merged Rules - ${category.toUpperCase()}`,
          `# Strategy: ${strategy}`,
          `# Generated: ${new Date().toISOString()}`,
          `# Total: ${rules.length} rules`,
          '',
          ...rules
        ].join('\n');

        await outputFile(outputPath, content);
        logger.progress(`✓ merged-${category}.list (${rules.length} 条规则)`);
      }
    }

    // 生成元数据
    await this.writeMetadata(path.join(outputDir, 'metadata.json'), {
      strategy,
      statistics: {
        total: mergedRules.length,
        categories: Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, v.length]))
      },
      files: Object.keys(categories).map(cat => ({
        name: `merged-${cat}.list`,
        count: categories[cat].length
      }))
    });
  }

  /**
   * 提供使用示例
   */
  protected getExamples(): string[] {
    return [
      'merge-rules',
      'merge-rules --strategy aggressive',
      'merge-rules --source /path/to/rules --output /path/to/output',
      'merge-rules --verbose'
    ];
  }
}

// 注册全局错误处理器
registerGlobalErrorHandlers();

// 运行CLI (CommonJS检查)
if (require.main === module) {
  const cli = new MergeRulesCLI();
  cli.run();
}

export { MergeRulesCLI };

#!/usr/bin/env node
/**
 * 规则转换脚本（重构版）
 * 使用统一CLI框架和共享验证器重构，支持多平台规则格式转换
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CLIFramework, registerGlobalErrorHandlers } from './utils/cli';
import type { CLIContext } from './utils/cli';
import { outputFile } from './lib/create-file';
import { cleanPolicies } from './core/parsers/policy-cleaner';
import { DomainValidator, IPValidator } from './utils/validation/validators';

/**
 * 支持的平台
 */
const PLATFORMS = ['surge', 'clash', 'quantumultx', 'shadowrocket'] as const;
type Platform = (typeof PLATFORMS)[number];

/**
 * 规则类别
 */
const CATEGORIES = ['ad-block', 'privacy', 'streaming', 'social', 'general'] as const;
type Category = (typeof CATEGORIES)[number];

/**
 * 示例规则库
 */
const SAMPLE_RULES: Record<Category, string[]> = {
  'ad-block': [
    'DOMAIN-SUFFIX,doubleclick.net',
    'DOMAIN-SUFFIX,googleadservices.com',
    'DOMAIN-SUFFIX,googlesyndication.com',
    'DOMAIN-KEYWORD,adserver',
    'IP-CIDR,117.177.248.0/24'
  ],
  privacy: [
    'DOMAIN-SUFFIX,google-analytics.com',
    'DOMAIN-SUFFIX,facebook.com/tr',
    'DOMAIN-KEYWORD,tracking'
  ],
  streaming: [
    'DOMAIN-SUFFIX,netflix.com',
    'DOMAIN-SUFFIX,nflxvideo.net',
    'DOMAIN-SUFFIX,youtube.com',
    'DOMAIN-KEYWORD,spotify'
  ],
  social: [
    'DOMAIN-SUFFIX,telegram.org',
    'DOMAIN-SUFFIX,twitter.com',
    'DOMAIN-SUFFIX,x.com',
    'IP-CIDR,91.108.4.0/22'
  ],
  general: ['DOMAIN-SUFFIX,cn', 'DOMAIN-KEYWORD,china', 'GEOIP,CN']
};

/**
 * 规则转换器类
 * 重构：使用共享验证器替代内联正则表达式
 */
class RuleConverter {
  /**
   * 转换为Surge格式（无策略）
   */
  toSurge(rules: string[]): string[] {
    const cleanedRules = cleanPolicies(rules);

    return cleanedRules.map(rule => {
      if (rule.includes(',')) {
        return rule;
      }

      // 使用共享验证器判断规则类型
      if (DomainValidator.isDomainLike(rule)) {
        return `DOMAIN-SUFFIX,${rule}`;
      }

      const ipType = IPValidator.getIpType(rule);
      if (ipType === 'ipv4' || ipType === 'ipv6') {
        return `IP-CIDR,${rule}`;
      }

      return rule;
    });
  }

  /**
   * 转换为Clash格式
   */
  toClash(rules: string[]): object {
    const cleanedRules = cleanPolicies(rules);
    const payload: string[] = [];

    for (const rule of cleanedRules) {
      if (rule.startsWith('DOMAIN-SUFFIX,')) {
        payload.push(`+.${rule.split(',')[1]}`);
      } else if (rule.startsWith('DOMAIN,')) {
        payload.push(rule.split(',')[1]);
      } else if (rule.startsWith('DOMAIN-KEYWORD,')) {
        payload.push(rule.split(',')[1]);
      } else if (rule.startsWith('IP-CIDR,')) {
        payload.push(rule.split(',')[1]);
      } else if (DomainValidator.isDomainLike(rule)) {
        payload.push(`+.${rule}`);
      }
    }

    return { payload };
  }

  /**
   * 转换为QuantumultX格式
   */
  toQuantumultX(rules: string[]): string[] {
    const cleanedRules = cleanPolicies(rules);

    return cleanedRules.map(rule => {
      const parts = rule.split(',');

      if (parts[0] === 'DOMAIN-SUFFIX') {
        return `HOST-SUFFIX,${parts[1]},PROXY`;
      }
      if (parts[0] === 'DOMAIN') {
        return `HOST,${parts[1]},PROXY`;
      }
      if (parts[0] === 'DOMAIN-KEYWORD') {
        return `HOST-KEYWORD,${parts[1]},PROXY`;
      }
      if (parts[0] === 'IP-CIDR') {
        return `IP-CIDR,${parts[1]},PROXY`;
      }

      // 使用共享验证器判断纯域名
      if (DomainValidator.isDomainLike(rule)) {
        return `HOST-SUFFIX,${rule},PROXY`;
      }

      return rule;
    });
  }

  /**
   * 转换为Shadowrocket格式（与Surge相同）
   */
  toShadowrocket(rules: string[]): string[] {
    return this.toSurge(rules);
  }

  /**
   * 去重
   */
  deduplicate(rules: string[]): string[] {
    return [...new Set(rules)];
  }
}

/**
 * 规则转换CLI命令类
 */
class ConvertRulesCLI extends CLIFramework {
  constructor() {
    super({
      name: 'convert-rules',
      description: '规则转换工具 - 支持多平台规则格式转换',
      version: '2.0.0',
      options: [
        {
          name: 'platform',
          alias: 'p',
          type: 'string',
          description: '目标平台',
          choices: [...PLATFORMS, 'all'],
          defaultValue: 'all'
        },
        {
          name: 'category',
          alias: 'c',
          type: 'string',
          description: '规则类别',
          choices: [...CATEGORIES, 'all'],
          defaultValue: 'all'
        },
        {
          name: 'force',
          alias: 'f',
          type: 'boolean',
          description: '强制覆盖已存在的文件',
          defaultValue: false
        },
        {
          name: 'output',
          alias: 'o',
          type: 'string',
          description: '输出基础目录',
          defaultValue: path.join(process.cwd(), 'public', 'Rules')
        }
      ]
    });
  }

  /**
   * 执行规则转换
   */
  protected async execute(context: CLIContext): Promise<number> {
    const { logger, args } = context;

    const platformArg = args.platform as string;
    const categoryArg = args.category as string;
    const force = args.force as boolean;
    const outputBaseDir = args.output as string;

    // 显示配置信息
    logger.info('转换配置:');
    logger.progress(`平台: ${platformArg}`);
    logger.progress(`类别: ${categoryArg}`);
    logger.progress(`强制覆盖: ${force ? '是' : '否'}`);
    logger.progress(`输出目录: ${outputBaseDir}`);

    try {
      // 创建转换器
      const converter = new RuleConverter();

      // 确保输出目录存在
      await this.ensureDir(outputBaseDir);

      // 确定要处理的类别和平台
      const categories: Category[] =
        categoryArg === 'all' ? [...CATEGORIES] : [categoryArg as Category];

      const platforms: Platform[] =
        platformArg === 'all' ? [...PLATFORMS] : [platformArg as Platform];

      // 执行转换
      logger.divider();
      logger.info('开始转换规则...');

      let totalFiles = 0;
      let totalRules = 0;

      for (const platform of platforms) {
        logger.info(`转换平台: ${platform}`);

        const platformDir = path.join(
          outputBaseDir,
          platform.charAt(0).toUpperCase() + platform.slice(1)
        );
        await this.ensureDir(platformDir);

        for (const category of categories) {
          const rules = SAMPLE_RULES[category];
          const dedupedRules = converter.deduplicate(rules);

          logger.progress(`${category}: ${dedupedRules.length} 条规则`);

          const { content, fileName } = this.formatOutput(
            platform,
            category,
            dedupedRules,
            converter
          );

          const outputPath = path.join(platformDir, fileName);
          await outputFile(outputPath, content);

          totalFiles++;
          totalRules += dedupedRules.length;
        }
      }

      // 生成元数据
      await this.generateMetadata(outputBaseDir, platforms, categories, converter);

      // 显示统计信息
      this.showStats('转换统计', {
        平台数: platforms.length,
        类别数: categories.length,
        生成文件数: totalFiles,
        总规则数: totalRules
      });

      return this.success('规则转换完成！');
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`转换失败: ${error.message}`);
      }
      return 1;
    }
  }

  /**
   * 格式化输出内容
   */
  private formatOutput(
    platform: Platform,
    category: Category,
    rules: string[],
    converter: RuleConverter
  ): { content: string, fileName: string } {
    let outputContent: string;
    let fileName: string;

    switch (platform) {
      case 'surge':
        outputContent = converter.toSurge(rules).join('\n');
        fileName = `${category}.list`;
        break;

      case 'clash':
        const clashRules = converter.toClash(rules);
        outputContent =
          `# ${category} Rules\npayload:\n`
          + (clashRules as { payload: string[] }).payload.map((r: string) => `  - '${r}'`).join('\n');
        fileName = `${category}.yaml`;
        break;

      case 'quantumultx':
        outputContent = converter.toQuantumultX(rules).join('\n');
        fileName = `${category}.list`;
        break;

      case 'shadowrocket':
        outputContent = converter.toShadowrocket(rules).join('\n');
        fileName = `${category}.list`;
        break;

      default:
        outputContent = rules.join('\n');
        fileName = `${category}.txt`;
    }

    return { content: outputContent, fileName };
  }

  /**
   * 生成元数据文件
   */
  private async generateMetadata(
    outputBaseDir: string,
    platforms: Platform[],
    categories: Category[],
    converter: RuleConverter
  ): Promise<void> {
    const metaDir = path.join(outputBaseDir, '.meta');
    await this.ensureDir(metaDir);

    await this.writeMetadata(path.join(metaDir, 'manifest.json'), {
      platforms,
      categories,
      statistics: Object.fromEntries(
        categories.map(cat => [cat, converter.deduplicate(SAMPLE_RULES[cat]).length])
      )
    });
  }

  /**
   * 提供使用示例
   */
  protected getExamples(): string[] {
    return [
      'convert-rules',
      'convert-rules --platform surge',
      'convert-rules --category ad-block',
      'convert-rules --platform clash --category privacy',
      'convert-rules --force --verbose'
    ];
  }
}

// 注册全局错误处理器
registerGlobalErrorHandlers();

// 运行CLI (CommonJS检查)
if (require.main === module) {
  const cli = new ConvertRulesCLI();
  cli.run();
}

export { ConvertRulesCLI };

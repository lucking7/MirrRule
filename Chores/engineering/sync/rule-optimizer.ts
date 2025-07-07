#!/usr/bin/env tsx

import { fdir as Fdir } from 'fdir';
import path from 'node:path';
import fs from 'node:fs/promises';
import { merge } from 'fast-cidr-tools';
import { HostnameSmolTrie } from '../lib/trie.js';
import picocolors from 'picocolors';
import { REPO_PATH } from './rule-sources.js';

// 默认排除的文件列表（基于用户需求）
const DEFAULT_EXCLUDED_FILES = new Set([
  'domestic.list',
  'global.list',
  'reject.list',
  'telegram.list',
  'direct.list',
  'cdn.list',
  'stream.list',
  'microsoft.list',
  'lan.list',
  'apple.list',
]);

interface OptimizationOptions {
  includeOnly?: string[];
  exclude?: string[];
  dryRun?: boolean;
  ipOnly?: boolean;
  domainOnly?: boolean;
}

interface OptimizationResult {
  file: string;
  originalCount: number;
  optimizedCount: number;
  reduction: number;
  type: 'ip' | 'domain' | 'both';
}

class RuleOptimizer {
  private excludedFiles: Set<string>;
  private includeOnly: Set<string> | null;
  private dryRun: boolean;
  private results: OptimizationResult[] = [];

  constructor(options: OptimizationOptions = {}) {
    // 处理排除列表
    if (options.exclude) {
      this.excludedFiles = new Set([...DEFAULT_EXCLUDED_FILES, ...options.exclude]);
    } else {
      this.excludedFiles = DEFAULT_EXCLUDED_FILES;
    }

    // 处理仅包含列表
    this.includeOnly = options.includeOnly ? new Set(options.includeOnly) : null;
    this.dryRun = options.dryRun || false;
  }

  async optimizeFile(filePath: string): Promise<void> {
    const basename = path.basename(filePath);

    // 检查是否应该处理此文件
    if (this.includeOnly && !this.includeOnly.has(basename)) {
      console.log(picocolors.gray(`⏭️  跳过文件（不在包含列表中）: ${basename}`));
      return;
    }

    if (this.excludedFiles.has(basename)) {
      console.log(picocolors.gray(`⏭️  跳过排除文件: ${basename}`));
      return;
    }

    console.log(picocolors.blue(`🔍 处理文件: ${basename}`));

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    // 分析文件内容
    const analysis = this.analyzeFile(lines);

    // 优化文件
    const optimized = await this.optimizeContent(lines, analysis);

    if (optimized.hasChanges) {
      const result: OptimizationResult = {
        file: path.relative(REPO_PATH, filePath),
        originalCount: analysis.domainCount + analysis.ipCount,
        optimizedCount: optimized.domainCount + optimized.ipCount,
        reduction:
          analysis.domainCount + analysis.ipCount - (optimized.domainCount + optimized.ipCount),
        type: analysis.hasIp && analysis.hasDomain ? 'both' : analysis.hasIp ? 'ip' : 'domain',
      };

      this.results.push(result);

      if (!this.dryRun) {
        await fs.writeFile(filePath, optimized.content.join('\n'), 'utf-8');
        console.log(
          picocolors.green(
            `  ✅ 优化完成: ${result.originalCount} → ${result.optimizedCount} (-${result.reduction})`
          )
        );
      } else {
        console.log(
          picocolors.yellow(
            `  🔍 预览: ${result.originalCount} → ${result.optimizedCount} (-${result.reduction})`
          )
        );
      }
    } else {
      console.log(picocolors.gray(`  ℹ️  无需优化`));
    }
  }

  private analyzeFile(lines: string[]) {
    const ipv4Cidrs: string[] = [];
    const ipv6Cidrs: string[] = [];
    const domains: Array<{ domain: string; isSuffix: boolean }> = [];
    const otherLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
        otherLines.push(line);
        continue;
      }

      if (trimmed.startsWith('IP-CIDR,')) {
        const cidr = trimmed.substring(8).split(',')[0];
        ipv4Cidrs.push(cidr);
      } else if (trimmed.startsWith('IP-CIDR6,')) {
        const cidr = trimmed.substring(9).split(',')[0];
        ipv6Cidrs.push(cidr);
      } else if (trimmed.startsWith('DOMAIN,')) {
        const domain = trimmed.substring(7);
        domains.push({ domain, isSuffix: false });
      } else if (trimmed.startsWith('DOMAIN-SUFFIX,')) {
        const domain = trimmed.substring(14);
        domains.push({ domain, isSuffix: true });
      } else {
        otherLines.push(line);
      }
    }

    return {
      ipv4Cidrs,
      ipv6Cidrs,
      domains,
      otherLines,
      hasIp: ipv4Cidrs.length > 0 || ipv6Cidrs.length > 0,
      hasDomain: domains.length > 0,
      ipCount: ipv4Cidrs.length + ipv6Cidrs.length,
      domainCount: domains.length,
    };
  }

  private async optimizeContent(lines: string[], analysis: any) {
    let hasChanges = false;
    let optimizedIpv4: string[] = analysis.ipv4Cidrs;
    let optimizedIpv6: string[] = analysis.ipv6Cidrs;
    let optimizedDomains = analysis.domains;

    // 优化 IP 段
    if (analysis.hasIp) {
      if (analysis.ipv4Cidrs.length > 0) {
        optimizedIpv4 = merge(analysis.ipv4Cidrs);
        if (optimizedIpv4.length !== analysis.ipv4Cidrs.length) {
          hasChanges = true;
        }
      }

      if (analysis.ipv6Cidrs.length > 0) {
        optimizedIpv6 = merge(analysis.ipv6Cidrs);
        if (optimizedIpv6.length !== analysis.ipv6Cidrs.length) {
          hasChanges = true;
        }
      }
    }

    // 优化域名
    if (analysis.hasDomain) {
      const trie = new HostnameSmolTrie();
      for (const { domain, isSuffix } of analysis.domains) {
        trie.add(domain, isSuffix);
      }

      optimizedDomains = [];
      trie.dump((domain: string, isIncludeSubdomain: boolean) => {
        optimizedDomains.push({ domain, isSuffix: isIncludeSubdomain });
      });

      if (optimizedDomains.length !== analysis.domains.length) {
        hasChanges = true;
      }
    }

    // 重建文件内容
    const newLines: string[] = [];
    let rulesInserted = false;

    for (const line of analysis.otherLines) {
      const trimmed = line.trim();

      // 在第一个非注释行之前插入规则
      if (!rulesInserted && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
        // 插入优化后的域名
        for (const { domain, isSuffix } of optimizedDomains) {
          if (isSuffix) {
            newLines.push(`DOMAIN-SUFFIX,${domain}`);
          } else {
            newLines.push(`DOMAIN,${domain}`);
          }
        }

        // 插入优化后的 IP
        for (const cidr of optimizedIpv4) {
          newLines.push(`IP-CIDR,${cidr}`);
        }
        for (const cidr of optimizedIpv6) {
          newLines.push(`IP-CIDR6,${cidr}`);
        }

        rulesInserted = true;
      }

      newLines.push(line);
    }

    // 如果没有插入（文件只有注释），在末尾添加
    if (!rulesInserted) {
      for (const { domain, isSuffix } of optimizedDomains) {
        if (isSuffix) {
          newLines.push(`DOMAIN-SUFFIX,${domain}`);
        } else {
          newLines.push(`DOMAIN,${domain}`);
        }
      }

      for (const cidr of optimizedIpv4) {
        newLines.push(`IP-CIDR,${cidr}`);
      }
      for (const cidr of optimizedIpv6) {
        newLines.push(`IP-CIDR6,${cidr}`);
      }
    }

    return {
      content: newLines,
      hasChanges,
      domainCount: optimizedDomains.length,
      ipCount: optimizedIpv4.length + optimizedIpv6.length,
    };
  }

  async optimizeDirectory(dirPath: string): Promise<void> {
    const files = await new Fdir()
      .withFullPaths()
      .filter(p => p.endsWith('.list') || p.endsWith('.conf') || p.endsWith('.txt'))
      .crawl(dirPath)
      .withPromise();

    for (const file of files) {
      // 跳过已优化的文件
      if (file.includes('-optimized')) continue;

      await this.optimizeFile(file);
    }
  }

  printReport(): void {
    console.log('\n' + picocolors.bold('📊 优化报告'));
    console.log('='.repeat(60));

    if (this.results.length === 0) {
      console.log(picocolors.gray('没有文件需要优化'));
      return;
    }

    let totalOriginal = 0;
    let totalOptimized = 0;
    let totalReduction = 0;

    // 按类型分组
    const ipResults = this.results.filter(r => r.type === 'ip');
    const domainResults = this.results.filter(r => r.type === 'domain');
    const bothResults = this.results.filter(r => r.type === 'both');

    // 打印每个文件的结果
    const printResults = (results: OptimizationResult[], title: string) => {
      if (results.length === 0) return;

      console.log('\n' + picocolors.bold(title));
      for (const result of results) {
        console.log(`  ${result.file}`);
        console.log(
          `    ${result.originalCount} → ${result.optimizedCount} (${picocolors.green(
            '-' + result.reduction
          )})`
        );

        totalOriginal += result.originalCount;
        totalOptimized += result.optimizedCount;
        totalReduction += result.reduction;
      }
    };

    printResults(domainResults, '🌐 域名优化');
    printResults(ipResults, '📡 IP 段优化');
    printResults(bothResults, '🔀 混合优化');

    // 总结
    console.log('\n' + picocolors.bold('📈 总计'));
    console.log(`  文件数: ${this.results.length}`);
    console.log(`  总规则数: ${totalOriginal} → ${totalOptimized}`);
    console.log(
      `  减少规则: ${picocolors.green(
        totalReduction + ' (' + ((totalReduction / totalOriginal) * 100).toFixed(2) + '%)'
      )}`
    );

    if (this.dryRun) {
      console.log('\n' + picocolors.yellow('⚠️  这是预览模式，没有实际修改文件'));
    }
  }
}

// 命令行接口
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${picocolors.bold('规则优化工具')}

使用方法:
  npx tsx optimize-rules.ts [选项]

选项:
  --include <file1,file2>  仅优化指定的文件
  --exclude <file1,file2>  排除指定的文件（追加到默认排除列表）
  --exclude-only <file1,file2>  仅使用指定的排除列表（替换默认）
  --dry-run               预览模式，不实际修改文件
  --ip-only               仅优化 IP 规则
  --domain-only           仅优化域名规则
  --help, -h              显示此帮助信息

默认排除的文件:
  ${Array.from(DEFAULT_EXCLUDED_FILES).join(', ')}

示例:
  # 优化所有文件（排除默认列表）
  npx tsx optimize-rules.ts
  
  # 仅优化指定文件
  npx tsx optimize-rules.ts --include facebook.list,twitter.list
  
  # 额外排除文件
  npx tsx optimize-rules.ts --exclude custom.list
  
  # 预览模式
  npx tsx optimize-rules.ts --dry-run
`);
    return;
  }

  const options: OptimizationOptions = {
    dryRun: args.includes('--dry-run'),
    ipOnly: args.includes('--ip-only'),
    domainOnly: args.includes('--domain-only'),
  };

  // 处理包含列表
  const includeIndex = args.indexOf('--include');
  if (includeIndex !== -1 && args[includeIndex + 1]) {
    options.includeOnly = args[includeIndex + 1].split(',').map(f => f.trim());
  }

  // 处理排除列表
  const excludeIndex = args.indexOf('--exclude');
  if (excludeIndex !== -1 && args[excludeIndex + 1]) {
    options.exclude = args[excludeIndex + 1].split(',').map(f => f.trim());
  }

  // 处理仅排除列表
  const excludeOnlyIndex = args.indexOf('--exclude-only');
  if (excludeOnlyIndex !== -1 && args[excludeOnlyIndex + 1]) {
    options.exclude = args[excludeOnlyIndex + 1].split(',').map(f => f.trim());
    // 清空默认列表
    (options as any).clearDefaults = true;
  }

  console.log(picocolors.bold('🚀 开始优化规则文件\n'));

  const optimizer = new RuleOptimizer(options);

  // 优化 Surge 规则
  const surgeDir = path.join(REPO_PATH, 'Surge/Rulesets');
  console.log(picocolors.cyan('📁 处理 Surge 规则目录...'));
  await optimizer.optimizeDirectory(surgeDir);

  // 优化 Clash 规则
  const clashDir = path.join(REPO_PATH, 'Clash/Rulesets');
  if (
    await fs
      .access(clashDir)
      .then(() => true)
      .catch(() => false)
  ) {
    console.log('\n' + picocolors.cyan('📁 处理 Clash 规则目录...'));
    await optimizer.optimizeDirectory(clashDir);
  }

  // 打印报告
  optimizer.printReport();
}

// 执行主函数
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch(err => {
    console.error(picocolors.red('❌ 错误:'), err);
    process.exit(1);
  });
}

export { RuleOptimizer, OptimizationOptions };

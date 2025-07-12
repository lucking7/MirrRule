import { Span } from '../trace/index.js';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import picocolors from 'picocolors';
import { SingleBar } from 'cli-progress';
import { IPListOutput } from '../lib/rules/ip.js';
import { readFileByLine } from '../lib/fetch-text-by-line.js';
import { merge as mergeCidr } from 'fast-cidr-tools';
import { HostnameSmolTrie } from '../../lib/trie.js';
import { fdir as Fdir } from 'fdir';

interface OptimizationStats {
  totalFiles: number;
  optimizedFiles: number;
  totalRulesReduced: number;
  ipOptimized: number;
  domainOptimized: number;
}

export async function optimizeAllRules(parentSpan: Span) {
  const span = parentSpan.traceChild('optimize-all-rules');

  try {
    console.log(picocolors.blue('⚡ 执行规则优化...'));

    // 优化任务列表
    const optimizationTasks = [
      {
        name: '优化 IP 规则（CIDR 合并）',
        func: () => optimizeIPRules(span),
      },
      {
        name: '优化域名规则（去重）',
        func: () => optimizeDomainRules(span),
      },
    ];

    const stats: OptimizationStats = {
      totalFiles: 0,
      optimizedFiles: 0,
      totalRulesReduced: 0,
      ipOptimized: 0,
      domainOptimized: 0,
    };

    // 并行执行优化任务
    const results = await Promise.all(
      optimizationTasks.map(async task => {
        const taskSpan = span.traceChild(task.name);
        try {
          console.log(picocolors.gray(`  ▶ ${task.name}...`));
          const result = await task.func();
          console.log(picocolors.green(`  ✓ ${task.name} 完成`));
          return result;
        } catch (error) {
          console.error(picocolors.red(`  ✗ ${task.name} 失败: ${error}`));
          throw error;
        } finally {
          taskSpan.stop();
        }
      })
    );

    // 合并统计数据
    results.forEach(result => {
      stats.totalFiles += result.totalFiles;
      stats.optimizedFiles += result.optimizedFiles;
      stats.totalRulesReduced += result.totalRulesReduced;
      if ('ipOptimized' in result) stats.ipOptimized += result.ipOptimized;
      if ('domainOptimized' in result) stats.domainOptimized += result.domainOptimized;
    });

    // 输出优化报告
    console.log(picocolors.cyan('\n📊 优化报告:'));
    console.log(
      picocolors.gray(`  • 总文件数: ${stats.totalFiles} | 已优化: ${stats.optimizedFiles}`)
    );
    console.log(picocolors.gray(`  • 规则减少: ${stats.totalRulesReduced} 条`));
    console.log(picocolors.gray(`  • IP 段合并: ${stats.ipOptimized} 条`));
    console.log(picocolors.gray(`  • 域名去重: ${stats.domainOptimized} 条`));

    console.log(picocolors.green('✅ 规则优化完成！'));
    return stats;
  } catch (error) {
    console.error(picocolors.red('❌ 规则优化失败:'), error);
    throw error;
  } finally {
    span.stop();
  }
}

// 优化 IP 规则（CIDR 合并）
async function optimizeIPRules(parentSpan: Span) {
  const span = parentSpan.traceChild('optimize-ip-rules');

  try {
    const rulesetDir = 'Surge/Rulesets';
    const stats = {
      totalFiles: 0,
      optimizedFiles: 0,
      totalRulesReduced: 0,
      ipOptimized: 0,
    };

    // 获取所有规则文件
    const files = await fs.readdir(rulesetDir);
    const ruleFiles = files.filter(f => f.endsWith('.list'));

    const progressBar = new SingleBar({
      format: '  {bar} {percentage}% | {value}/{total} 文件',
      barCompleteChar: '█',
      barIncompleteChar: '░',
    });

    progressBar.start(ruleFiles.length, 0);

    for (const file of ruleFiles) {
      const filePath = path.join(rulesetDir, file);
      stats.totalFiles++;

      try {
        const { optimized, reducedCount } = await optimizeIPRulesInFile(filePath, span);
        if (optimized) {
          stats.optimizedFiles++;
          stats.totalRulesReduced += reducedCount;
          stats.ipOptimized += reducedCount;
        }
      } catch (error) {
        console.error(picocolors.yellow(`\n  ⚠️  无法优化 ${file}: ${error}`));
      }

      progressBar.increment();
    }

    progressBar.stop();
    return stats;
  } finally {
    span.stop();
  }
}

// 优化单个文件中的 IP 规则
async function optimizeIPRulesInFile(
  filePath: string,
  parentSpan: Span
): Promise<{ optimized: boolean; reducedCount: number }> {
  const span = parentSpan.traceChild(`optimize-ip-file-${path.basename(filePath)}`);

  try {
    const lines: string[] = [];
    const ipv4Cidrs: string[] = [];
    const ipv6Cidrs: string[] = [];
    let hasChanges = false;

    // 读取文件并分类规则
    for await (const line of readFileByLine(filePath)) {
      const trimmed = line.trim();

      if (trimmed.startsWith('IP-CIDR,')) {
        const cidr = trimmed.split(',')[1];
        if (cidr.includes(':')) {
          ipv6Cidrs.push(cidr);
        } else {
          ipv4Cidrs.push(cidr);
        }
        hasChanges = true;
      } else {
        lines.push(line);
      }
    }

    if (!hasChanges) {
      return { optimized: false, reducedCount: 0 };
    }

    // 合并 CIDR
    const originalCount = ipv4Cidrs.length + ipv6Cidrs.length;
    const mergedIpv4 = ipv4Cidrs.length > 0 ? mergeCidr(ipv4Cidrs) : [];
    const mergedIpv6 = ipv6Cidrs.length > 0 ? mergeCidr(ipv6Cidrs) : [];

    // 重建文件内容
    const newLines: string[] = [];
    let insertedCidrs = false;

    for (const line of lines) {
      if (!insertedCidrs && line.trim() && !line.startsWith('#')) {
        // 在第一个非注释行之前插入合并后的 CIDR
        for (const cidr of mergedIpv4) {
          newLines.push(`IP-CIDR,${cidr},no-resolve`);
        }
        for (const cidr of mergedIpv6) {
          newLines.push(`IP-CIDR6,${cidr},no-resolve`);
        }
        insertedCidrs = true;
      }
      newLines.push(line);
    }

    // 如果文件只有注释，在末尾添加
    if (!insertedCidrs) {
      for (const cidr of mergedIpv4) {
        newLines.push(`IP-CIDR,${cidr},no-resolve`);
      }
      for (const cidr of mergedIpv6) {
        newLines.push(`IP-CIDR6,${cidr},no-resolve`);
      }
    }

    // 写回文件
    await fs.writeFile(filePath, newLines.join('\n'));

    const newCount = mergedIpv4.length + mergedIpv6.length;
    const reducedCount = originalCount - newCount;

    return { optimized: true, reducedCount };
  } finally {
    span.stop();
  }
}

// 优化域名规则（去重）
async function optimizeDomainRules(parentSpan: Span) {
  const span = parentSpan.traceChild('optimize-domain-rules');

  try {
    const rulesetDir = 'Surge/Rulesets';
    const stats = {
      totalFiles: 0,
      optimizedFiles: 0,
      totalRulesReduced: 0,
      domainOptimized: 0,
    };

    // 获取所有规则文件
    const files = await fs.readdir(rulesetDir);
    const ruleFiles = files.filter(f => f.endsWith('.list'));

    const progressBar = new SingleBar({
      format: '  {bar} {percentage}% | {value}/{total} 文件',
      barCompleteChar: '█',
      barIncompleteChar: '░',
    });

    progressBar.start(ruleFiles.length, 0);

    for (const file of ruleFiles) {
      const filePath = path.join(rulesetDir, file);
      stats.totalFiles++;

      try {
        const { optimized, reducedCount } = await optimizeDomainRulesInFile(filePath, span);
        if (optimized) {
          stats.optimizedFiles++;
          stats.totalRulesReduced += reducedCount;
          stats.domainOptimized += reducedCount;
        }
      } catch (error) {
        console.error(picocolors.yellow(`\n  ⚠️  无法优化 ${file}: ${error}`));
      }

      progressBar.increment();
    }

    progressBar.stop();
    return stats;
  } finally {
    span.stop();
  }
}

// 优化单个文件中的域名规则
async function optimizeDomainRulesInFile(
  filePath: string,
  parentSpan: Span
): Promise<{ optimized: boolean; reducedCount: number }> {
  const span = parentSpan.traceChild(`optimize-domain-file-${path.basename(filePath)}`);

  try {
    const lines: string[] = [];
    const domainTrie = new HostnameSmolTrie();
    const domainRules: Map<string, string> = new Map();
    let hasChanges = false;

    // 读取文件并分类规则
    for await (const line of readFileByLine(filePath)) {
      const trimmed = line.trim();

      if (trimmed.startsWith('DOMAIN,') || trimmed.startsWith('DOMAIN-SUFFIX,')) {
        const parts = trimmed.split(',');
        const domain = parts[1];
        const ruleType = parts[0];

        if (!domainRules.has(domain)) {
          domainRules.set(domain, ruleType);
          domainTrie.add(domain);
        } else {
          hasChanges = true; // 发现重复
        }
      } else {
        lines.push(line);
      }
    }

    if (!hasChanges && domainRules.size === 0) {
      return { optimized: false, reducedCount: 0 };
    }

    // 使用 Trie 进行包含关系优化
    const optimizedDomains: Map<string, string> = new Map();
    for (const [domain, ruleType] of domainRules) {
      // 检查是否被其他域名包含
      let isIncluded = false;
      const parts = domain.split('.');
      for (let i = 1; i < parts.length; i++) {
        const parent = parts.slice(i).join('.');
        if (domainTrie.has(parent) && parent !== domain) {
          isIncluded = true;
          hasChanges = true;
          break;
        }
      }

      if (!isIncluded) {
        optimizedDomains.set(domain, ruleType);
      }
    }

    const originalCount = domainRules.size;
    const newCount = optimizedDomains.size;
    const reducedCount = originalCount - newCount;

    if (reducedCount === 0 && !hasChanges) {
      return { optimized: false, reducedCount: 0 };
    }

    // 重建文件内容
    const newLines: string[] = [];
    let insertedDomains = false;

    for (const line of lines) {
      if (!insertedDomains && line.trim() && !line.startsWith('#')) {
        // 在第一个非注释行之前插入优化后的域名规则
        for (const [domain, ruleType] of optimizedDomains) {
          newLines.push(`${ruleType},${domain}`);
        }
        insertedDomains = true;
      }
      newLines.push(line);
    }

    // 如果文件只有注释，在末尾添加
    if (!insertedDomains) {
      for (const [domain, ruleType] of optimizedDomains) {
        newLines.push(`${ruleType},${domain}`);
      }
    }

    // 写回文件
    await fs.writeFile(filePath, newLines.join('\n'));

    return { optimized: true, reducedCount };
  } finally {
    span.stop();
  }
}

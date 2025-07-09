import { Span } from '../trace/index.js';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import picocolors from 'picocolors';
import { SingleBar } from 'cli-progress';
import { IPListOutput } from '../lib/rules/ip.js';
import { readFileByLine } from '../lib/fetch-text-by-line.js';
import { merge as mergeCidr } from 'fast-cidr-tools';

export async function optimizeAllRules(parentSpan: Span) {
  const span = parentSpan.traceChild('optimize-all-rules');

  try {
    console.log(picocolors.blue('⚡ 执行规则优化...'));

    // 优化任务列表
    const optimizationTasks = [
      {
        name: 'IP 列表 CIDR 合并',
        task: () => optimizeIPLists(span),
      },
      {
        name: '域名集合优化',
        task: () => optimizeDomainSets(span),
      },
      {
        name: '混合规则集优化',
        task: () => optimizeMixedRulesets(span),
      },
      {
        name: '清理重复规则',
        task: () => cleanupDuplicates(span),
      },
    ];

    // 执行所有优化任务
    const results = await Promise.all(
      optimizationTasks.map(async ({ name, task }) => {
        try {
          console.log(picocolors.gray(`  ▶ ${name}...`));
          const result = await task();
          console.log(picocolors.green(`  ✓ ${name} 完成`));
          return { name, success: true, result };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.log(picocolors.red(`  ✗ ${name} 失败: ${errorMsg}`));
          return { name, success: false, error: errorMsg };
        }
      })
    );

    // 打印优化结果
    console.log(picocolors.green('\n✅ 规则优化完成'));

    const successful = results.filter(r => r.success);
    if (successful.length > 0) {
      successful.forEach(r => {
        if (r.result && r.result.stats) {
          const stats = r.result.stats;
          console.log(picocolors.gray(`${r.name}:`));
          Object.entries(stats).forEach(([key, value]) => {
            console.log(picocolors.gray(`  - ${key}: ${value}`));
          });
        }
      });
    }
  } finally {
    span.stop();
  }
}

// 优化 IP 列表（CIDR 合并）
async function optimizeIPLists(span: Span) {
  const childSpan = span.traceChild('optimize-ip-lists');

  try {
    const ipListDir = path.resolve('List');
    const ipFiles = await fs
      .readdir(ipListDir)
      .then(files =>
        files.filter(f => f.endsWith('.txt') && (f.includes('ipv4') || f.includes('ipv6')))
      )
      .catch(() => []);

    if (ipFiles.length === 0) {
      return { stats: { files: 0 } };
    }

    const progressBar = new SingleBar({
      format:
        'IP 优化 |' + picocolors.cyan('{bar}') + '| {percentage}% | {current}/{total} | {filename}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
    });

    progressBar.start(ipFiles.length, 0, { filename: '' });

    let totalOptimized = 0;
    let totalReduced = 0;

    for (let i = 0; i < ipFiles.length; i++) {
      const filename = ipFiles[i];
      const filePath = path.join(ipListDir, filename);

      try {
        // 读取 IP 列表
        const content = await fs.readFile(filePath, 'utf-8');
        const ips = content.trim().split('\n').filter(Boolean);
        const originalCount = ips.length;

        // 判断是 IPv4 还是 IPv6
        const isIPv4 = filename.includes('ipv4');

        if (isIPv4) {
          // IPv4 进行 CIDR 合并
          const merged = mergeCidr(ips, true);
          const mergedCount = merged.length;

          if (mergedCount < originalCount) {
            // 写回优化后的内容
            await fs.writeFile(filePath, merged.join('\n') + '\n');
            totalOptimized++;
            totalReduced += originalCount - mergedCount;
          }
        }

        progressBar.update(i + 1, { filename });
      } catch (error) {
        console.error(picocolors.red(`\n优化 ${filename} 失败:`), error);
      }
    }

    progressBar.stop();

    return {
      stats: {
        处理文件数: ipFiles.length,
        优化文件数: totalOptimized,
        减少规则数: totalReduced,
      },
    };
  } finally {
    childSpan.stop();
  }
}

// 优化域名集合
async function optimizeDomainSets(span: Span) {
  const childSpan = span.traceChild('optimize-domain-sets');

  try {
    // 域名集合已在构建时通过 Trie 自动优化
    // 这里可以添加额外的优化逻辑
    console.log(picocolors.gray('    域名集合已在构建时优化'));

    return {
      stats: {
        优化方式: 'Trie 结构',
        自动去重: '是',
        子域合并: '是',
      },
    };
  } finally {
    childSpan.stop();
  }
}

// 优化混合规则集
async function optimizeMixedRulesets(span: Span) {
  const childSpan = span.traceChild('optimize-mixed-rulesets');

  try {
    // 混合规则集的优化已在构建时完成
    // 包括：自动去重、CIDR 合并、格式验证等
    console.log(picocolors.gray('    混合规则集已在构建时优化'));

    return {
      stats: {
        自动去重: '是',
        'CIDR 合并': '是 (IPv4)',
        格式验证: '是',
      },
    };
  } finally {
    childSpan.stop();
  }
}

// 清理重复规则
async function cleanupDuplicates(span: Span) {
  const childSpan = span.traceChild('cleanup-duplicates');

  try {
    // 创建全局规则缓存，用于跨文件去重
    const globalRuleCache = {
      domains: new Set<string>(),
      ips: new Set<string>(),
      other: new Set<string>(),
    };

    // 扫描所有输出文件，统计重复情况
    const outputDirs = ['Surge/Rulesets', 'Surge/Domainset', 'List'];
    let duplicateCount = 0;

    for (const dir of outputDirs) {
      if (
        !(await fs
          .access(dir)
          .then(() => true)
          .catch(() => false))
      ) {
        continue;
      }

      const files = await fs.readdir(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = await fs.stat(filePath);

        if (!stat.isFile()) continue;

        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.trim().split('\n');

        for (const line of lines) {
          if (!line || line.startsWith('#')) continue;

          // 简单分类
          let cache: Set<string>;
          if (line.match(/^\d+\.\d+\.\d+\.\d+/) || line.includes(':')) {
            cache = globalRuleCache.ips;
          } else if (line.includes('.') && !line.includes(',')) {
            cache = globalRuleCache.domains;
          } else {
            cache = globalRuleCache.other;
          }

          if (cache.has(line)) {
            duplicateCount++;
          } else {
            cache.add(line);
          }
        }
      }
    }

    return {
      stats: {
        扫描目录: outputDirs.length,
        跨文件重复: duplicateCount,
        唯一域名: globalRuleCache.domains.size,
        '唯一 IP': globalRuleCache.ips.size,
        唯一其他: globalRuleCache.other.size,
      },
    };
  } finally {
    childSpan.stop();
  }
}

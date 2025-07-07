/**
 * 域名活性检测脚本
 *
 * 功能：
 * 1. 检测失效域名
 * 2. 默认只报告，使用--fix参数才执行删除操作
 * 3. 生成详细报告
 * 4. 支持GitHub Actions集成
 */

import { SOURCE_DIR } from '../constants/dir.js';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { isDomainAlive } from '../lib/is-domain-alive.js';
import { fdir as Fdir } from 'fdir';
import { runAgainstSourceFile } from '../lib/rule-extractor.js';
import * as cliProgress from 'cli-progress';
import { newQueue } from '@henrygd/queue';
import picocolors from 'picocolors';
import { getDnsCache, closeDnsCache } from '../lib/dns-cache.js';

interface DomainLocation {
  domain: string;
  includeAllSubdomain: boolean;
  filePath: string;
  lineNumber: number;
  originalLine: string;
}

interface CleanResult {
  totalChecked: number;
  deadDomainsFound: number;
  filesModified: number;
  rulesRemoved: number;
}

const concurrency = parseInt(process.env.CONCURRENCY ?? '32', 10);
const deadDomains: string[] = [];
const domainLocations = new Map<string, DomainLocation[]>();

/**
 * 扫描并记录域名位置信息
 */
async function scanAndRecordDomains(): Promise<void> {
  const scanPaths = [
    path.join(SOURCE_DIR, '..', 'Surge', 'Rulesets'),
    path.join(SOURCE_DIR, '..', 'Chores', 'ruleset'),
  ];

  for (const scanPath of scanPaths) {
    try {
      const ruleFiles = await new Fdir()
        .withFullPaths()
        .filter((filePath: string, isDirectory: boolean) => {
          if (isDirectory) return false;
          const extname = path.extname(filePath);
          return extname === '.list' || extname === '.conf' || extname === '.txt';
        })
        .crawl(scanPath)
        .withPromise();

      console.log(
        picocolors.blue(
          `[scan] 发现 ${ruleFiles.length} 个规则文件在 ${path.relative(process.cwd(), scanPath)}`
        )
      );

      for (const filePath of ruleFiles) {
        await runAgainstSourceFile(filePath, (domain, includeAllSubdomain) => {
          const domainKey = includeAllSubdomain ? '.' + domain : domain;

          if (!domainLocations.has(domainKey)) {
            domainLocations.set(domainKey, []);
          }

          domainLocations.get(domainKey)!.push({
            domain,
            includeAllSubdomain,
            filePath,
            lineNumber: 0,
            originalLine: '',
          });
        });
      }
    } catch (error) {
      console.log(picocolors.yellow(`[skip] 目录不存在或无法访问: ${scanPath}`));
    }
  }
}

/**
 * 扫描目录中的规则文件
 */
async function scanDirectoryForRules(dirPath: string): Promise<void> {
  const ruleFiles = await new Fdir()
    .withFullPaths()
    .filter((filePath, isDirectory) => {
      if (isDirectory) return false;
      const extname = path.extname(filePath);
      return extname === '.list' || extname === '.conf' || extname === '.txt';
    })
    .crawl(dirPath)
    .withPromise();

  for (const filePath of ruleFiles) {
    await scanFileForDomains(filePath);
  }
}

/**
 * 扫描单个文件中的域名并记录位置
 */
async function scanFileForDomains(filePath: string): Promise<void> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    let lineNumber = 0;

    return new Promise(resolve => {
      runAgainstSourceFile(
        filePath,
        (domain: string, includeAllSubdomain: boolean, originalLine?: string) => {
          lineNumber++;

          const domainKey = includeAllSubdomain ? '.' + domain : domain;

          if (!domainLocations.has(domainKey)) {
            domainLocations.set(domainKey, []);
          }

          domainLocations.get(domainKey)!.push({
            domain,
            includeAllSubdomain,
            filePath,
            lineNumber,
            originalLine: originalLine || lines[lineNumber - 1] || '',
          });
        }
      ).then(() => {
        console.log(picocolors.green('[scanned]'), path.relative(process.cwd(), filePath));
        resolve();
      });
    });
  } catch (error) {
    console.error(picocolors.red('[error]'), `扫描文件失败: ${filePath}`, error);
  }
}

/**
 * 解析域名键，返回域名和是否包含子域名
 */
function parseDomainKey(domainKey: string): { domain: string; includeAllSubdomain: boolean } {
  if (domainKey.startsWith('.')) {
    return {
      domain: domainKey.slice(1),
      includeAllSubdomain: true,
    };
  }
  return {
    domain: domainKey,
    includeAllSubdomain: false,
  };
}

/**
 * 检测域名活性（支持缓存）
 */
async function isDomainAliveWithCache(
  domain: string,
  includeAllSubdomain: boolean
): Promise<boolean> {
  const cache = getDnsCache();
  const cacheKey = includeAllSubdomain ? '.' + domain : domain;

  // 尝试从缓存获取
  const cached = cache.get(cacheKey);
  if (cached !== null) {
    cache.recordHit();
    console.log(picocolors.gray(`[cache-hit] ${cacheKey} -> ${cached.isAlive ? '✅' : '❌'}`));
    return cached.isAlive;
  }

  cache.recordMiss();

  // 缓存未命中，执行实际检测
  const startTime = Date.now();
  let isAlive: boolean;
  let errorCode: string | undefined;
  let errorMessage: string | undefined;

  try {
    isAlive = await isDomainAlive(domain, includeAllSubdomain);
  } catch (error: any) {
    isAlive = false;
    errorCode = error.code || 'UNKNOWN';
    errorMessage = error.message;
  }

  const resolveTime = Date.now() - startTime;

  // 设置缓存，成功的域名缓存时间更长
  const ttlMinutes = isAlive ? 360 : 180; // 6小时 vs 3小时
  cache.set(cacheKey, isAlive, ttlMinutes, {
    resolveTime,
    ...(errorCode && { errorCode }),
    ...(errorMessage && { errorMessage }),
  });

  console.log(
    picocolors.gray(`[dns-resolve] ${cacheKey} -> ${isAlive ? '✅' : '❌'} (${resolveTime}ms)`)
  );

  return isAlive;
}

/**
 * 检测失效域名
 */
async function detectDeadDomains(progressBar: cliProgress.SingleBar): Promise<void> {
  const allDomains = Array.from(domainLocations.keys());
  const cache = getDnsCache();

  // 清理过期缓存
  console.log(picocolors.blue('🗄️ 清理过期DNS缓存...'));
  const expiredCount = cache.cleanExpired();

  // 显示缓存统计
  const stats = cache.getStats();
  console.log(picocolors.blue(`📊 缓存统计: ${stats.validEntries}/${stats.totalEntries} 有效条目`));

  const concurrency = parseInt(process.env.CONCURRENCY || '64', 10);
  const queue = newQueue(concurrency);

  progressBar.setTotal(allDomains.length);
  let completed = 0;
  const startTime = Date.now();

  await Promise.all(
    allDomains.map(domainKey =>
      queue.add(async () => {
        const { domain, includeAllSubdomain } = parseDomainKey(domainKey);

        try {
          const alive = await isDomainAliveWithCache(domain, includeAllSubdomain);

          if (!alive) {
            deadDomains.push(domainKey);
          }
        } catch (error) {
          console.error(picocolors.red(`[error] 检测失败 ${domainKey}:`), error);
          deadDomains.push(domainKey); // 检测失败也视为失效
        }

        completed++;
        progressBar.increment(1, {
          speed: Math.round(completed / ((Date.now() - startTime) / 1000)),
        });
      })
    )
  );

  // 显示最终缓存统计
  const finalStats = cache.getStats();
  const hitRate = cache.getCacheHitRate();

  console.log(picocolors.blue(`\n📈 DNS缓存性能:`));
  console.log(picocolors.blue(`   缓存命中率: ${hitRate.toFixed(1)}%`));
  console.log(picocolors.blue(`   有效缓存条目: ${finalStats.validEntries}`));
  console.log(picocolors.blue(`   已清理过期条目: ${expiredCount}`));
}

/**
 * 从规则文件中移除失效域名
 */
async function removeDeadDomainsFromFiles(): Promise<CleanResult> {
  const result: CleanResult = {
    totalChecked: domainLocations.size,
    deadDomainsFound: deadDomains.length,
    filesModified: 0,
    rulesRemoved: 0,
  };

  const filesToModify = new Map<string, Set<number>>();

  // 收集需要删除的行号
  for (const deadDomain of deadDomains) {
    const locations = domainLocations.get(deadDomain);
    if (!locations) continue;

    for (const location of locations) {
      if (!filesToModify.has(location.filePath)) {
        filesToModify.set(location.filePath, new Set());
      }
      filesToModify.get(location.filePath)!.add(location.lineNumber);
      result.rulesRemoved++;
    }
  }

  // 修改文件
  for (const [filePath, linesToRemove] of filesToModify) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      // 从后往前删除，避免行号变化
      const sortedLines = Array.from(linesToRemove).sort((a, b) => b - a);

      for (const lineNumber of sortedLines) {
        if (lineNumber > 0 && lineNumber <= lines.length) {
          console.log(
            picocolors.red('[removing]'),
            `${filePath}:${lineNumber}`,
            lines[lineNumber - 1]
          );
          lines.splice(lineNumber - 1, 1);
        }
      }

      await fs.writeFile(filePath, lines.join('\n'));
      result.filesModified++;

      console.log(picocolors.green('[modified]'), filePath, `removed ${linesToRemove.size} lines`);
    } catch (error) {
      console.error(picocolors.red('[error]'), `Failed to modify ${filePath}:`, error);
    }
  }

  return result;
}

/**
 * 导出结果给GitHub Actions
 */
async function exportResultsForGitHub(deadDomains: string[], result: CleanResult): Promise<void> {
  const cacheDir = path.join(process.cwd(), '.cache');

  // 确保缓存目录存在
  await fs.mkdir(cacheDir, { recursive: true });

  // 生成详细结果
  const exportData = {
    timestamp: new Date().toISOString(),
    totalChecked: result.totalChecked,
    deadDomainsFound: result.deadDomainsFound,
    filesModified: result.filesModified,
    rulesRemoved: result.rulesRemoved,
    deadDomains: deadDomains,
    summary: {
      hasDeadDomains: deadDomains.length > 0,
      mode: result.rulesRemoved > 0 ? 'fix' : 'report',
    },
  };

  // 写入缓存文件
  await fs.writeFile(path.join(cacheDir, 'dead-domains.json'), JSON.stringify(exportData, null, 2));

  // 输出GitHub Actions环境变量
  if (process.env.GITHUB_OUTPUT) {
    const output =
      `has_dead_domains=${deadDomains.length > 0 ? 'true' : 'false'}\n` +
      `dead_domains_count=${deadDomains.length}\n` +
      `files_modified=${result.filesModified}\n` +
      `rules_removed=${result.rulesRemoved}\n`;

    await fs.appendFile(process.env.GITHUB_OUTPUT, output);
  }

  console.log(picocolors.blue(`[github] 已导出结果到 .cache/dead-domains.json`));
}

/**
 * 主函数
 */
async function main() {
  console.log(picocolors.blue('🧹 开始清理失效域名...'));

  try {
    // 1. 扫描并记录域名位置
    console.log(picocolors.yellow('📁 扫描规则文件并记录域名位置...'));
    await scanAndRecordDomains();
    console.log(picocolors.green(`✅ 扫描完成，共发现 ${domainLocations.size} 个唯一域名`));

    // 2. 检测失效域名
    console.log(picocolors.yellow('🔍 检测域名存活状态...'));
    const progressBar = new cliProgress.SingleBar(
      {
        format: '检测进度 |{bar}| {percentage}% | {value}/{total} | 速度: {speed} 域名/秒',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true,
      },
      cliProgress.Presets.shades_classic
    );

    progressBar.start(0, 0);
    await detectDeadDomains(progressBar);
    progressBar.stop();

    console.log(picocolors.green(`✅ 检测完成，发现 ${deadDomains.length} 个失效域名`));

    if (deadDomains.length === 0) {
      console.log(picocolors.green('🎉 没有发现失效域名！'));

      // 保存空结果到缓存文件
      await exportResultsForGitHub([], {
        totalChecked: domainLocations.size,
        deadDomainsFound: 0,
        filesModified: 0,
        rulesRemoved: 0,
      });

      return;
    }

    // 3. 显示失效域名列表
    console.log(picocolors.red('\n💀 失效域名列表:'));
    deadDomains.forEach(domain => {
      console.log(picocolors.red(`  - ${domain}`));
    });

    // 4. 处理修复逻辑
    const shouldApplyFix =
      process.argv.includes('--apply') ||
      process.argv.includes('--fix') ||
      process.env.AUTO_FIX === 'true';

    if (shouldApplyFix) {
      console.log(picocolors.yellow('\n🔧 开始自动修复...'));
      const cleanResult = await removeDeadDomainsFromFiles();

      console.log(picocolors.green('\n✅ 修复完成！'));
      console.log(`   检查域名总数: ${cleanResult.totalChecked}`);
      console.log(`   发现失效域名: ${cleanResult.deadDomainsFound}`);
      console.log(`   修改文件数量: ${cleanResult.filesModified}`);
      console.log(`   删除规则数量: ${cleanResult.rulesRemoved}`);

      await exportResultsForGitHub(deadDomains, cleanResult);
    } else {
      console.log(picocolors.yellow('\n⚠️  仅检测模式，不会删除失效域名'));
      console.log(picocolors.yellow('💡 添加 --apply 或 --fix 参数启用自动删除'));

      await exportResultsForGitHub(deadDomains, {
        totalChecked: domainLocations.size,
        deadDomainsFound: deadDomains.length,
        filesModified: 0,
        rulesRemoved: 0,
      });
    }

    // 输出详细的死域名列表到终端（用于GitHub Actions）
    console.log(JSON.stringify(deadDomains, null, 2));
  } finally {
    // 关闭 DNS 缓存数据库连接
    closeDnsCache();
  }
}

// 执行主函数
main().catch(error => {
  console.error(picocolors.red('💥 域名检测失败:'), error);
  process.exit(1);
});

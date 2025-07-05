/**
 * 域名活性检测脚本
 * 通过 DNS 解析检查域名是否存活
 */

import { readFile, writeFile } from 'fs/promises';
import { glob } from 'glob';
import { Resolver } from 'dns/promises';
import { isIPv4, isIPv6 } from 'node:net';

// DNS 解析器配置
const resolver = new Resolver();
resolver.setServers([
  '8.8.8.8', // Google DNS
  '1.1.1.1', // Cloudflare DNS
  '114.114.114.114', // 中国电信
  '223.5.5.5', // 阿里 DNS
]);

// 并发控制
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '64', 10);

// 要检查的规则文件模式
const RULE_PATTERNS = [
  'Surge/Rulesets/**/*.list',
  'Surge/domainset/**/*.conf',
  'Chores/ruleset/**/*.list',
];

// 排除的域名模式（这些通常是内部域名或特殊用途）
const EXCLUDE_PATTERNS = [
  /^localhost$/i,
  /\.local$/i,
  /\.localdomain$/i,
  /\.internal$/i,
  /\.invalid$/i,
  /\.test$/i,
  /\.example$/i,
  /\.onion$/i,
  /\.i2p$/i,
];

interface DomainCheckResult {
  domain: string;
  isAlive: boolean;
  checkMethod: 'dns' | 'excluded';
  reason?: string;
  dnsRecords?: {
    A?: string[];
    AAAA?: string[];
    CNAME?: string[];
    NS?: string[];
  };
}

interface FileCheckResult {
  file: string;
  totalDomains: number;
  deadDomains: Array<{
    domain: string;
    line: number;
    reason: string;
  }>;
}

/**
 * 检查域名是否存活
 */
async function checkDomainAlive(domain: string): Promise<DomainCheckResult> {
  // 检查是否应该排除
  if (EXCLUDE_PATTERNS.some(pattern => pattern.test(domain))) {
    return {
      domain,
      isAlive: true,
      checkMethod: 'excluded',
      reason: '排除的域名模式',
    };
  }

  // 尝试 DNS 解析
  try {
    const dnsRecords: DomainCheckResult['dnsRecords'] = {};
    const dnsPromises = [];

    // 并行查询多种 DNS 记录
    dnsPromises.push(
      resolver
        .resolve4(domain)
        .then(records => {
          dnsRecords.A = records;
        })
        .catch(() => {})
    );
    dnsPromises.push(
      resolver
        .resolve6(domain)
        .then(records => {
          dnsRecords.AAAA = records;
        })
        .catch(() => {})
    );
    dnsPromises.push(
      resolver
        .resolveCname(domain)
        .then(records => {
          dnsRecords.CNAME = records;
        })
        .catch(() => {})
    );
    dnsPromises.push(
      resolver
        .resolveNs(domain)
        .then(records => {
          dnsRecords.NS = records;
        })
        .catch(() => {})
    );

    await Promise.all(dnsPromises);

    // 如果有任何 DNS 记录，认为域名存活
    const hasRecords = Object.values(dnsRecords).some(records => records && records.length > 0);

    if (hasRecords) {
      return {
        domain,
        isAlive: true,
        checkMethod: 'dns',
        dnsRecords,
      };
    }

    // 没有任何 DNS 记录，认为域名死亡
    return {
      domain,
      isAlive: false,
      checkMethod: 'dns',
      reason: '没有找到任何 DNS 记录',
    };
  } catch (dnsError) {
    // DNS 解析失败
    return {
      domain,
      isAlive: false,
      checkMethod: 'dns',
      reason: `DNS 解析失败: ${dnsError}`,
    };
  }
}

/**
 * 批量检查域名，带并发控制
 */
async function checkDomainsWithConcurrency(
  domains: Array<{ domain: string; line: number }>,
  concurrency: number
): Promise<Map<string, DomainCheckResult>> {
  const results = new Map<string, DomainCheckResult>();
  const queue = [...domains];
  const inProgress = new Set<Promise<void>>();

  while (queue.length > 0 || inProgress.size > 0) {
    // 填充并发队列
    while (inProgress.size < concurrency && queue.length > 0) {
      const { domain } = queue.shift()!;

      // 跳过已检查的域名
      if (results.has(domain)) continue;

      const promise = checkDomainAlive(domain)
        .then(result => {
          results.set(domain, result);
        })
        .catch(error => {
          results.set(domain, {
            domain,
            isAlive: false,
            checkMethod: 'dns',
            reason: `检查失败: ${error}`,
          });
        })
        .finally(() => {
          inProgress.delete(promise);
        });

      inProgress.add(promise);
    }

    // 等待至少一个任务完成
    if (inProgress.size > 0) {
      await Promise.race(inProgress);
    }

    // 显示进度
    if (results.size % 100 === 0 && results.size > 0) {
      console.log(`  已检查 ${results.size} 个域名...`);
    }
  }

  return results;
}

/**
 * 从文件中提取域名
 */
async function extractDomainsFromFile(
  filePath: string
): Promise<Array<{ domain: string; line: number }>> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const domains: Array<{ domain: string; line: number }> = [];
  const seenDomains = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 跳过空行和注释
    if (!line || line.startsWith('#')) continue;

    let domain: string | null = null;

    // 提取域名
    if (line.includes('DOMAIN-SUFFIX,')) {
      domain = line.split(',')[1];
    } else if (line.includes('DOMAIN,')) {
      domain = line.split(',')[1];
    } else if (line.startsWith('.')) {
      // domainset 格式
      domain = line.substring(1);
    } else if (!line.includes(',') && line.includes('.')) {
      // 纯域名格式
      domain = line;
    }

    if (domain) {
      domain = domain.split('#')[0].trim().toLowerCase();

      // 跳过 IP 地址
      if (isIPv4(domain) || isIPv6(domain)) continue;

      // 跳过已见过的域名
      if (seenDomains.has(domain)) continue;

      seenDomains.add(domain);
      domains.push({ domain, line: i + 1 });
    }
  }

  return domains;
}

/**
 * 检查单个文件
 */
async function checkFile(
  filePath: string,
  domainResults: Map<string, DomainCheckResult>
): Promise<FileCheckResult> {
  const domains = await extractDomainsFromFile(filePath);
  const deadDomains: FileCheckResult['deadDomains'] = [];

  for (const { domain, line } of domains) {
    const result = domainResults.get(domain);

    if (result && !result.isAlive) {
      deadDomains.push({
        domain,
        line,
        reason: result.reason || '域名不可达',
      });
    }
  }

  return {
    file: filePath,
    totalDomains: domains.length,
    deadDomains,
  };
}

/**
 * 移除死亡域名
 */
async function removeDeadDomains(
  filePath: string,
  deadDomains: Array<{ line: number }>
): Promise<void> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const linesToRemove = new Set(deadDomains.map(d => d.line - 1));

  const filteredLines = lines.filter((_, index) => !linesToRemove.has(index));
  await writeFile(filePath, filteredLines.join('\n'));
}

/**
 * 主函数
 */
async function main() {
  const shouldFix = process.argv.includes('--fix');

  console.log('🔍 开始域名活性检测...');
  console.log(`📊 并发数: ${CONCURRENCY}`);
  console.log(`🔧 修复模式: ${shouldFix ? '开启' : '关闭'}`);

  // 收集所有文件
  const allFiles: string[] = [];
  for (const pattern of RULE_PATTERNS) {
    const files = await glob(pattern);
    allFiles.push(...files);
  }

  console.log(`\n找到 ${allFiles.length} 个规则文件`);

  // 收集所有唯一域名
  console.log('\n收集域名中...');
  const allDomains: Array<{ domain: string; line: number }> = [];
  const uniqueDomains = new Set<string>();

  for (const file of allFiles) {
    try {
      const domains = await extractDomainsFromFile(file);
      for (const domain of domains) {
        if (!uniqueDomains.has(domain.domain)) {
          uniqueDomains.add(domain.domain);
          allDomains.push(domain);
        }
      }
    } catch (error) {
      console.error(`读取文件失败 ${file}:`, error);
    }
  }

  console.log(`共找到 ${uniqueDomains.size} 个唯一域名`);

  // 批量检查域名活性
  console.log('\n开始检查域名活性...');
  const startTime = Date.now();
  const domainResults = await checkDomainsWithConcurrency(allDomains, CONCURRENCY);
  const endTime = Date.now();

  const deadCount = Array.from(domainResults.values()).filter(r => !r.isAlive).length;
  const aliveCount = domainResults.size - deadCount;

  console.log(`\n检查完成！用时: ${((endTime - startTime) / 1000).toFixed(2)} 秒`);
  console.log(`  - 存活域名: ${aliveCount}`);
  console.log(`  - 死亡域名: ${deadCount}`);

  // 处理每个文件
  const fileResults: FileCheckResult[] = [];
  let totalDeadDomainsInFiles = 0;

  console.log('\n处理文件中...');
  for (const file of allFiles) {
    try {
      const result = await checkFile(file, domainResults);
      fileResults.push(result);

      if (result.deadDomains.length > 0) {
        console.log(`\n${file}:`);
        console.log(`  - 死亡域名: ${result.deadDomains.length}/${result.totalDomains}`);

        if (shouldFix) {
          await removeDeadDomains(file, result.deadDomains);
          console.log('  ✅ 已移除死亡域名');
        }

        totalDeadDomainsInFiles += result.deadDomains.length;
      }
    } catch (error) {
      console.error(`处理文件失败 ${file}:`, error);
    }
  }

  // 保存死亡域名列表
  const deadDomainsList = Array.from(domainResults.entries())
    .filter(([_, result]) => !result.isAlive)
    .map(([domain, result]) => ({
      domain,
      reason: result.reason,
    }));

  await writeFile('.cache/dead-domains.json', JSON.stringify(deadDomainsList, null, 2));

  // 生成详细报告
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalFiles: allFiles.length,
      totalUniqueDomains: uniqueDomains.size,
      aliveDomains: aliveCount,
      deadDomains: deadCount,
      deadPercentage: ((deadCount / uniqueDomains.size) * 100).toFixed(2),
      checkDuration: ((endTime - startTime) / 1000).toFixed(2) + ' seconds',
      concurrency: CONCURRENCY,
    },
    fileResults: fileResults
      .filter(r => r.deadDomains.length > 0)
      .map(r => ({
        file: r.file,
        totalDomains: r.totalDomains,
        deadCount: r.deadDomains.length,
        deadDomains: r.deadDomains.slice(0, 10), // 只保存前 10 个
      })),
    deadDomains: deadDomainsList.slice(0, 100), // 只保存前 100 个
  };

  await writeFile('.cache/domain-alive-report.json', JSON.stringify(report, null, 2));

  // 最终统计
  console.log('\n📊 最终统计:');
  console.log(`  - 检查文件: ${allFiles.length} 个`);
  console.log(`  - 唯一域名: ${uniqueDomains.size} 个`);
  console.log(
    `  - 存活域名: ${aliveCount} 个 (${((aliveCount / uniqueDomains.size) * 100).toFixed(2)}%)`
  );
  console.log(
    `  - 死亡域名: ${deadCount} 个 (${((deadCount / uniqueDomains.size) * 100).toFixed(2)}%)`
  );
  console.log(`  - 检查用时: ${((endTime - startTime) / 1000).toFixed(2)} 秒`);
  console.log(
    `  - 平均速度: ${(uniqueDomains.size / ((endTime - startTime) / 1000)).toFixed(2)} 域名/秒`
  );

  if (shouldFix) {
    console.log(`\n✅ 已从文件中移除 ${totalDeadDomainsInFiles} 个死亡域名`);
  } else {
    console.log(`\n💡 使用 --fix 参数可自动移除死亡域名`);
  }
}

// 执行主函数
main().catch(error => {
  console.error('💥 域名活性检测失败:', error);
  process.exit(1);
});

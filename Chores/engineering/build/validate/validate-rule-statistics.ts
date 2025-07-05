import { readFile, writeFile } from 'fs/promises';
import { glob } from 'glob';
import tldts from 'tldts';

// 要分析的规则集路径
const RULE_PATHS = [
  'Surge/Rulesets/**/*.list',
  'Surge/domainset/**/*.conf',
  'Chores/ruleset/**/*.list',
];

interface RuleStats {
  file: string;
  totalRules: number;
  ruleTypes: Record<string, number>;
  tldDistribution: Record<string, number>;
  subdomainDepth: Record<number, number>;
  ipRules: {
    ipv4: number;
    ipv6: number;
  };
  keywordRules: number;
  topDomains: Array<{ domain: string; count: number }>;
}

interface GlobalStats {
  totalFiles: number;
  totalRules: number;
  ruleTypeDistribution: Record<string, number>;
  globalTldDistribution: Record<string, number>;
  topTlds: Array<{ tld: string; count: number; percentage: number }>;
  avgRulesPerFile: number;
  largestFiles: Array<{ file: string; ruleCount: number }>;
  duplicateRules: number;
}

async function analyzeRuleFile(filePath: string): Promise<RuleStats> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));

  const stats: RuleStats = {
    file: filePath,
    totalRules: lines.length,
    ruleTypes: {},
    tldDistribution: {},
    subdomainDepth: {},
    ipRules: { ipv4: 0, ipv6: 0 },
    keywordRules: 0,
    topDomains: [],
  };

  const domainCounts = new Map<string, number>();

  for (const line of lines) {
    // 分析规则类型
    if (line.includes('DOMAIN-SUFFIX,')) {
      stats.ruleTypes['DOMAIN-SUFFIX'] = (stats.ruleTypes['DOMAIN-SUFFIX'] || 0) + 1;
      const domain = line.split(',')[1].trim();
      analyzeDomain(domain, stats, domainCounts);
    } else if (line.includes('DOMAIN,')) {
      stats.ruleTypes['DOMAIN'] = (stats.ruleTypes['DOMAIN'] || 0) + 1;
      const domain = line.split(',')[1].trim();
      analyzeDomain(domain, stats, domainCounts);
    } else if (line.includes('DOMAIN-KEYWORD,')) {
      stats.ruleTypes['DOMAIN-KEYWORD'] = (stats.ruleTypes['DOMAIN-KEYWORD'] || 0) + 1;
      stats.keywordRules++;
    } else if (line.includes('IP-CIDR,')) {
      stats.ruleTypes['IP-CIDR'] = (stats.ruleTypes['IP-CIDR'] || 0) + 1;
      if (line.includes(':')) {
        stats.ipRules.ipv6++;
      } else {
        stats.ipRules.ipv4++;
      }
    } else if (line.includes('IP-CIDR6,')) {
      stats.ruleTypes['IP-CIDR6'] = (stats.ruleTypes['IP-CIDR6'] || 0) + 1;
      stats.ipRules.ipv6++;
    } else if (line.includes('IP-ASN,')) {
      stats.ruleTypes['IP-ASN'] = (stats.ruleTypes['IP-ASN'] || 0) + 1;
    } else if (line.includes('GEOIP,')) {
      stats.ruleTypes['GEOIP'] = (stats.ruleTypes['GEOIP'] || 0) + 1;
    } else if (line.includes('USER-AGENT,')) {
      stats.ruleTypes['USER-AGENT'] = (stats.ruleTypes['USER-AGENT'] || 0) + 1;
    } else if (line.includes('URL-REGEX,')) {
      stats.ruleTypes['URL-REGEX'] = (stats.ruleTypes['URL-REGEX'] || 0) + 1;
    } else if (line.startsWith('.') || (!line.includes(',') && line.includes('.'))) {
      // domainset 格式或纯域名
      stats.ruleTypes['DOMAIN'] = (stats.ruleTypes['DOMAIN'] || 0) + 1;
      const domain = line.startsWith('.') ? line.substring(1) : line;
      analyzeDomain(domain, stats, domainCounts);
    }
  }

  // 获取 Top 10 域名
  const sortedDomains = Array.from(domainCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  stats.topDomains = sortedDomains.map(([domain, count]) => ({ domain, count }));

  return stats;
}

function analyzeDomain(domain: string, stats: RuleStats, domainCounts: Map<string, number>): void {
  // 统计域名出现次数
  domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);

  // 分析 TLD
  try {
    const parsed = tldts.parse(domain);
    if (parsed.publicSuffix) {
      stats.tldDistribution[parsed.publicSuffix] =
        (stats.tldDistribution[parsed.publicSuffix] || 0) + 1;
    }
  } catch (error) {
    // 无法解析的域名
  }

  // 分析子域名深度
  const parts = domain.split('.');
  const depth = parts.length;
  stats.subdomainDepth[depth] = (stats.subdomainDepth[depth] || 0) + 1;
}

async function generateGlobalStats(fileStats: RuleStats[]): Promise<GlobalStats> {
  const globalTldCount: Record<string, number> = {};
  const globalRuleTypes: Record<string, number> = {};
  const allRules = new Set<string>();
  let totalRules = 0;

  // 聚合所有文件的统计数据
  for (const stats of fileStats) {
    totalRules += stats.totalRules;

    // 聚合规则类型
    for (const [type, count] of Object.entries(stats.ruleTypes)) {
      globalRuleTypes[type] = (globalRuleTypes[type] || 0) + count;
    }

    // 聚合 TLD 分布
    for (const [tld, count] of Object.entries(stats.tldDistribution)) {
      globalTldCount[tld] = (globalTldCount[tld] || 0) + count;
    }
  }

  // 计算 Top TLD
  const totalDomainRules = Object.values(globalTldCount).reduce((sum, count) => sum + count, 0);
  const topTlds = Object.entries(globalTldCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tld, count]) => ({
      tld,
      count,
      percentage: (count / totalDomainRules) * 100,
    }));

  // 找出最大的文件
  const largestFiles = fileStats
    .sort((a, b) => b.totalRules - a.totalRules)
    .slice(0, 10)
    .map(stats => ({
      file: stats.file,
      ruleCount: stats.totalRules,
    }));

  return {
    totalFiles: fileStats.length,
    totalRules,
    ruleTypeDistribution: globalRuleTypes,
    globalTldDistribution: globalTldCount,
    topTlds,
    avgRulesPerFile: Math.round(totalRules / fileStats.length),
    largestFiles,
    duplicateRules: 0, // TODO: 实现重复规则检测
  };
}

function generateMarkdownReport(globalStats: GlobalStats, fileStats: RuleStats[]): string {
  let report = '# 规则集统计分析报告\n\n';
  report += `生成时间: ${new Date().toISOString()}\n\n`;

  // 总体统计
  report += '## 总体统计\n\n';
  report += `- **文件总数**: ${globalStats.totalFiles}\n`;
  report += `- **规则总数**: ${globalStats.totalRules.toLocaleString()}\n`;
  report += `- **平均每文件规则数**: ${globalStats.avgRulesPerFile.toLocaleString()}\n\n`;

  // 规则类型分布
  report += '## 规则类型分布\n\n';
  report += '| 规则类型 | 数量 | 占比 |\n';
  report += '|---------|------|------|\n';

  const sortedTypes = Object.entries(globalStats.ruleTypeDistribution).sort((a, b) => b[1] - a[1]);

  for (const [type, count] of sortedTypes) {
    const percentage = ((count / globalStats.totalRules) * 100).toFixed(2);
    report += `| ${type} | ${count.toLocaleString()} | ${percentage}% |\n`;
  }

  // Top TLD 分布
  report += '\n## Top 20 TLD 分布\n\n';
  report += '| TLD | 数量 | 占比 |\n';
  report += '|-----|------|------|\n';

  for (const { tld, count, percentage } of globalStats.topTlds) {
    report += `| .${tld} | ${count.toLocaleString()} | ${percentage.toFixed(2)}% |\n`;
  }

  // 最大的文件
  report += '\n## 最大的规则文件 (Top 10)\n\n';
  report += '| 文件 | 规则数 |\n';
  report += '|------|--------|\n';

  for (const { file, ruleCount } of globalStats.largestFiles) {
    const fileName = file.split('/').pop();
    report += `| ${fileName} | ${ruleCount.toLocaleString()} |\n`;
  }

  // 特殊统计
  report += '\n## 特殊统计\n\n';

  // IP 规则统计
  const totalIpv4 = fileStats.reduce((sum, s) => sum + s.ipRules.ipv4, 0);
  const totalIpv6 = fileStats.reduce((sum, s) => sum + s.ipRules.ipv6, 0);
  const totalKeywords = fileStats.reduce((sum, s) => sum + s.keywordRules, 0);

  report += `- **IPv4 规则**: ${totalIpv4.toLocaleString()}\n`;
  report += `- **IPv6 规则**: ${totalIpv6.toLocaleString()}\n`;
  report += `- **关键词规则**: ${totalKeywords.toLocaleString()}\n`;

  return report;
}

async function main() {
  console.log('📊 开始规则集统计分析...');

  // 收集所有文件
  const allFiles: string[] = [];
  for (const pattern of RULE_PATHS) {
    const files = await glob(pattern);
    allFiles.push(...files);
  }

  console.log(`找到 ${allFiles.length} 个规则文件`);

  // 分析每个文件
  const fileStats: RuleStats[] = [];
  let processed = 0;

  for (const file of allFiles) {
    try {
      const stats = await analyzeRuleFile(file);
      fileStats.push(stats);
      processed++;

      if (processed % 10 === 0) {
        console.log(`已处理 ${processed}/${allFiles.length} 个文件...`);
      }
    } catch (error) {
      console.error(`处理文件失败 ${file}:`, error);
    }
  }

  // 生成全局统计
  console.log('\n生成全局统计...');
  const globalStats = await generateGlobalStats(fileStats);

  // 显示关键统计
  console.log('\n📈 关键统计:');
  console.log(`  - 文件总数: ${globalStats.totalFiles}`);
  console.log(`  - 规则总数: ${globalStats.totalRules.toLocaleString()}`);
  console.log(`  - 平均每文件: ${globalStats.avgRulesPerFile.toLocaleString()} 条规则`);
  console.log(
    `  - 顶级 TLD: ${globalStats.topTlds
      .slice(0, 5)
      .map(t => `.${t.tld}`)
      .join(', ')}`
  );

  // 生成报告
  const markdownReport = generateMarkdownReport(globalStats, fileStats);
  await writeFile('.cache/rule-statistics-report.md', markdownReport);

  // 保存 JSON 数据
  await writeFile(
    '.cache/rule-statistics.json',
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        globalStats,
        fileStats: fileStats.map(s => ({
          file: s.file,
          totalRules: s.totalRules,
          ruleTypes: s.ruleTypes,
          topTlds: Object.entries(s.tldDistribution)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([tld, count]) => ({ tld, count })),
        })),
      },
      null,
      2
    )
  );

  console.log('\n✅ 统计分析完成！');
  console.log('📄 报告已保存到:');
  console.log('  - .cache/rule-statistics-report.md (Markdown 报告)');
  console.log('  - .cache/rule-statistics.json (详细数据)');
}

main().catch(console.error);

import { HostnameTrie } from './lib/trie.js';
import { optimizeCidrList } from './lib/cidr-optimizer.js';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { glob } from 'glob';

// 要优化的规则集路径
const RULE_PATHS = ['Surge/Rulesets/**/*.list', 'Chores/ruleset/**/*.list'];

// 要应用 Trie 优化的文件模式
const TRIE_OPTIMIZE_PATTERNS = [
  '**/reject*.list',
  '**/block*.list',
  '**/ad*.list',
  '**/domestic*.list',
  '**/global*.list',
  '**/proxy*.list',
];

// 要应用 CIDR 优化的文件模式
const CIDR_OPTIMIZE_PATTERNS = [
  '**/*ip*.list',
  '**/china*.list',
  '**/lan*.list',
  '**/telegram*.list',
];

interface OptimizationResult {
  file: string;
  originalRules: number;
  optimizedRules: number;
  reduction: number;
  type: 'trie' | 'cidr' | 'both';
}

async function optimizeRuleFile(filePath: string): Promise<OptimizationResult | null> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));

  const originalCount = lines.length;
  let optimizedLines: string[] = [];
  let optimizationType: 'trie' | 'cidr' | 'both' | null = null;

  // 判断文件类型
  const hasDomainRules = lines.some(
    line => line.includes('DOMAIN') || (line.includes('.') && !line.includes('/'))
  );
  const hasIPRules = lines.some(
    line => line.includes('IP-CIDR') || line.includes('/') || line.includes('IP-ASN')
  );

  // 应用 Trie 优化
  if (hasDomainRules && shouldApplyTrieOptimization(filePath)) {
    const domainTrie = new HostnameTrie<any>();
    const nonDomainRules: string[] = [];

    for (const line of lines) {
      if (line.includes('DOMAIN-SUFFIX,')) {
        const domain = line.split(',')[1];
        domainTrie.add(domain, true);
      } else if (line.includes('DOMAIN,')) {
        const domain = line.split(',')[1];
        domainTrie.add(domain, false);
      } else {
        nonDomainRules.push(line);
      }
    }

    // 导出优化后的域名规则
    const optimizedDomains: string[] = [];
    domainTrie.dump().forEach((domain: string) => {
      // 如果域名以点开头，说明是 DOMAIN-SUFFIX
      if (domain.startsWith('.')) {
        optimizedDomains.push(`DOMAIN-SUFFIX,${domain.substring(1)}`);
      } else {
        optimizedDomains.push(`DOMAIN,${domain}`);
      }
    });

    optimizedLines = [...optimizedDomains, ...nonDomainRules];
    optimizationType = 'trie';
  }

  // 应用 CIDR 优化
  if (hasIPRules && shouldApplyCIDROptimization(filePath)) {
    const ipv4Rules: string[] = [];
    const ipv6Rules: string[] = [];
    const otherRules: string[] = [];

    const rulesToProcess = optimizedLines.length > 0 ? optimizedLines : lines;

    for (const line of rulesToProcess) {
      if (line.includes('IP-CIDR,') && !line.includes(':')) {
        const cidr = line.split(',')[1];
        ipv4Rules.push(cidr);
      } else if (line.includes('IP-CIDR6,') || (line.includes('IP-CIDR,') && line.includes(':'))) {
        const cidr = line.split(',')[1];
        ipv6Rules.push(cidr);
      } else {
        otherRules.push(line);
      }
    }

    // 优化 IP 段 - 合并 IPv4 和 IPv6
    const allCidrs = [...ipv4Rules, ...ipv6Rules];
    const result = optimizeCidrList(allCidrs);

    optimizedLines = [
      ...result.ipv4.map((cidr: string) => `IP-CIDR,${cidr}`),
      ...result.ipv6.map((cidr: string) => `IP-CIDR6,${cidr}`),
      ...otherRules,
    ];

    optimizationType = optimizationType === 'trie' ? 'both' : 'cidr';
  }

  // 如果没有优化，返回 null
  if (optimizedLines.length === 0) {
    return null;
  }

  // 保留原始文件的注释和头部
  const originalContent = await readFile(filePath, 'utf-8');
  const headerLines = originalContent.split('\n').filter(line => line.startsWith('#'));

  // 写回文件
  const finalContent = [...headerLines, ...optimizedLines].join('\n');
  await writeFile(filePath, finalContent);

  return {
    file: filePath,
    originalRules: originalCount,
    optimizedRules: optimizedLines.length,
    reduction: originalCount - optimizedLines.length,
    type: optimizationType!,
  };
}

function shouldApplyTrieOptimization(filePath: string): boolean {
  return TRIE_OPTIMIZE_PATTERNS.some(pattern =>
    filePath.includes(pattern.replace('**/', '').replace('*.list', ''))
  );
}

function shouldApplyCIDROptimization(filePath: string): boolean {
  return CIDR_OPTIMIZE_PATTERNS.some(pattern =>
    filePath.includes(pattern.replace('**/', '').replace('*.list', ''))
  );
}

async function main() {
  console.log('🚀 开始规则优化...');

  const results: OptimizationResult[] = [];

  for (const pattern of RULE_PATHS) {
    const files = await glob(pattern);

    for (const file of files) {
      try {
        const result = await optimizeRuleFile(file);
        if (result) {
          results.push(result);
          console.log(
            `✅ 优化 ${result.file}: ${result.originalRules} → ${result.optimizedRules} (减少 ${result.reduction} 条)`
          );
        }
      } catch (error) {
        console.error(`❌ 优化失败 ${file}:`, error);
      }
    }
  }

  // 生成报告
  const totalOriginal = results.reduce((sum, r) => sum + r.originalRules, 0);
  const totalOptimized = results.reduce((sum, r) => sum + r.optimizedRules, 0);
  const totalReduction = results.reduce((sum, r) => sum + r.reduction, 0);

  console.log('\n📊 优化统计:');
  console.log(`  - 优化文件数: ${results.length}`);
  console.log(`  - 原始规则数: ${totalOriginal}`);
  console.log(`  - 优化后规则数: ${totalOptimized}`);
  console.log(
    `  - 减少规则数: ${totalReduction} (${((totalReduction / totalOriginal) * 100).toFixed(2)}%)`
  );

  // 保存报告
  await writeFile(
    '.cache/optimization-report.json',
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        results,
        summary: {
          filesOptimized: results.length,
          originalRules: totalOriginal,
          optimizedRules: totalOptimized,
          reduction: totalReduction,
          reductionPercentage: ((totalReduction / totalOriginal) * 100).toFixed(2),
        },
      },
      null,
      2
    )
  );
}

main().catch(console.error);

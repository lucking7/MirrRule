import { readFile, writeFile } from 'fs/promises';
import tldts from 'tldts';
import { HostnameTrie } from '../lib/trie.js';

// 中国备案的 TLD（ICP TLD）
const ICP_TLD = [
  'cn',
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'edu.cn',
  'ac.cn',
  'mil.cn',
  'ah.cn',
  'bj.cn',
  'cq.cn',
  'fj.cn',
  'gd.cn',
  'gs.cn',
  'gz.cn',
  'gx.cn',
  'ha.cn',
  'hb.cn',
  'he.cn',
  'hi.cn',
  'hl.cn',
  'hn.cn',
  'jl.cn',
  'js.cn',
  'jx.cn',
  'ln.cn',
  'nm.cn',
  'nx.cn',
  'qh.cn',
  'sc.cn',
  'sd.cn',
  'sh.cn',
  'sn.cn',
  'sx.cn',
  'tj.cn',
  'xj.cn',
  'xz.cn',
  'yn.cn',
  'zj.cn',
];

// 要验证的全球规则集文件
const GLOBAL_RULESETS = [
  'Surge/Rulesets/global.list',
  'Surge/Rulesets/proxy/global.list',
  'Surge/Rulesets/proxy/proxy.list',
  'Surge/Rulesets/proxy/proxy_plus.list',
];

interface TldValidationResult {
  file: string;
  domesticTlds: Array<{
    domain: string;
    tld: string;
    line: number;
  }>;
  invalidTlds: Array<{
    domain: string;
    tld: string;
    line: number;
    reason: string;
  }>;
  stats: {
    totalDomains: number;
    uniqueTlds: Set<string>;
    domesticCount: number;
    invalidCount: number;
  };
}

async function extractDomainsFromFile(
  filePath: string
): Promise<Array<{ domain: string; line: number }>> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const domains: Array<{ domain: string; line: number }> = [];

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
    } else if (!line.includes(',') && line.includes('.')) {
      // 纯域名格式
      domain = line;
    }

    if (domain) {
      domain = domain.split('#')[0].trim();
      domains.push({ domain, line: i + 1 });
    }
  }

  return domains;
}

async function validateGlobalRuleset(filePath: string): Promise<TldValidationResult> {
  const domains = await extractDomainsFromFile(filePath);
  const domesticTlds: TldValidationResult['domesticTlds'] = [];
  const invalidTlds: TldValidationResult['invalidTlds'] = [];
  const uniqueTlds = new Set<string>();

  for (const { domain, line } of domains) {
    try {
      const parsed = tldts.parse(domain, {
        allowPrivateDomains: false,
        extractHostname: true,
      });

      if (!parsed.publicSuffix) {
        invalidTlds.push({
          domain,
          tld: 'N/A',
          line,
          reason: '无法识别的 TLD',
        });
        continue;
      }

      uniqueTlds.add(parsed.publicSuffix);

      // 检查是否为中国备案 TLD
      if (ICP_TLD.includes(parsed.publicSuffix)) {
        domesticTlds.push({
          domain,
          tld: parsed.publicSuffix,
          line,
        });
      }

      // 检查是否为非 ICANN 认证
      if (!parsed.isIcann) {
        invalidTlds.push({
          domain,
          tld: parsed.publicSuffix,
          line,
          reason: '非 ICANN 认证的 TLD',
        });
      }
    } catch (error) {
      invalidTlds.push({
        domain,
        tld: 'ERROR',
        line,
        reason: `解析错误: ${error}`,
      });
    }
  }

  return {
    file: filePath,
    domesticTlds,
    invalidTlds,
    stats: {
      totalDomains: domains.length,
      uniqueTlds,
      domesticCount: domesticTlds.length,
      invalidCount: invalidTlds.length,
    },
  };
}

async function generateTldTree(results: TldValidationResult[]): Promise<HostnameTrie<string>> {
  const trie = new HostnameTrie<string>();
  const extraWhiteTlds = new Set<string>();

  // 收集所有唯一的 TLD
  for (const result of results) {
    for (const tld of result.stats.uniqueTlds) {
      extraWhiteTlds.add(tld);
    }
  }

  // 添加到 Trie 树（用于演示）
  for (const tld of extraWhiteTlds) {
    trie.add(tld, true, 'global');
  }

  // 白名单中国 TLD
  for (const tld of ICP_TLD) {
    trie.whitelist(tld, true);
  }

  return trie;
}

async function main() {
  console.log('🌐 开始验证全球规则集 TLD...');

  const results: TldValidationResult[] = [];
  let totalDomestic = 0;
  let totalInvalid = 0;

  for (const file of GLOBAL_RULESETS) {
    try {
      console.log(`\n检查文件: ${file}`);
      const result = await validateGlobalRuleset(file);
      results.push(result);

      console.log(`  - 总域名数: ${result.stats.totalDomains}`);
      console.log(`  - 唯一 TLD 数: ${result.stats.uniqueTlds.size}`);

      if (result.domesticTlds.length > 0) {
        console.log(`  ⚠️  发现 ${result.domesticTlds.length} 个中国备案域名`);
        // 显示前 5 个
        result.domesticTlds.slice(0, 5).forEach(item => {
          console.log(`    - 行 ${item.line}: ${item.domain} (.${item.tld})`);
        });
        if (result.domesticTlds.length > 5) {
          console.log(`    ... 还有 ${result.domesticTlds.length - 5} 个`);
        }
      }

      if (result.invalidTlds.length > 0) {
        console.log(`  ❌ 发现 ${result.invalidTlds.length} 个无效 TLD`);
        result.invalidTlds.slice(0, 5).forEach(item => {
          console.log(`    - 行 ${item.line}: ${item.domain} (${item.reason})`);
        });
        if (result.invalidTlds.length > 5) {
          console.log(`    ... 还有 ${result.invalidTlds.length - 5} 个`);
        }
      }

      if (result.domesticTlds.length === 0 && result.invalidTlds.length === 0) {
        console.log('  ✅ TLD 验证通过');
      }

      totalDomestic += result.domesticTlds.length;
      totalInvalid += result.invalidTlds.length;
    } catch (error) {
      console.error(`❌ 处理文件失败 ${file}:`, error);
    }
  }

  // 生成 TLD 统计
  const allTlds = new Set<string>();
  results.forEach(r => r.stats.uniqueTlds.forEach(tld => allTlds.add(tld)));

  console.log('\n📊 TLD 统计:');
  console.log(`  - 检查文件数: ${results.length}`);
  console.log(`  - 唯一 TLD 总数: ${allTlds.size}`);
  console.log(`  - 中国备案域名: ${totalDomestic} 个`);
  console.log(`  - 无效 TLD: ${totalInvalid} 个`);

  // 生成 TLD Trie 树并输出
  const trie = await generateTldTree(results);
  const tldList = trie.dump();

  console.log(`\n📝 TLD 树包含 ${tldList.length} 个条目`);

  // 保存验证报告
  await writeFile(
    '.cache/global-tld-validation.json',
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        results: results.map(r => ({
          file: r.file,
          stats: {
            totalDomains: r.stats.totalDomains,
            uniqueTlds: r.stats.uniqueTlds.size,
            domesticCount: r.stats.domesticCount,
            invalidCount: r.stats.invalidCount,
          },
          domesticDomains: r.domesticTlds,
          invalidDomains: r.invalidTlds,
        })),
        summary: {
          totalFiles: results.length,
          totalUniqueTlds: allTlds.size,
          totalDomesticDomains: totalDomestic,
          totalInvalidTlds: totalInvalid,
        },
      },
      null,
      2
    )
  );

  // 如果发现严重问题，返回错误码
  if (totalInvalid > 0) {
    process.exit(1);
  }
}

main().catch(console.error);

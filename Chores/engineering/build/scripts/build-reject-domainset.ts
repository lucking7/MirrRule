import path from 'node:path';
import fs from 'node:fs/promises';
import { createSpan, task } from '../trace/index.js';
import { HostnameSmolTrie } from '../../lib/trie.js';
import { fetchAssets } from '../lib/fetch-assets.js';
import { EnhancedTldValidator, RuleSource } from '../../lib/enhanced-tld-validator.js';
import { readFileIntoProcessedArray } from '../lib/fetch-text-by-line.js';
import { addArrayElementsToSet } from 'foxts/add-array-elements-to-set';
import picocolors from 'picocolors';
import { merge as mergeCidr } from 'fast-cidr-tools';

// 数据源配置
const ADGUARD_FILTERS = [
  // AdGuard Base Filter (includes EasyList)
  {
    url: 'https://filters.adtidy.org/extension/ublock/filters/2_optimized.txt',
    mirrors: [
      'https://proxy.cdn.skk.moe/https/filters.adtidy.org/extension/ublock/filters/2_optimized.txt',
    ],
  },
  // EasyPrivacy
  {
    url: 'https://easylist.to/easylist/easyprivacy.txt',
    mirrors: [
      'https://easylist-downloads.adblockplus.org/easyprivacy.txt',
      'https://filters.adtidy.org/extension/ublock/filters/118_optimized.txt',
    ],
  },
  // AdGuard Chinese filter (EasyList China + AdGuard Chinese filter)
  {
    url: 'https://filters.adtidy.org/extension/ublock/filters/224_optimized.txt',
    mirrors: [
      'https://proxy.cdn.skk.moe/https/filters.adtidy.org/extension/ublock/filters/224_optimized.txt',
    ],
  },
];

// 其他规则源（来自 rule-sources.ts）
const OTHER_RULE_SOURCES = [
  {
    url: 'https://github.com/ConnersHua/RuleGo/raw/master/Surge/Ruleset/Extra/Reject/Advertising.list',
    type: 'surge',
  },
  {
    url: 'https://github.com/ConnersHua/RuleGo/raw/master/Surge/Ruleset/Extra/Reject/Malicious.list',
    type: 'surge',
  },
  {
    url: 'https://github.com/ConnersHua/RuleGo/raw/master/Surge/Ruleset/Extra/Reject/Tracking.list',
    type: 'surge',
  },
  {
    url: 'https://raw.githubusercontent.com/TG-Twilight/AWAvenue-Ads-Rule/main/Filters/AWAvenue-Ads-Rule-Surge.list',
    type: 'surge',
  },
  // 可选的额外源（取消注释启用）
  // {
  //   url: 'https://raw.githubusercontent.com/privacy-protection-tools/anti-AD/master/anti-ad-surge.txt',
  //   type: 'surge',
  // },
  // {
  //   url: 'https://raw.githubusercontent.com/Cats-Team/AdRules/main/adrules.list',
  //   type: 'surge',
  // },
];

// 预定义白名单（参考 surge-master-2）
const PREDEFINED_WHITELIST = new Set([
  // Crash reporting
  'sts.online.visualstudio.com',
  '.ingest.sentry.io',
  '.bugsnag.com',
  '.crashlytics.com',

  // Analytics (whitelisted for compatibility)
  'analytics.google.com',
  '.segment.com',
  '.mixpanel.com',

  // Important services
  '.login.microsoftonline.com',
  'api.xiaomi.com',
  '.t.co',

  // Local domains
  '.localhost',
  '.local',
  '.localdomain',
]);

// 项目根目录（从 build/scripts 目录向上 4 级）
const REPO_PATH = path.resolve(
  import.meta.url.startsWith('file:') ? path.dirname(new URL(import.meta.url).pathname) : __dirname,
  '..',
  '..',
  '..',
  '..'
);
const SOURCE_DIR = path.join(REPO_PATH, 'Surge', 'Rulesets', 'reject');
const OUTPUT_DIR = path.join(REPO_PATH, 'Surge', 'Rulesets', 'reject');

// 简化的 AdGuard 过滤器解析
async function parseAdGuardFilter(content: string): Promise<{
  domains: Set<string>;
  domainSuffixes: Set<string>;
  keywords: Set<string>;
  ips: Set<string>;
}> {
  const result = {
    domains: new Set<string>(),
    domainSuffixes: new Set<string>(),
    keywords: new Set<string>(),
    ips: new Set<string>(),
  };

  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // 跳过注释和空行
    if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('#')) {
      continue;
    }

    // 处理域名规则 ||example.com^
    if (trimmed.startsWith('||') && trimmed.endsWith('^')) {
      const domain = trimmed.slice(2, -1);
      if (!domain.includes('*') && !domain.includes('/')) {
        result.domainSuffixes.add(domain);
      }
    }

    // 处理完整域名规则 |http://example.com
    else if (trimmed.startsWith('|http://') || trimmed.startsWith('|https://')) {
      const match = trimmed.match(/\|https?:\/\/([^\/\^\$]+)/);
      if (match && match[1]) {
        result.domains.add(match[1]);
      }
    }
  }

  return result;
}

// 构建 reject 域名集
export const buildRejectDomainSet = task(
  false,
  import.meta.url
)(async span => {
  console.log(picocolors.bold('🚀 开始构建 Reject 域名集...'));

  // 创建 Trie 树用于域名去重
  const domainTrie = new HostnameSmolTrie();
  const validator = new EnhancedTldValidator();

  // 统计数据
  const stats = {
    totalDomains: 0,
    invalidTlds: 0,
    whitelisted: 0,
    optimized: 0,
    ipRules: 0,
  };

  // 读取本地 block.list
  const blockListPath = path.join(SOURCE_DIR, 'block.list');

  try {
    const localRules = await readFileIntoProcessedArray(blockListPath);
    console.log(`📄 读取本地规则: ${localRules.length} 条`);

    // 处理本地规则
    for await (const line of localRules) {
      const parts = line.split(',');
      const ruleType = parts[0];
      const value = parts[1];

      if (ruleType === 'DOMAIN' || ruleType === 'DOMAIN-SUFFIX') {
        stats.totalDomains++;

        // 检查白名单
        if (PREDEFINED_WHITELIST.has(value)) {
          stats.whitelisted++;
          continue;
        }

        // 验证 TLD（本地文件使用宽松模式）
        const validation = validator.validate(value, { source: RuleSource.LocalFile });
        if (!validation.valid) {
          console.warn(picocolors.yellow(`⚠️  非法 TLD: ${value} (${validation.reason})`));
          stats.invalidTlds++;
        }

        // 添加到 Trie 树
        domainTrie.add(value, ruleType === 'DOMAIN-SUFFIX');
      }
    }
  } catch (error) {
    console.warn(picocolors.yellow('⚠️  无法读取本地 block.list，将创建新文件'));
  }

  // 下载并处理 AdGuard 过滤器
  console.log('\n📥 下载 AdGuard 过滤器...');

  for (const filter of ADGUARD_FILTERS) {
    try {
      const content = await fetchAssets(filter.url, filter.mirrors, true, false);
      const result = await parseAdGuardFilter(content.join('\n'));

      console.log(
        `✅ 处理 ${filter.url.split('/').pop()}: ${
          result.domains.size + result.domainSuffixes.size
        } 个域名`
      );

      // 添加域名到 Trie 树
      for (const domain of result.domains) {
        if (!PREDEFINED_WHITELIST.has(domain)) {
          stats.totalDomains++;
          domainTrie.add(domain, false);
        }
      }

      for (const suffix of result.domainSuffixes) {
        if (!PREDEFINED_WHITELIST.has(suffix)) {
          stats.totalDomains++;
          domainTrie.add(suffix, true);
        }
      }

      stats.ipRules += result.ips.size;
    } catch (error) {
      console.error(picocolors.red(`❌ 下载失败: ${filter.url}`), error);
    }
  }

  // 下载并处理其他 Surge 规则源
  console.log('\n📥 下载其他规则源...');

  for (const source of OTHER_RULE_SOURCES) {
    try {
      const content = await fetchAssets(source.url);
      const lines = content.filter(
        (line: string) => line && !line.startsWith('#') && !line.startsWith('//')
      );

      console.log(`✅ 处理 ${source.url.split('/').pop()}: ${lines.length} 条规则`);

      // 处理 Surge 规则
      for (const line of lines) {
        const parts = line.split(',');
        const ruleType = parts[0];
        const value = parts[1];

        if (ruleType === 'DOMAIN' || ruleType === 'DOMAIN-SUFFIX') {
          // 检查白名单
          if (PREDEFINED_WHITELIST.has(value)) {
            stats.whitelisted++;
            continue;
          }

          // 验证 TLD
          const validation = validator.validate(value, { source: RuleSource.RemoteList });
          if (!validation.valid) {
            console.warn(picocolors.yellow(`⚠️  非法 TLD: ${value} (${validation.reason})`));
            stats.invalidTlds++;
            continue;
          }

          stats.totalDomains++;
          domainTrie.add(value, ruleType === 'DOMAIN-SUFFIX');
        } else if (ruleType === 'IP-CIDR' || ruleType === 'IP-CIDR6') {
          stats.ipRules++;
        }
      }
    } catch (error) {
      console.error(picocolors.red(`❌ 下载失败: ${source.url}`), error);
    }
  }

  // 从 Trie 树导出优化后的域名
  const optimizedDomains: string[] = [];
  const optimizedSuffixes: string[] = [];

  domainTrie.dump((domain: string, isSubdomain: boolean) => {
    if (isSubdomain) {
      optimizedSuffixes.push(domain);
    } else {
      optimizedDomains.push(domain);
    }
  });

  stats.optimized = stats.totalDomains - (optimizedDomains.length + optimizedSuffixes.length);

  // 生成输出文件
  const output: string[] = [
    "# Sukka's Surge Reject Rules - Unified from Multiple Sources",
    '# Sources:',
    '#   - AdGuard Base Filter',
    '#   - EasyPrivacy',
    '#   - AdGuard Chinese filter',
    '#   - ConnersHua RuleGo (Advertising, Malicious, Tracking)',
    '#   - TG-Twilight AWAvenue-Ads-Rule',
    '# License: AGPL 3.0',
    '# Homepage: https://github.com/SukkaW/Surge',
    `# Updated: ${new Date().toISOString()}`,
    '',
    `# Total Domains Processed: ${stats.totalDomains}`,
    `# Whitelisted: ${stats.whitelisted}`,
    `# Invalid TLDs: ${stats.invalidTlds}`,
    `# Optimized (merged): ${stats.optimized}`,
    `# IP Rules: ${stats.ipRules}`,
    '',
  ];

  // 添加域名规则
  for (const domain of optimizedDomains.sort()) {
    output.push(`DOMAIN,${domain}`);
  }

  // 添加域名后缀规则
  for (const suffix of optimizedSuffixes.sort()) {
    output.push(`DOMAIN-SUFFIX,${suffix}`);
  }

  // 写入文件
  const outputPath = path.join(OUTPUT_DIR, 'block.list');
  await fs.writeFile(outputPath, output.join('\n'), 'utf-8');

  // 打印统计信息
  console.log(picocolors.green('\n✅ 构建完成！'));
  console.log(picocolors.cyan('📊 统计信息:'));
  console.log(`  - 处理域名总数: ${stats.totalDomains}`);
  console.log(`  - 白名单过滤: ${stats.whitelisted}`);
  console.log(`  - 非法 TLD: ${stats.invalidTlds}`);
  console.log(`  - 优化合并: ${stats.optimized} 条`);
  console.log(`  - 最终规则数: ${optimizedDomains.length + optimizedSuffixes.length}`);
  console.log(`  - 输出文件: ${outputPath}`);
});

// 如果直接运行此脚本
if (import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const rootSpan = createSpan('build-reject-domainset');
  buildRejectDomainSet(rootSpan).finally(() => {
    rootSpan.stop();
  });
}

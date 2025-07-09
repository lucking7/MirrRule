import path from 'node:path';
import fs from 'node:fs/promises';
import { createSpan, task } from '../trace/index.js';
import { HostnameSmolTrie } from '../../lib/trie.js';
import { fetchAssets } from '../lib/fetch-assets.js';
import { EnhancedTldValidator, RuleSource } from '../../lib/enhanced-tld-validator.js';
import { addArrayElementsToSet } from 'foxts/add-array-elements-to-set';
import picocolors from 'picocolors';
import { merge as mergeCidr } from 'fast-cidr-tools';
import tldts from 'tldts';
import { isProbablyIpv4, isProbablyIpv6 } from 'foxts/is-probably-ip';
import { fastNormalizeDomain, fastNormalizeDomainWithoutWww } from '../../lib/normalize-domain.js';
import { createRetrieKeywordFilter as createKeywordFilter } from 'foxts/retrie';

// 数据源定义（参考 surge-master-2/Build/constants/reject-data-source.ts）
type HostsSource = [
  main: string,
  mirrors: string[] | null,
  includeAllSubDomain: boolean,
  allowEmptyRemote?: boolean
];
type AdGuardFilterSource = [main: string, mirrors: string[] | null, includeThirdParty?: boolean];

// HOSTS 文件源
const HOSTS: HostsSource[] = [
  [
    'https://cdn.jsdelivr.net/gh/jerryn70/GoodbyeAds@master/Extension/GoodbyeAds-Xiaomi-Extension.txt',
    [
      'https://raw.githubusercontent.com/jerryn70/GoodbyeAds/master/Extension/GoodbyeAds-Xiaomi-Extension.txt',
    ],
    false,
  ],
  [
    'https://cdn.jsdelivr.net/gh/jerryn70/GoodbyeAds@master/Extension/GoodbyeAds-Huawei-AdBlock.txt',
    [
      'https://raw.githubusercontent.com/jerryn70/GoodbyeAds/master/Extension/GoodbyeAds-Huawei-AdBlock.txt',
    ],
    false,
  ],
  [
    'https://cdn.jsdelivr.net/gh/jerryn70/GoodbyeAds@master/Extension/GoodbyeAds-Samsung-AdBlock.txt',
    [
      'https://raw.githubusercontent.com/jerryn70/GoodbyeAds/master/Extension/GoodbyeAds-Samsung-AdBlock.txt',
    ],
    false,
  ],
];

const HOSTS_EXTRA: HostsSource[] = [
  [
    'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=0&mimetype=plaintext',
    [
      'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/thirdparties/pgl.yoyo.org/as/serverlist',
    ],
    true,
  ],
  [
    'https://proxy.cdn.skk.moe/https/someonewhocares.org/hosts/zero/hosts',
    ['https://someonewhocares.org/hosts/zero/hosts'],
    true,
  ],
  [
    'https://cdn.jsdelivr.net/gh/hoshsadiq/adblock-nocoin-list@master/hosts.txt',
    ['https://raw.githubusercontent.com/hoshsadiq/adblock-nocoin-list/master/hosts.txt'],
    true,
  ],
];

// 域名列表源
const DOMAIN_LISTS_EXTRA: HostsSource[] = [
  [
    'https://cdn.jsdelivr.net/gh/AdguardTeam/cname-trackers@master/data/combined_disguised_ads_justdomains.txt',
    [
      'https://raw.githubusercontent.com/AdguardTeam/cname-trackers/master/data/combined_disguised_ads_justdomains.txt',
    ],
    true,
  ],
  [
    'https://cdn.jsdelivr.net/gh/AdguardTeam/cname-trackers@master/data/combined_disguised_trackers_justdomains.txt',
    [
      'https://raw.githubusercontent.com/AdguardTeam/cname-trackers/master/data/combined_disguised_trackers_justdomains.txt',
    ],
    true,
  ],
  [
    'https://cdn.jsdelivr.net/gh/AdguardTeam/cname-trackers@master/data/combined_disguised_microsites_justdomains.txt',
    [
      'https://raw.githubusercontent.com/AdguardTeam/cname-trackers/master/data/combined_disguised_microsites_justdomains.txt',
    ],
    true,
  ],
  [
    'https://urlhaus-filter.pages.dev/urlhaus-filter-domains.txt',
    ['https://malware-filter.pages.dev/urlhaus-filter-domains.txt'],
    true,
  ],
];

// 钓鱼域名源
const PHISHING_HOSTS_EXTRA: HostsSource[] = [
  ['https://raw.githubusercontent.com/durablenapkin/scamblocklist/master/hosts.txt', [], true],
];

const PHISHING_DOMAIN_LISTS_EXTRA: HostsSource[] = [
  [
    'https://phishing-filter.pages.dev/phishing-filter-domains.txt',
    ['https://malware-filter.pages.dev/phishing-filter-domains.txt'],
    true,
  ],
  ['https://phishing.army/download/phishing_army_blocklist.txt', [], true],
];

// AdGuard 过滤器
const ADGUARD_FILTERS: AdGuardFilterSource[] = [
  // AdGuard Base Filter (includes EasyList)
  [
    'https://filters.adtidy.org/extension/ublock/filters/2_optimized.txt',
    ['https://proxy.cdn.skk.moe/https/filters.adtidy.org/extension/ublock/filters/2_optimized.txt'],
  ],
  // EasyPrivacy
  [
    'https://easylist.to/easylist/easyprivacy.txt',
    ['https://easylist-downloads.adblockplus.org/easyprivacy.txt'],
  ],
  // AdGuard Tracking Protection
  [
    'https://filters.adtidy.org/extension/ublock/filters/3_optimized.txt',
    ['https://proxy.cdn.skk.moe/https/filters.adtidy.org/extension/ublock/filters/3_optimized.txt'],
  ],
  // AdGuard Chinese filter (EasyList China + AdGuard Chinese filter)
  [
    'https://filters.adtidy.org/extension/ublock/filters/224_optimized.txt',
    [
      'https://proxy.cdn.skk.moe/https/filters.adtidy.org/extension/ublock/filters/224_optimized.txt',
    ],
  ],
  // GameConsoleAdblockList
  [
    'https://cdn.jsdelivr.net/gh/DandelionSprout/adfilt@master/GameConsoleAdblockList.txt',
    ['https://raw.githubusercontent.com/DandelionSprout/adfilt/master/GameConsoleAdblockList.txt'],
  ],
  // uBlock Origin Unbreak (白名单)
  [
    'https://ublockorigin.github.io/uAssetsCDN/filters/unbreak.min.txt',
    ['https://ublockorigin.pages.dev/filters/unbreak.min.txt'],
  ],
];

// AdGuard 白名单过滤器
const ADGUARD_FILTERS_WHITELIST: AdGuardFilterSource[] = [
  [
    'https://adguardteam.github.io/AdGuardSDNSFilter/Filters/exceptions.txt',
    [
      'https://raw.githubusercontent.com/AdguardTeam/AdGuardSDNSFilter/master/Filters/exceptions.txt',
    ],
  ],
  [
    'https://adguardteam.github.io/AdGuardSDNSFilter/Filters/exclusions.txt',
    [
      'https://raw.githubusercontent.com/AdguardTeam/AdGuardSDNSFilter/master/Filters/exclusions.txt',
    ],
  ],
];

// 其他 Surge 规则源（来自原 rule-sources.ts）
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
];

// 崩溃报告白名单（参考 surge-master-2）
const CRASHLYTICS_WHITELIST = [
  'sts.online.visualstudio.com',
  '.ingest.sentry.io',
  '.ingest.us.sentry.io',
  '.ingest.de.sentry.io',
  '.sessions.bugsnag.com',
  '.notify.bugsnag.com',
  '.cloud.influxdata.com',
  'streaming.split.io',
  'telemetry.split.io',
  'sdk.split.io',
  '.metric.gstatic.com',
  'telemetry.1passwordservices.com',
  '.app-analytics-services.com',
  '.bugly.qcloud.com',
  '.crashlytics.com',
  '.raygun.io',
  '.rollbar.com',
  '.instabug.com',
];

// 预定义白名单
const PREDEFINED_WHITELIST = new Set([
  ...CRASHLYTICS_WHITELIST,
  '.localhost',
  '.local',
  '.localdomain',
  '.broadcasthost',
  '.ip6-loopback',
  '.ip6-localnet',
  '.ip6-mcastprefix',
  '.ip6-allnodes',
  '.ip6-allrouters',
  '.ip6-allhosts',
  '.mcastprefix',
  '.skk.moe',
  'analytics.google.com',
  '.whoami.akamai.net',
  '.instant.page',
  '.piwik.pro',
  'mixpanel.com',
  '.segment.com',
  '.segmentify.com',
  '.t.co',
  '.survicate.com',
  '.perfops.io',
  '.sb-cd.com',
  '.login.microsoftonline.com',
  'api.xiaomi.com',
  'api.io.mi.com',
  '.ip-api.com',
  '.digitaloceanspaces.com',
  '.geolocation-db.com',
  '.vlscppe.microsoft.com',
  '.statsig.com',
  '.pstmrk.it',
]);

// 宽松的 tldts 选项
const looseTldtsOpt = {
  allowPrivateDomains: true,
  extractHostname: false,
  validateHostname: false,
  detectIp: false,
};

// 项目根目录
const REPO_PATH = path.resolve(
  import.meta.url.startsWith('file:') ? path.dirname(new URL(import.meta.url).pathname) : __dirname,
  '..',
  '..',
  '..',
  '..'
);
const OUTPUT_DIR = path.join(REPO_PATH, 'Surge', 'Rulesets', 'reject');

// 处理 HOSTS 文件（轻量级规范化，去除 www）
async function processHosts(
  url: string,
  mirrors: string[] | null,
  includeAllSubDomain: boolean,
  allowEmptyRemote: boolean = false
): Promise<{ domains: string[]; stats: { total: number; invalid: number } }> {
  const domains: string[] = [];
  const stats = { total: 0, invalid: 0 };
  const rSpace = /\s+/;

  try {
    const content = await fetchAssets(url, mirrors, true, allowEmptyRemote);

    for (const line of content) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const parts = trimmed.split(rSpace);
      if (parts.length < 2) continue;

      const _domain = parts[1];
      if (!_domain) continue;

      // 使用轻量级规范化（去除 www）
      const domain = fastNormalizeDomainWithoutWww(_domain.trim());
      if (!domain) {
        stats.invalid++;
        continue;
      }

      stats.total++;
      domains.push(includeAllSubDomain ? '.' + domain : domain);
    }

    console.log(`✅ 处理 HOSTS ${url.split('/').pop()}: ${stats.total} 条 (无效 ${stats.invalid})`);
  } catch (error) {
    console.error(picocolors.red(`❌ 下载失败: ${url}`), error);
  }

  return { domains, stats };
}

// 处理域名列表（完整规范化）
async function processDomainList(
  url: string,
  mirrors: string[] | null,
  includeAllSubDomain: boolean,
  allowEmptyRemote: boolean = false
): Promise<{ domains: string[]; stats: { total: number; invalid: number } }> {
  const domains: string[] = [];
  const stats = { total: 0, invalid: 0 };

  try {
    const content = await fetchAssets(url, mirrors, true, allowEmptyRemote);

    for (const line of content) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // 使用完整规范化
      const domain = fastNormalizeDomain(trimmed);
      if (!domain) {
        stats.invalid++;
        continue;
      }

      stats.total++;
      domains.push(includeAllSubDomain ? '.' + domain : domain);
    }

    console.log(
      `✅ 处理域名列表 ${url.split('/').pop()}: ${stats.total} 条 (无效 ${stats.invalid})`
    );
  } catch (error) {
    console.error(picocolors.red(`❌ 下载失败: ${url}`), error);
  }

  return { domains, stats };
}

// 简化的 AdGuard 过滤器解析
async function processAdGuardFilter(
  url: string,
  mirrors: string[] | null,
  includeThirdParty: boolean = false
): Promise<{
  domains: Set<string>;
  domainSuffixes: Set<string>;
  keywords: Set<string>;
  ips: Set<string>;
  whitelist: {
    domains: Set<string>;
    domainSuffixes: Set<string>;
  };
  stats: { total: number; parsed: number };
}> {
  const result = {
    domains: new Set<string>(),
    domainSuffixes: new Set<string>(),
    keywords: new Set<string>(),
    ips: new Set<string>(),
    whitelist: {
      domains: new Set<string>(),
      domainSuffixes: new Set<string>(),
    },
    stats: { total: 0, parsed: 0 },
  };

  try {
    const content = await fetchAssets(url, mirrors, true, false);

    for (const line of content) {
      result.stats.total++;
      const trimmed = line.trim();

      // 跳过注释和空行
      if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('#')) {
        continue;
      }

      // 处理白名单规则 @@||domain^
      if (trimmed.startsWith('@@||') && trimmed.endsWith('^')) {
        const domain = trimmed.slice(4, -1);
        if (!domain.includes('*') && !domain.includes('/') && !domain.includes('$')) {
          result.whitelist.domainSuffixes.add(domain);
          result.stats.parsed++;
        }
        continue;
      }

      // 处理普通域名规则 ||domain^
      if (trimmed.startsWith('||') && trimmed.endsWith('^')) {
        let domain = trimmed.slice(2, -1);

        // 处理修饰符
        if (domain.includes('$')) {
          const [host, modifiers] = domain.split('$', 2);

          // 处理第三方规则
          if (
            !includeThirdParty &&
            (modifiers.includes('third-party') || modifiers.includes('3p'))
          ) {
            continue;
          }

          domain = host;
        }

        // 验证域名
        if (!domain.includes('*') && !domain.includes('/')) {
          if (!isProbablyIpv4(domain) && !isProbablyIpv6(domain)) {
            const parsed = tldts.parse(domain, looseTldtsOpt);
            if (parsed.isIcann || parsed.isPrivate) {
              result.domainSuffixes.add(domain);
              result.stats.parsed++;
            }
          } else {
            // IP 地址
            result.ips.add(domain);
          }
        }
      }
      // 处理完整 URL 规则 |http://domain
      else if (
        (trimmed.startsWith('|http://') || trimmed.startsWith('|https://')) &&
        !trimmed.includes('*')
      ) {
        const match = trimmed.match(/\|https?:\/\/([^\/\^\$]+)/);
        if (match && match[1]) {
          const domain = match[1];
          if (!isProbablyIpv4(domain) && !isProbablyIpv6(domain)) {
            const parsed = tldts.parse(domain, looseTldtsOpt);
            if (parsed.isIcann || parsed.isPrivate) {
              result.domains.add(domain);
              result.stats.parsed++;
            }
          }
        }
      }
    }

    console.log(
      `✅ 处理 AdGuard ${url.split('/').pop()}: ${result.stats.parsed}/${
        result.stats.total
      } 条解析成功`
    );
  } catch (error) {
    console.error(picocolors.red(`❌ 下载失败: ${url}`), error);
  }

  return result;
}

// 获取钓鱼域名（简化版）
async function getPhishingDomains(): Promise<string[]> {
  const domains: string[] = [];

  // 处理钓鱼 HOSTS
  for (const [url, mirrors, includeAllSubDomain, allowEmpty] of PHISHING_HOSTS_EXTRA) {
    const result = await processHosts(url, mirrors, includeAllSubDomain, allowEmpty || false);
    domains.push(...result.domains);
  }

  // 处理钓鱼域名列表
  for (const [url, mirrors, includeAllSubdomain, allowEmpty] of PHISHING_DOMAIN_LISTS_EXTRA) {
    const result = await processDomainList(url, mirrors, includeAllSubdomain, allowEmpty || false);
    domains.push(...result.domains);
  }

  return domains;
}

// 构建增强版 reject 域名集
export const buildRejectDomainSetEnhanced = task(
  false,
  import.meta.url
)(async span => {
  console.log(picocolors.bold('🚀 开始构建增强版 Reject 域名集...'));

  // 创建统一的 Trie 树
  const unifiedTrie = new HostnameSmolTrie(); // 所有规则

  // IP 规则集合
  const ipCidrs = new Set<string>();
  const ipCidr6s = new Set<string>();

  // 关键词集合
  const keywords = new Set<string>();

  // 白名单集合
  const whitelistDomains = new Set<string>(PREDEFINED_WHITELIST);
  const whitelistKeywords = new Set<string>();

  const validator = new EnhancedTldValidator();

  // 统计数据
  const stats = {
    hosts: { total: 0, invalid: 0 },
    domainLists: { total: 0, invalid: 0 },
    adguard: { total: 0, parsed: 0 },
    surge: { total: 0, invalid: 0 },
    phishing: { total: 0, invalid: 0 },
    whitelisted: 0,
    ipRules: 0,
  };

  console.log('\n📥 处理 HOSTS 文件...');
  // 处理主要 HOSTS 文件
  for (const [url, mirrors, includeAllSubDomain, allowEmpty] of HOSTS) {
    const result = await processHosts(url, mirrors, includeAllSubDomain, allowEmpty || false);
    for (const domain of result.domains) {
      unifiedTrie.add(domain, domain.startsWith('.'));
    }
    stats.hosts.total += result.stats.total;
    stats.hosts.invalid += result.stats.invalid;
  }

  // 处理额外 HOSTS 文件
  for (const [url, mirrors, includeAllSubDomain, allowEmpty] of HOSTS_EXTRA) {
    const result = await processHosts(url, mirrors, includeAllSubDomain, allowEmpty || false);
    for (const domain of result.domains) {
      unifiedTrie.add(domain, domain.startsWith('.'));
    }
    stats.hosts.total += result.stats.total;
    stats.hosts.invalid += result.stats.invalid;
  }

  console.log('\n📥 处理域名列表...');
  // 处理域名列表
  for (const [url, mirrors, includeAllSubDomain, allowEmpty] of DOMAIN_LISTS_EXTRA) {
    const result = await processDomainList(url, mirrors, includeAllSubDomain, allowEmpty || false);
    for (const domain of result.domains) {
      unifiedTrie.add(domain, domain.startsWith('.'));
    }
    stats.domainLists.total += result.stats.total;
    stats.domainLists.invalid += result.stats.invalid;
  }

  console.log('\n📥 处理钓鱼域名...');
  // 处理钓鱼域名
  const phishingDomains = await getPhishingDomains();
  for (const domain of phishingDomains) {
    unifiedTrie.add(domain, domain.startsWith('.'));
    stats.phishing.total++;
  }

  console.log('\n📥 处理 AdGuard 过滤器...');
  // 处理 AdGuard 过滤器
  for (const [url, mirrors, includeThirdParty] of ADGUARD_FILTERS) {
    const result = await processAdGuardFilter(url, mirrors, includeThirdParty || false);

    // 添加到统一 Trie
    for (const domain of result.domains) {
      unifiedTrie.add(domain, false);
    }
    for (const suffix of result.domainSuffixes) {
      unifiedTrie.add(suffix, true);
    }

    // 收集白名单
    addArrayElementsToSet(whitelistDomains, Array.from(result.whitelist.domains));
    addArrayElementsToSet(whitelistDomains, Array.from(result.whitelist.domainSuffixes));

    // 收集其他规则
    addArrayElementsToSet(keywords, Array.from(result.keywords));
    addArrayElementsToSet(ipCidrs, Array.from(result.ips));

    stats.adguard.total += result.stats.total;
    stats.adguard.parsed += result.stats.parsed;
    stats.ipRules += result.ips.size;
  }

  // 处理 AdGuard 白名单过滤器
  for (const [url, mirrors] of ADGUARD_FILTERS_WHITELIST) {
    const result = await processAdGuardFilter(url, mirrors, false);

    // 收集白名单
    addArrayElementsToSet(whitelistDomains, Array.from(result.whitelist.domains));
    addArrayElementsToSet(whitelistDomains, Array.from(result.whitelist.domainSuffixes));
    addArrayElementsToSet(whitelistDomains, Array.from(result.domains));
    addArrayElementsToSet(whitelistDomains, Array.from(result.domainSuffixes));
  }

  console.log('\n📥 处理 Surge 规则源...');
  // 处理其他 Surge 规则源（保持原有逻辑）
  for (const source of OTHER_RULE_SOURCES) {
    try {
      const content = await fetchAssets(source.url);
      const lines = content.filter(
        (line: string) => line && !line.startsWith('#') && !line.startsWith('//')
      );

      console.log(`✅ 处理 ${source.url.split('/').pop()}: ${lines.length} 条规则`);

      for (const line of lines) {
        const parts = line.split(',');
        const ruleType = parts[0];
        const value = parts[1];

        if (ruleType === 'DOMAIN' || ruleType === 'DOMAIN-SUFFIX') {
          // 检查白名单
          if (whitelistDomains.has(value)) {
            stats.whitelisted++;
            continue;
          }

          // 验证 TLD
          const validation = validator.validate(value, { source: RuleSource.RemoteList });
          if (!validation.valid) {
            console.warn(picocolors.yellow(`⚠️  非法 TLD: ${value} (${validation.reason})`));
            stats.surge.invalid++;
            continue;
          }

          stats.surge.total++;
          unifiedTrie.add(value, ruleType === 'DOMAIN-SUFFIX');
        } else if (ruleType === 'IP-CIDR') {
          ipCidrs.add(value);
          stats.ipRules++;
        } else if (ruleType === 'IP-CIDR6') {
          ipCidr6s.add(value);
          stats.ipRules++;
        } else if (ruleType === 'DOMAIN-KEYWORD') {
          keywords.add(value);
        }
      }
    } catch (error) {
      console.error(picocolors.red(`❌ 下载失败: ${source.url}`), error);
    }
  }

  // 应用白名单
  console.log('\n🔍 应用白名单...');
  for (const domain of whitelistDomains) {
    unifiedTrie.whitelist(domain);
  }

  // 应用关键词白名单
  const kwFilter = createKeywordFilter(Array.from(whitelistKeywords));
  const finalKeywords = Array.from(keywords).filter(kw => !kwFilter(kw));

  // 优化 IP 段
  console.log('\n🔧 优化 IP 段...');
  const optimizedIpCidrs = ipCidrs.size > 0 ? mergeCidr(Array.from(ipCidrs)) : [];
  const optimizedIpCidr6s = ipCidr6s.size > 0 ? mergeCidr(Array.from(ipCidr6s)) : [];

  // 导出规则
  console.log('\n📊 导出规则...');
  const allDomains: string[] = [];
  const allSuffixes: string[] = [];

  unifiedTrie.dump((domain: string, isSubdomain: boolean) => {
    if (isSubdomain) {
      allSuffixes.push(domain);
    } else {
      allDomains.push(domain);
    }
  });

  // 生成输出文件
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // 统一规则文件
  const unifiedOutput: string[] = [
    "# Sukka's Surge Reject Rules - Enhanced Edition",
    '# Data Sources:',
    '#   - HOSTS: GoodbyeAds (Xiaomi, Huawei, Samsung)',
    '#   - HOSTS Extra: pgl.yoyo.org, someonewhocares.org, nocoin-list',
    '#   - Domain Lists: AdGuard CNAME Trackers, URLhaus',
    '#   - AdGuard Filters: Base, EasyPrivacy, Tracking Protection, Chinese',
    '#   - Surge Rules: ConnersHua RuleGo, TG-Twilight AWAvenue',
    '#   - Phishing Protection: Phishing.army, Durablenapkin Scamblocklist',
    '# Features:',
    '#   - Multi-layer processing with appropriate normalization',
    '#   - HOSTS: Light normalization (remove www)',
    '#   - Domain Lists: Full normalization',
    '#   - AdGuard: Loose validation for compatibility',
    '#   - Surge Rules: Keep original format',
    '#   - Comprehensive whitelist protection',
    '#   - IP CIDR optimization',
    '# License: AGPL 3.0',
    '# Homepage: https://github.com/SukkaW/Surge',
    `# Updated: ${new Date().toISOString()}`,
    '',
    `# Statistics:`,
    `#   - HOSTS processed: ${stats.hosts.total} (invalid: ${stats.hosts.invalid})`,
    `#   - Domain lists processed: ${stats.domainLists.total} (invalid: ${stats.domainLists.invalid})`,
    `#   - AdGuard filters parsed: ${stats.adguard.parsed}/${stats.adguard.total}`,
    `#   - Surge rules processed: ${stats.surge.total} (invalid: ${stats.surge.invalid})`,
    `#   - Phishing domains: ${stats.phishing.total}`,
    `#   - Whitelisted: ${stats.whitelisted}`,
    `#   - Total domain rules: ${allDomains.length + allSuffixes.length}`,
    `#   - IP rules: ${optimizedIpCidrs.length + optimizedIpCidr6s.length}`,
    `#   - Keyword rules: ${finalKeywords.length}`,
    '',
  ];

  // 添加域名规则
  for (const domain of allDomains.sort()) {
    unifiedOutput.push(`DOMAIN,${domain}`);
  }
  for (const suffix of allSuffixes.sort()) {
    unifiedOutput.push(`DOMAIN-SUFFIX,${suffix}`);
  }
  // 添加关键词规则
  for (const keyword of finalKeywords.sort()) {
    unifiedOutput.push(`DOMAIN-KEYWORD,${keyword}`);
  }
  // 添加 IP 规则
  for (const cidr of optimizedIpCidrs) {
    unifiedOutput.push(`IP-CIDR,${cidr},no-resolve`);
  }
  for (const cidr of optimizedIpCidr6s) {
    unifiedOutput.push(`IP-CIDR6,${cidr},no-resolve`);
  }

  await fs.writeFile(path.join(OUTPUT_DIR, 'block.list'), unifiedOutput.join('\n'), 'utf-8');

  // 打印最终统计
  console.log(picocolors.green('\n✅ 构建完成！'));
  console.log(picocolors.cyan('📊 最终统计:'));
  console.log(`  - 域名规则: ${allDomains.length + allSuffixes.length} 条`);
  console.log(`  - 关键词规则: ${finalKeywords.length} 条`);
  console.log(`  - IP 规则: ${optimizedIpCidrs.length + optimizedIpCidr6s.length} 条`);
  console.log(
    `  - 总规则数: ${
      allDomains.length +
      allSuffixes.length +
      finalKeywords.length +
      optimizedIpCidrs.length +
      optimizedIpCidr6s.length
    } 条`
  );
  console.log(`  - 输出文件: ${path.join(OUTPUT_DIR, 'block.list')}`);
});

// 如果直接运行此脚本
if (import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const rootSpan = createSpan('build-reject-domainset-enhanced');
  buildRejectDomainSetEnhanced(rootSpan).finally(() => {
    rootSpan.stop();
  });
}

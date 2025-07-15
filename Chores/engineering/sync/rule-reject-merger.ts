import { HostnameSmolTrie } from '../lib/trie.js';
import { EnhancedTldValidator, RuleSource } from '../lib/enhanced-tld-validator.js';
import fs from 'fs/promises';
import path from 'path';
import { REPO_PATH } from './rule-sources.js';
import { merge as mergeCidr } from 'fast-cidr-tools';
import picocolors from 'picocolors';

// 预定义白名单（参考 Surge-master-2）
const PREDEFINED_WHITELIST = [
  // Crash reporting services
  'sts.online.visualstudio.com',
  '.ingest.sentry.io',
  '.ingest.us.sentry.io',
  '.ingest.de.sentry.io',
  '.sessions.bugsnag.com',
  '.notify.bugsnag.com',
  '.cloud.influxdata.com',
  '.cloud1.influxdata.com',
  '.cloud2.influxdata.com',
  'streaming.split.io',
  'telemetry.split.io',
  'sdk.split.io',
  '.metric.gstatic.com',
  'telemetry.1passwordservices.com',
  'b5x-sentry.1passwordservices.com',
  'events.tableplus.com',
  'telemetry.nextjs.org',
  'telemetry.vercel.com',
  '.crashlytics2.l.google.com',
  '.crashlyticsreports-pa.googleapis.com',
  '.e.crashlytics.com',
  '.events.backtrace.io',
  'auth.split.io',
  'events.split.io',
  '.in.appcenter.ms',
  '.loggly.com',
  '.logz.io',
  '.opentelemetry.io',
  '.raygun.io',
  '.rum.cronitor.io',
  '.settings.crashlytics.com',
  '.sny.monosnap.com',
  '.lr-ingest.com',
  '.cdn.rollbar.com',
  '.api.instabug.com',
  '.ensighten.com',
  'api.crashguard.me',

  // Local domains
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

  // Important services
  'analytics.google.com',
  '.cloud.answerhub.com',
  'ae01.alicdn.com',
  '.whoami.akamai.net',
  '.whoami.ds.akahelp.net',
  '.instant.page',
  '.piwik.pro',
  'mixpanel.com',
  'cdn.mxpnl.com',
  '.heapanalytics.com',
  '.segment.com',
  '.segmentify.com',
  '.t.co',
  '.survicate.com',
  '.perfops.io',
  'd2axgrpnciinw7.cloudfront.net',
  '.sb-cd.com',
  '.storage.yandexcloud.net',
  '.login.microsoftonline.com',
  'api.xiaomi.com',
  'api.io.mi.com',
  '.cdn.userreport.com',
  '.ip-api.com',
  '.fastly-analytics.com',
  '.digitaloceanspaces.com',
  's3.nl-ams.scw.cloud',
  '.geolocation-db.com',
  '.uploads.codesandbox.io',
  '.vlscppe.microsoft.com',
  '.statsig.com',
  '.pstmrk.it',
  '.clicks.mlsend.com',
  'email.accounts.bitly.com',
  'adsense.google.com',
  'api.vip.miui.com',
  'api.comm.miui.com',
  '.ai.api.xiaomi.com',
  'm.stripe.com',
  '.w3s.link',
  '.r2.dev',
  'mlsend.com',
  'ab.chatgpt.com',
  'jnn-pa.googleapis.com',
  'imasdk.googleapis.com',

  // rDNS domains
  '.in-addr.arpa',
  '.ip6.arpa',
  '.clients.your-server.de',
  '.bc.googleusercontent.com',
  '.host.secureserver.net',
  '.ip.linodeusercontent.com',
  '.static.akamaitechnologies.com',
  '.compute.amazonaws.com',

  // Others
  '.shoppy.gg',
  'transcend-cdn.com',
  'store1.gofile.io',
  'ad.12306.cn',
  '.ib.snssdk.com',
  '.nstool.netease.com',
  '.wns.windows.com',
  'widget-mediator.zopim.com',
  '.llnw.net',
  'repo.huaweicloud.com',
  '.hubspotlinks.com',
  'cldup.com',
  'cuty.io',
  'links.strava.com',
  'email.strava.com',
  'insideruser.microsoft.com',

  // CNAME domains (doesn't make sense to block)
  '.cdn.cloudflare.net',
  '.apple-dns.net',
  '.data.microsoft.com.akadns.net',

  // Expired domains
  '.expobarrio.com',
  '.hamdandates.com',
  '.amzone.co.jp',
];

interface MergeResult {
  domains: string[];
  domainSuffixes: string[];
  ipCidrs: string[];
  wildcards: string[];
  keywords: string[];
  totalRules: number;
  removedByWhitelist: number;
  optimizedDomains: number;
  optimizedIPs: number;
}

export class RejectRuleMerger {
  private validator = new EnhancedTldValidator();
  private domainTrie = new HostnameSmolTrie();
  private wildcardTrie = new HostnameSmolTrie();
  private keywords = new Set<string>();
  private ipCidrs = new Set<string>();
  private whitelist = new Set<string>(PREDEFINED_WHITELIST);

  private stats = {
    totalRules: 0,
    removedByWhitelist: 0,
    optimizedDomains: 0,
    optimizedIPs: 0,
    illegalTlds: 0,
  };

  async processFile(filePath: string): Promise<void> {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
        continue;
      }

      this.stats.totalRules++;

      // 解析规则
      const parts = trimmed.split(',');
      const ruleType = parts[0];

      switch (ruleType) {
        case 'DOMAIN':
          await this.processDomain(parts[1], false);
          break;
        case 'DOMAIN-SUFFIX':
          await this.processDomain(parts[1], true);
          break;
        case 'DOMAIN-KEYWORD':
          this.keywords.add(parts[1]);
          break;
        case 'DOMAIN-WILDCARD':
          this.processWildcard(parts[1]);
          break;
        case 'IP-CIDR':
          this.ipCidrs.add(parts[1]);
          break;
        case 'IP-CIDR6':
          this.ipCidrs.add(parts[1]);
          break;
      }
    }
  }

  private async processDomain(domain: string, isSubdomain: boolean): Promise<void> {
    if (!domain) return;

    // 检查白名单
    if (this.isWhitelisted(domain)) {
      this.stats.removedByWhitelist++;
      return;
    }

    // 验证 TLD - 本地文件使用宽松验证
    const validation = this.validator.validate(domain, { source: RuleSource.LocalFile });
    if (!validation.valid) {
      console.warn(picocolors.yellow(`警告: 非法 TLD - ${domain} (${validation.reason})`));
      this.stats.illegalTlds++;
      // 本地文件中的非法 TLD 仍然保留
    }

    // 添加到 Trie 树
    this.domainTrie.add(domain, isSubdomain);
  }

  private processWildcard(wildcard: string): void {
    if (!wildcard) return;

    // 检查白名单
    if (this.isWhitelisted(wildcard)) {
      this.stats.removedByWhitelist++;
      return;
    }

    this.wildcardTrie.add(wildcard);
  }

  private isWhitelisted(domain: string): boolean {
    // 检查精确匹配
    if (this.whitelist.has(domain)) {
      return true;
    }

    // 检查后缀匹配
    for (const whitelistItem of this.whitelist) {
      if (whitelistItem.startsWith('.') && domain.endsWith(whitelistItem.substring(1))) {
        return true;
      }
    }

    return false;
  }

  async merge(): Promise<MergeResult> {
    // 从 Trie 树获取优化后的域名
    const domains: string[] = [];
    const domainSuffixes: string[] = [];

    this.domainTrie.dump((domain: string, isIncludeSubdomain: boolean) => {
      if (isIncludeSubdomain) {
        domainSuffixes.push(domain);
      } else {
        domains.push(domain);
      }
    });

    // 获取通配符域名
    const wildcards: string[] = [];
    this.wildcardTrie.dump((wildcard: string) => {
      wildcards.push(wildcard);
    });

    // 优化 IP 段
    const originalIpCount = this.ipCidrs.size;
    const optimizedIpCidrs = mergeCidr(Array.from(this.ipCidrs));
    this.stats.optimizedIPs = originalIpCount - optimizedIpCidrs.length;

    // 计算优化的域名数量
    const originalDomainCount = this.stats.totalRules - this.ipCidrs.size - this.keywords.size;
    const optimizedDomainCount = domains.length + domainSuffixes.length + wildcards.length;
    this.stats.optimizedDomains = originalDomainCount - optimizedDomainCount;

    return {
      domains,
      domainSuffixes,
      ipCidrs: optimizedIpCidrs,
      wildcards,
      keywords: Array.from(this.keywords),
      totalRules: this.stats.totalRules,
      removedByWhitelist: this.stats.removedByWhitelist,
      optimizedDomains: this.stats.optimizedDomains,
      optimizedIPs: this.stats.optimizedIPs,
    };
  }

  getStats() {
    return this.stats;
  }
}

// 生成优化后的规则文件
async function generateOptimizedRejectRules(
  result: MergeResult,
  outputPath: string
): Promise<void> {
  const lines: string[] = [
    "# Sukka's Surge Reject Rules - Optimized",
    '# NOTE: This file has been optimized and merged in-place',
    `# Total Rules: ${result.totalRules}`,
    `# Removed by Whitelist: ${result.removedByWhitelist}`,
    `# Domain Optimization: ${result.optimizedDomains} rules merged`,
    `# IP Optimization: ${result.optimizedIPs} CIDRs merged`,
    `# Last Updated: ${new Date().toISOString()}`,
    '',
  ];

  // 添加域名规则
  for (const domain of result.domains) {
    lines.push(`DOMAIN,${domain}`);
  }

  // 添加域名后缀规则
  for (const suffix of result.domainSuffixes) {
    lines.push(`DOMAIN-SUFFIX,${suffix}`);
  }

  // 添加关键词规则
  for (const keyword of result.keywords) {
    lines.push(`DOMAIN-KEYWORD,${keyword}`);
  }

  // 添加通配符规则
  for (const wildcard of result.wildcards) {
    lines.push(`DOMAIN-WILDCARD,${wildcard}`);
  }

  // 添加 IP 规则
  for (const ip of result.ipCidrs) {
    if (ip.includes(':')) {
      lines.push(`IP-CIDR6,${ip}`);
    } else {
      lines.push(`IP-CIDR,${ip}`);
    }
  }

  await fs.writeFile(outputPath, lines.join('\n'), 'utf-8');
}

// 主函数
export async function mergeRejectRules(): Promise<boolean> {
  console.log(picocolors.bold('🔧 开始合并 Reject 规则...'));

  const merger = new RejectRuleMerger();
  const blockListPath = path.join(REPO_PATH, 'Surge', 'Rulesets', 'reject', 'block.list');
  const outputPath = blockListPath; // 直接覆盖原文件

  try {
    // 备份原文件
    const backupPath = blockListPath + '.bak';
    try {
      await fs.copyFile(blockListPath, backupPath);
      console.log(`💾 已备份原文件到: ${backupPath}`);
    } catch (error) {
      console.warn(picocolors.yellow('⚠️  无法创建备份文件，继续执行...'));
    }

    // 处理文件
    console.log(`📄 处理文件: ${blockListPath}`);
    await merger.processFile(blockListPath);

    // 合并规则
    console.log('🔀 合并和优化规则...');
    const result = await merger.merge();

    // 生成优化后的文件
    await generateOptimizedRejectRules(result, outputPath);

    // 显示统计信息
    const stats = merger.getStats();
    console.log(picocolors.green('\n✅ 合并完成！'));
    console.log(picocolors.cyan('📊 统计信息:'));
    console.log(`  - 总规则数: ${stats.totalRules}`);
    console.log(`  - 白名单过滤: ${stats.removedByWhitelist}`);
    console.log(`  - 域名优化: ${stats.optimizedDomains} 条规则被合并`);
    console.log(`  - IP 优化: ${stats.optimizedIPs} 个 CIDR 被合并`);
    console.log(`  - 非法 TLD: ${stats.illegalTlds} 个（已保留）`);
    console.log(`  - 已更新文件: ${outputPath}`);

    return true;
  } catch (error) {
    console.error(picocolors.red('❌ 合并失败:'), error);
    return false;
  }
}

// 如果直接运行该脚本
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  mergeRejectRules().catch(console.error);
}

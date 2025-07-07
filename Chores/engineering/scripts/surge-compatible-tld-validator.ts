#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import tldts from 'tldts';
import picocolors from 'picocolors';
import crypto from 'crypto';

// 导入工具函数
import { extractDomainFromRule } from '../lib/process-line.js';

// ========== 与 Surge-master-2 相同的白名单配置 ==========

// CRASHLYTICS_WHITELIST - 错误报告和监控服务
const CRASHLYTICS_WHITELIST = [
  // VSCode Telemetry
  'sts.online.visualstudio.com',
  // Sentry
  '.ingest.sentry.io',
  '.ingest.us.sentry.io',
  '.ingest.de.sentry.io',
  // bugsnag
  '.sessions.bugsnag.com',
  '.notify.bugsnag.com',
  // influxdata
  '.cloud.influxdata.com',
  '.cloud1.influxdata.com',
  '.cloud2.influxdata.com',
  // split.io A/B flag
  'streaming.split.io',
  'telemetry.split.io',
  'sdk.split.io',
  // Google
  '.metric.gstatic.com',
  // Misc
  'telemetry.1passwordservices.com',
  'b5x-sentry.1passwordservices.com',
  'events.tableplus.com',
  'telemetry.nextjs.org',
  'telemetry.vercel.com',
  'stats.setapp.com',
  'stats.setapp.macpaw.dev',
  '.app-analytics-services.com',
  '.telemetry.services.yofi.ai',
  '.cdn.pubnub.com',
  '.data.debugbear.com',
  '.cdn.applicationinsights.io',
  '.applicationinsights.azure.com',
  '.applicationinsights.azure.cn',
  '.api.loganalytics.io',
  '.bugly.qcloud.com',
  '.cdn.signalfx.com',
  '.crash-reports.browser.yandex.net',
  '.crashlytics2.l.google.com',
  '.crashlyticsreports-pa.googleapis.com',
  '.e.crashlytics.com',
  '.events.backtrace.io',
  'auth.split.io',
  'events.split.io',
  'streaming.split.io',
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
];

// PREDEFINED_WHITELIST - 完整的预定义白名单
const PREDEFINED_WHITELIST = [
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
  '.in-addr.arpa',
  '.ip6.arpa',
  '.clients.your-server.de',
  '.bc.googleusercontent.com',
  '.host.secureserver.net',
  '.ip.linodeusercontent.com',
  '.static.akamaitechnologies.com',
  '.compute.amazonaws.com',
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
  '.cdn.cloudflare.net',
  '.apple-dns.net',
  '.data.microsoft.com.akadns.net',
  '.expobarrio.com',
  '.hamdandates.com',
  '.amzone.co.jp',
  'mhc-ajax-eu.myhomescreen.tv',
  'mhc-ajax-eu-s2.myhomescreen.tv',
  'mhc-xpana-eu.myhomescreen.tv',
  'mhc-xpana-eu-s2.myhomescreen.tv',
  'infolink.pavv.co.kr',
  'hbbtv.zdf.de',
  'hbbtv.prosieben.de',
  'hbbtv.redbutton.de',
  'hbbtv.kika.de',
];

// ICP_TLD - 中国 ICP 备案 TLD
const ICP_TLD = [
  'ren',
  'wang',
  'citic',
  'top',
  'sohu',
  'xin',
  'com',
  'net',
  'club',
  'xyz',
  'site',
  'shop',
  'info',
  'mobi',
  'red',
  'pro',
  'kim',
  'ltd',
  'group',
  'biz',
  'link',
  'store',
  'tech',
  'fun',
  'online',
  'art',
  'design',
  'love',
  'center',
  'video',
  'social',
  'team',
  'show',
  'cool',
  'zone',
  'world',
  'today',
  'city',
  'chat',
  'company',
  'live',
  'fund',
  'gold',
  'plus',
  'guru',
  'run',
  'pub',
  'email',
  'life',
  'co',
  'baidu',
  'cloud',
  'host',
  'space',
  'press',
  'website',
  'archi',
  'asia',
  'bio',
  'black',
  'blue',
  'green',
  'lotto',
  'organic',
  'pet',
  'pink',
  'poker',
  'promo',
  'ski',
  'vote',
  'voto',
  'icu',
  'fans',
  'unicom',
  'jpmorgan',
  'chase',
  'cc',
  'band',
  'cab',
  'cafe',
  'cash',
  'fan',
  'fyi',
  'games',
  'market',
  'mba',
  'news',
  'media',
  'sale',
  'shopping',
  'studio',
  'tax',
  'technology',
  'vin',
  'baby',
  'college',
  'monster',
  'protection',
  'rent',
  'security',
  'storage',
  'theatre',
  'bond',
  'cyou',
  'uno',
  'school',
  'global',
  'me',
  'pw',
  'hk',
  'tv',
  'saxo',
  'click',
  'auto',
  'autos',
  'beauty',
  'boats',
  'car',
  'cars',
  'hair',
  'homes',
  'makeup',
  'motorcycles',
  'quest',
  'skin',
  'tickets',
  'yachts',
  'kids',
];

// CNAME 追踪器数据源 (与 Surge-master-2 相同)
const CNAME_TRACKER_SOURCES = [
  {
    name: 'AdGuard CNAME Ads',
    url: 'https://cdn.jsdelivr.net/gh/AdguardTeam/cname-trackers@master/data/combined_disguised_ads_justdomains.txt',
    mirrors: [
      'https://raw.githubusercontent.com/AdguardTeam/cname-trackers/master/data/combined_disguised_ads_justdomains.txt',
    ],
  },
  {
    name: 'AdGuard CNAME Trackers',
    url: 'https://cdn.jsdelivr.net/gh/AdguardTeam/cname-trackers@master/data/combined_disguised_trackers_justdomains.txt',
    mirrors: [
      'https://raw.githubusercontent.com/AdguardTeam/cname-trackers/master/data/combined_disguised_trackers_justdomains.txt',
    ],
  },
  {
    name: 'AdGuard CNAME Microsites',
    url: 'https://cdn.jsdelivr.net/gh/AdguardTeam/cname-trackers@master/data/combined_disguised_microsites_justdomains.txt',
    mirrors: [
      'https://raw.githubusercontent.com/AdguardTeam/cname-trackers/master/data/combined_disguised_microsites_justdomains.txt',
    ],
  },
];

// ========== TLD 验证配置 ==========

// tldts 配置选项 (与 Surge-master-2 相同)
const looseTldtsOpt = {
  allowPrivateDomains: false,
  extractHostname: false,
  mixedInputs: false,
  validateHostname: false,
  detectIp: false,
};

const normalizeTldtsOpt = {
  allowPrivateDomains: true,
  detectIp: false,
};

// ========== 辅助函数 ==========

// 简单的哈希函数
function hashString(str: string): string {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function isInWhitelist(domain: string, whitelist: string[]): boolean {
  for (const whiteItem of whitelist) {
    if (whiteItem.startsWith('.')) {
      // 包含子域名的白名单项
      const suffix = whiteItem.slice(1);
      if (domain === suffix || domain.endsWith('.' + suffix)) {
        return true;
      }
    } else {
      // 精确匹配
      if (domain === whiteItem) {
        return true;
      }
    }
  }
  return false;
}

// 与 Surge-master-2 相同的域名验证逻辑
function shouldFilterDomain(domain: string, parsed: ReturnType<typeof tldts.parse>): boolean {
  // 如果在预定义白名单中，不过滤
  if (isInWhitelist(domain, PREDEFINED_WHITELIST)) {
    return false;
  }

  // 没有 publicSuffix 的域名需要过滤
  if (!parsed.publicSuffix || !parsed.hostname || !parsed.domain) {
    return true;
  }

  // ICANN 认证的 TLD 不过滤
  if (parsed.isIcann) {
    return false;
  }

  // ICP 备案 TLD 不过滤
  const tld = parsed.publicSuffix;
  if (ICP_TLD.includes(tld)) {
    return false;
  }

  // 私有域名但不在白名单中的需要过滤
  // 注意：Surge-master-2 在 normalize-domain.ts 中接受私有域名
  if (parsed.isPrivate) {
    // 检查是否为 CDN 相关的私有域名（通过 PREDEFINED_WHITELIST 处理）
    return !isInWhitelist(domain, PREDEFINED_WHITELIST);
  }

  // 其他情况都过滤
  return true;
}

// ========== CNAME 追踪器下载 ==========

async function downloadCnameTrackers(): Promise<Set<string>> {
  const cnameTrackers = new Set<string>();

  for (const source of CNAME_TRACKER_SOURCES) {
    console.log(`📥 下载 ${source.name}...`);

    try {
      const response = await fetch(source.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const text = await response.text();
      const lines = text.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          cnameTrackers.add(trimmed);
        }
      }

      console.log(`  ✅ 成功下载 ${lines.length} 行`);
    } catch (error) {
      console.error(`  ❌ 下载失败:`, error);

      // 尝试镜像
      for (const mirror of source.mirrors || []) {
        try {
          console.log(`  🔄 尝试镜像: ${mirror}`);
          const response = await fetch(mirror);
          if (response.ok) {
            const text = await response.text();
            const lines = text.split('\n');

            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed && !trimmed.startsWith('#')) {
                cnameTrackers.add(trimmed);
              }
            }

            console.log(`  ✅ 镜像成功`);
            break;
          }
        } catch {}
      }
    }
  }

  console.log(`\n📊 共收集 ${cnameTrackers.size} 个 CNAME 追踪器域名`);
  return cnameTrackers;
}

// ========== 主验证函数 ==========

interface ValidationResult {
  file: string;
  totalDomains: number;
  filteredDomains: number;
  cnameTrackerHits: number;
  hashCollisions: Map<string, string[]>;
  examples: Array<{
    domain: string;
    reason: string;
    lineNumber: number;
  }>;
}

async function validateFile(
  filePath: string,
  cnameTrackers: Set<string>,
  autoFix: boolean
): Promise<ValidationResult> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  const result: ValidationResult = {
    file: filePath,
    totalDomains: 0,
    filteredDomains: 0,
    cnameTrackerHits: 0,
    hashCollisions: new Map(),
    examples: [],
  };

  const domainHashes = new Map<string, string[]>();
  const newLines: string[] = [];
  let modified = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 保留空行和注释
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      newLines.push(line);
      continue;
    }

    // 提取域名
    const extracted = extractDomainFromRule(trimmed);
    if (!extracted || !extracted.domain) {
      newLines.push(line);
      continue;
    }

    const { domain } = extracted;
    result.totalDomains++;

    // 解析域名
    const parsed = tldts.parse(domain, normalizeTldtsOpt);

    // 检查是否应该过滤
    let shouldFilter = false;
    let filterReason = '';

    if (shouldFilterDomain(domain, parsed)) {
      shouldFilter = true;
      filterReason = 'TLD 验证失败';

      if (!parsed.publicSuffix) {
        filterReason = '无有效 TLD';
      } else if (!parsed.isIcann && !ICP_TLD.includes(parsed.publicSuffix)) {
        filterReason = `非法 TLD: ${parsed.publicSuffix}`;
      }
    }

    // 检查是否为 CNAME 追踪器
    if (!shouldFilter && cnameTrackers.has(domain)) {
      result.cnameTrackerHits++;
      // 注意：CNAME 追踪器不应该被过滤，它们正是我们想要屏蔽的
    }

    // 计算哈希碰撞
    if (!shouldFilter) {
      const hash = hashString(domain);
      if (!domainHashes.has(hash)) {
        domainHashes.set(hash, []);
      }
      domainHashes.get(hash)!.push(domain);
    }

    if (shouldFilter) {
      result.filteredDomains++;

      if (result.examples.length < 10) {
        result.examples.push({
          domain,
          reason: filterReason,
          lineNumber: i + 1,
        });
      }

      if (autoFix) {
        newLines.push(`# [${filterReason}] ${line}`);
        modified = true;
      } else {
        newLines.push(line);
      }
    } else {
      newLines.push(line);
    }
  }

  // 查找哈希碰撞
  for (const [hash, domains] of domainHashes) {
    if (domains.length > 1) {
      result.hashCollisions.set(hash, domains);
    }
  }

  // 如果修改了文件且启用自动修复，写回文件
  if (modified && autoFix) {
    await fs.writeFile(filePath, newLines.join('\n'));
    console.log(picocolors.green(`✅ 已修复文件: ${filePath}`));
  }

  return result;
}

// ========== 主程序 ==========

async function main() {
  const args = process.argv.slice(2);
  const autoFix = args.includes('--fix');

  console.log(picocolors.bold('🔍 Surge-master-2 兼容 TLD 验证器'));
  console.log(`📋 模式: ${autoFix ? picocolors.yellow('自动修复') : picocolors.green('仅检测')}`);
  console.log('');

  // 下载 CNAME 追踪器列表
  const cnameTrackers = await downloadCnameTrackers();

  // 要检测的文件
  const targetFiles = [
    path.join('..', '..', 'Surge', 'Rulesets', 'reject', 'block.list'),
    path.join('..', '..', 'Surge', 'Rulesets', 'reject', 'reject-Loon.list'),
    path.join('..', '..', 'Surge', 'Rulesets', 'reject', 'reject-QX.list'),
  ];

  const results: ValidationResult[] = [];

  for (const file of targetFiles) {
    try {
      await fs.access(file);
      console.log(`\n📄 验证文件: ${file}`);
      const result = await validateFile(file, cnameTrackers, autoFix);
      results.push(result);
    } catch {
      console.warn(picocolors.yellow(`⚠️  文件不存在: ${file}`));
    }
  }

  // 打印总结报告
  console.log('\n' + picocolors.bold('📊 验证报告'));
  console.log(picocolors.cyan('='.repeat(60)));

  let totalDomains = 0;
  let totalFiltered = 0;
  let totalCnameHits = 0;
  let totalCollisions = 0;

  for (const result of results) {
    totalDomains += result.totalDomains;
    totalFiltered += result.filteredDomains;
    totalCnameHits += result.cnameTrackerHits;
    totalCollisions += result.hashCollisions.size;

    console.log(`\n${picocolors.blue(path.basename(result.file))}`);
    console.log(`  域名总数: ${result.totalDomains.toLocaleString()}`);
    console.log(`  过滤数量: ${result.filteredDomains.toLocaleString()}`);
    console.log(`  CNAME追踪器: ${result.cnameTrackerHits.toLocaleString()}`);
    console.log(`  哈希碰撞: ${result.hashCollisions.size}`);

    if (result.examples.length > 0) {
      console.log(`  示例:`);
      for (const example of result.examples.slice(0, 5)) {
        console.log(`    行 ${example.lineNumber}: ${example.domain} (${example.reason})`);
      }
    }
  }

  console.log('\n' + picocolors.bold('总计:'));
  console.log(`  域名总数: ${totalDomains.toLocaleString()}`);
  console.log(
    `  过滤数量: ${totalFiltered.toLocaleString()} (${(
      (totalFiltered / totalDomains) *
      100
    ).toFixed(2)}%)`
  );
  console.log(`  CNAME追踪器: ${totalCnameHits.toLocaleString()}`);
  console.log(`  哈希碰撞: ${totalCollisions}`);
}

// 执行主程序
if (import.meta.url.startsWith('file:')) {
  const modulePath = new URL(import.meta.url).pathname;
  if (process.argv[1] === modulePath) {
    main().catch(console.error);
  }
}

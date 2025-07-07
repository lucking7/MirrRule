/**
 * AdGuard 过滤器配置
 * 定义要导入的 AdGuard 过滤器及其处理方式
 */

export interface AdGuardFilterConfig {
  name: string;
  url: string;
  mirrorUrls?: string[];
  description?: string;
  includeThirdParty?: boolean; // 是否包含第三方规则
}

/**
 * AdGuard 过滤器列表（参考 Surge-master-2）
 */
export const ADGUARD_FILTERS: AdGuardFilterConfig[] = [
  // AdGuard 基础过滤器（包含 EasyList）
  {
    name: 'AdGuard Base Filter',
    url: 'https://filters.adtidy.org/extension/ublock/filters/2_optimized.txt',
    mirrorUrls: [
      'https://proxy.cdn.skk.moe/https/filters.adtidy.org/extension/ublock/filters/2_optimized.txt',
    ],
    description: 'AdGuard 基础过滤器，包含 EasyList',
  },

  // EasyPrivacy
  {
    name: 'EasyPrivacy',
    url: 'https://easylist.to/easylist/easyprivacy.txt',
    mirrorUrls: [
      'https://easylist-downloads.adblockplus.org/easyprivacy.txt',
      'https://filters.adtidy.org/extension/ublock/filters/118_optimized.txt',
    ],
    description: '隐私保护过滤器',
  },

  // AdGuard 移动广告过滤器
  {
    name: 'AdGuard Mobile Ads',
    url: 'https://filters.adtidy.org/extension/ublock/filters/11_optimized.txt',
    description: '移动端广告过滤',
  },

  // AdGuard 跟踪保护过滤器
  {
    name: 'AdGuard Tracking Protection',
    url: 'https://filters.adtidy.org/extension/ublock/filters/3_optimized.txt',
    description: '反跟踪保护',
  },

  // AdGuard 中文过滤器
  {
    name: 'AdGuard Chinese Filter',
    url: 'https://filters.adtidy.org/extension/ublock/filters/224_optimized.txt',
    description: '中文网站广告过滤（包含 EasyList China）',
  },

  // uBlock Origin Unbreak
  {
    name: 'uBlock Origin Unbreak',
    url: 'https://ublockorigin.github.io/uAssetsCDN/filters/unbreak.min.txt',
    mirrorUrls: ['https://ublockorigin.pages.dev/filters/unbreak.min.txt'],
    description: '修复被误杀的网站功能',
  },
];

/**
 * AdGuard CNAME 追踪器列表
 */
export const ADGUARD_CNAME_TRACKERS: AdGuardFilterConfig[] = [
  {
    name: 'AdGuard CNAME Ads',
    url: 'https://cdn.jsdelivr.net/gh/AdguardTeam/cname-trackers@master/data/combined_disguised_ads_justdomains.txt',
    mirrorUrls: [
      'https://raw.githubusercontent.com/AdguardTeam/cname-trackers/master/data/combined_disguised_ads_justdomains.txt',
    ],
    description: '隐藏的广告 CNAME 追踪器',
  },

  {
    name: 'AdGuard CNAME Trackers',
    url: 'https://cdn.jsdelivr.net/gh/AdguardTeam/cname-trackers@master/data/combined_disguised_trackers_justdomains.txt',
    mirrorUrls: [
      'https://raw.githubusercontent.com/AdguardTeam/cname-trackers/master/data/combined_disguised_trackers_justdomains.txt',
    ],
    description: '隐藏的追踪器 CNAME',
  },

  {
    name: 'AdGuard CNAME Microsites',
    url: 'https://cdn.jsdelivr.net/gh/AdguardTeam/cname-trackers@master/data/combined_disguised_microsites_justdomains.txt',
    mirrorUrls: [
      'https://raw.githubusercontent.com/AdguardTeam/cname-trackers/master/data/combined_disguised_microsites_justdomains.txt',
    ],
    description: '隐藏的微站点 CNAME',
  },
];

/**
 * AdGuard 白名单过滤器
 */
export const ADGUARD_WHITELIST_FILTERS: AdGuardFilterConfig[] = [
  {
    name: 'AdGuard DNS Filter Exceptions',
    url: 'https://adguardteam.github.io/AdGuardSDNSFilter/Filters/exceptions.txt',
    mirrorUrls: [
      'https://raw.githubusercontent.com/AdguardTeam/AdGuardSDNSFilter/master/Filters/exceptions.txt',
    ],
    description: 'AdGuard DNS 过滤器例外',
  },

  {
    name: 'AdGuard DNS Filter Exclusions',
    url: 'https://adguardteam.github.io/AdGuardSDNSFilter/Filters/exclusions.txt',
    mirrorUrls: [
      'https://raw.githubusercontent.com/AdguardTeam/AdGuardSDNSFilter/master/Filters/exclusions.txt',
    ],
    description: 'AdGuard DNS 过滤器排除',
  },
];

/**
 * 预定义白名单（参考 Surge-master-2）
 */
export const PREDEFINED_WHITELIST = [
  // 崩溃报告服务
  'sts.online.visualstudio.com',
  '.ingest.sentry.io',
  '.sessions.bugsnag.com',
  '.notify.bugsnag.com',
  '.metric.gstatic.com',
  'telemetry.nextjs.org',
  '.crashlytics2.l.google.com',
  '.crashlyticsreports-pa.googleapis.com',

  // 本地域名
  '.localhost',
  '.local',
  '.localdomain',

  // 误报修正
  'analytics.google.com',
  '.t.co',
  'api.xiaomi.com',
  '.statsig.com',
  'm.stripe.com',

  // CDN 反向 DNS
  '.compute.amazonaws.com',
  '.bc.googleusercontent.com',

  // 其他白名单...
];

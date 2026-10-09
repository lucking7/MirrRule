import type { RuleGroup, SpecialRuleConfig } from './rule-source-types';

export const ruleGroups: RuleGroup[] = [
  {
    name: 'Streaming',
    description: 'Global streaming media platforms',
    defaultPolicy: null, // 无策略，用户自定义
    targets: ['surge', 'clash', 'singbox', 'loon'], // 流媒体支持更多平台
    files: [
      /**
      {
        path: 'List/stream/video/emby.list',
        url: 'https://github.com/Repcz/Tool/raw/X/Surge/Rules/Emby.list',
        description: 'This file contains rules for EmbyServer.',
      },
      */
      {
        path: 'List/biliintl.list',
        url: 'https://ruleset.skk.moe/List/non_ip/stream_biliintl.conf',
      },
      {
        path: 'List/streaming_cn.list',
        url: 'https://github.com/ConnersHua/RuleGo/raw/master/Surge/Ruleset/Extra/Streaming/CN.list',
      },
      {
        path: 'List/streaming_!cn.list',
        url: 'https://github.com/ConnersHua/RuleGo/raw/master/Surge/Ruleset/Extra/Streaming/!CN.list',
      },
    ],
  },
  {
    name: 'Reject',
    description: 'Ad blocking and privacy protection rules',
    defaultPolicy: null, // 无策略，生成纯拦截规则
    targets: ['surge', 'clash', 'singbox', 'loon'], // 广告拦截支持多平台
    files: [
      {
        path: 'List/reject-fmz.list',
        url: 'https://raw.githubusercontent.com/fmz200/wool_scripts/main/QuantumultX/filter/filter.list',
        sourcePolicies: ['reject'],
        validate: true,
      },
      {
        path: 'List/reject-no-drop.list',
        url: 'https://ruleset.skk.moe/List/non_ip/reject-no-drop.conf',
      },
      {
        path: 'List/reject-drop.list',
        url: 'https://ruleset.skk.moe/List/non_ip/reject-drop.conf',
      },
    ],
  },
  {
    name: 'Direct',
    description: 'Direct-only routing corrections from fmz200, without upstream proxy exceptions',
    defaultPolicy: null,
    targets: ['surge', 'clash', 'singbox', 'loon'],
    files: [
      {
        path: 'List/direct-fmz.list',
        url: 'https://raw.githubusercontent.com/fmz200/wool_scripts/main/QuantumultX/filter/filterFix.list',
        sourcePolicies: ['direct'],
        validate: true,
      },
    ],
  },
  {
    name: 'CDN',
    targets: ['surge', 'clash', 'singbox', 'loon'],
    files: [
      {
        path: 'List/download_global.list',
        url: 'https://raw.githubusercontent.com/Repcz/Tool/X/Surge/Rules/DownloadCDN_Global.list',
      },
      {
        path: 'List/download_cn.list',
        url: 'https://raw.githubusercontent.com/Repcz/Tool/X/Surge/Rules/DownloadCDN_CN.list',
      },
    ],
  },
  {
    name: 'CN-IPCIDR',
    targets: ['surge', 'clash', 'singbox', 'loon'],
    files: [
      {
        path: 'List/china_ip.list',
        url: 'https://ruleset.skk.moe/List/ip/china_ip.conf',
      },
      {
        path: 'List/china_ip_ipv6.list',
        url: 'https://ruleset.skk.moe/List/ip/china_ip_ipv6.conf',
      },
      {
        path: 'List/china_asn.list',
        url: 'https://raw.githubusercontent.com/missuo/ASN-China/main/ASN.China.list',
        title: 'Ruleset - Mainland China ASNs (Missuo)',
        description:
          'This file contains IP-ASN routes for mainland China networks maintained by missuo/ASN-China',
        keepComments: true, // 保留行首注释（// 格式的注释行）
        keepInlineComments: true, // 保留行内注释（规则后的 // 注释）- 提高可读性
        validate: false, // 禁用规则验证 - 保留原始格式
      },
    ],
  },
  {
    name: 'Extra',
    targets: ['surge', 'clash', 'singbox', 'loon'],
    files: [
      {
        path: 'List/speedtest_china.list',
        url: 'https://kelee.one/Tool/Loon/Lsr/SpeedtestChina.lsr',
      },
      {
        path: 'List/speedtest_international.list',
        url: 'https://kelee.one/Tool/Loon/Lsr/SpeedtestInternational.lsr',
      },
      {
        path: 'List/speedtest.list',
        url: 'https://ruleset.skk.moe/List/domainset/speedtest.conf',
      },
    ],
  },
  {
    name: 'Proxy',
    description: 'Global proxy rules for international services',
    defaultPolicy: null, // 无策略，用户配置决定
    targets: ['surge', 'clash', 'singbox', 'loon'],
    files: [
      {
        path: 'List/my_proxy.list',
        url: 'https://ruleset.skk.moe/List/non_ip/my_proxy.conf',
      },
      {
        path: 'List/my_git.list',
        url: 'https://ruleset.skk.moe/List/non_ip/my_git.conf',
      },
      {
        path: 'List/my_us.list',
        url: 'https://ruleset.skk.moe/List/non_ip/my_us.conf',
      },
      {
        path: 'List/my_tw.list',
        url: 'https://ruleset.skk.moe/List/non_ip/my_tw.conf',
      },
      {
        path: 'List/my_plus.list',
        url: 'https://ruleset.skk.moe/List/non_ip/my_plus.conf',
      },
      {
        path: 'List/global.list',
        url: 'https://ruleset.skk.moe/List/non_ip/global.conf',
        keepComments: true,
        applyNoResolve: true,
      },
    ],
  },
];

const BLACKMATRIX_SURGE = 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Surge';
const META_RULES = 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo';

const geositeSubscriptions: SpecialRuleConfig[] = [
  { name: 'Container Registries', id: 'container', category: 'category-container' },
  { name: 'Discord', id: 'discord', category: 'discord' },
  { name: 'Scholar', id: 'scholar', category: 'category-scholar-!cn' },
].map(({ name, id, category }): SpecialRuleConfig => ({
  name,
  targetFile: `List/${id}.list`,
  sourceFiles: [
    `https://raw.githubusercontent.com/lucking7/surge-rules-dat/release/geo/geosite/${category}.list`,
  ],
  // Keep independent policies; the released text omits unsupported DOMAIN-REGEX entries.
  description: 'Independent domain subscription from surge-rules-dat, without unsupported rule approximations.',
  targets: ['surge', 'clash', 'singbox', 'loon'],
  defaultPolicy: null,
}));

// Keep service subscriptions separate from the existing regional/aggregate rulesets.
const serviceRules: SpecialRuleConfig[] = [
  { name: 'Netflix', id: 'netflix', blackmatrix: 'Netflix', geosite: 'netflix', geoip: 'netflix' },
  { name: 'Disney', id: 'disney', blackmatrix: 'Disney', geosite: 'disney' },
  { name: 'Spotify', id: 'spotify', blackmatrix: 'Spotify', geosite: 'spotify' },
  { name: 'Prime Video', id: 'primevideo', blackmatrix: 'AmazonPrimeVideo', geosite: 'primevideo' },
  { name: 'YouTube', id: 'youtube', blackmatrix: 'YouTube', geosite: 'youtube' },
  { name: 'BiliBili', id: 'bilibili', blackmatrix: 'BiliBili', geosite: 'bilibili' },
  { name: 'TikTok', id: 'tiktok', blackmatrix: 'TikTok', geosite: 'tiktok' },
  // Meta has no dedicated WeChat category; do not merge the broader Tencent category.
  { name: 'WeChat', id: 'wechat', blackmatrix: 'WeChat' },
  { name: 'Google', id: 'google', blackmatrix: 'Google', geosite: 'google' },
  { name: 'GitHub', id: 'github', blackmatrix: 'GitHub', geosite: 'github' },
].map(({ name, id, blackmatrix, geosite, geoip }): SpecialRuleConfig => ({
  name,
  targetFile: `List/${id}.list`,
  sourceFiles: [
    `${BLACKMATRIX_SURGE}/${blackmatrix}/${blackmatrix}.list`,
    ...(geosite ? [`${META_RULES}/geosite/${geosite}.list`] : []),
    ...(geoip ? [`${META_RULES}/geoip/${geoip}.list`] : []),
  ],
  description: 'Service rules from blackmatrix7, merged with available MetaCubeX domain and IP categories.',
  targets: ['surge', 'clash', 'singbox', 'loon'],
  defaultPolicy: null,
  applyNoResolve: true,
}));

const sukkaAdditionalRules: SpecialRuleConfig[] = [
  { name: 'Apple CDN', id: 'apple_cdn', sources: ['domainset/apple_cdn'] },
  { name: 'Apple China', id: 'apple_cn', sources: ['non_ip/apple_cn'] },
  { name: 'Apple Services', id: 'apple_services', sources: ['non_ip/apple_services'] },
  { name: 'Apple Services IP', id: 'apple_services_ip', sources: ['ip/apple_services'] },
  { name: 'iCloud Private Relay', id: 'icloud_private_relay', sources: ['domainset/icloud_private_relay'] },
  { name: 'Apple Intelligence', id: 'apple_intelligence', sources: ['non_ip/apple_intelligence'] },
  { name: 'Microsoft CDN', id: 'microsoft_cdn', sources: ['non_ip/microsoft_cdn'] },
  { name: 'Game Download', id: 'game_download', sources: ['domainset/game-download'] },
  ...['us', 'hk', 'jp', 'tw', 'kr', 'eu'].map(region => ({
    name: `Streaming - ${region.toUpperCase()}`,
    id: `stream_${region}`,
    sources: [`non_ip/stream_${region}`],
  })),
  { name: 'Reject Phishing', id: 'reject_phishing', sources: ['domainset/reject_phishing'] },
  // Publish this optional source with the Surge MITM module; other platforms are not verified.
  { name: 'Reject URL Regex', id: 'reject_url_regex', sources: ['non_ip/reject-url-regex'], surgeOnly: true },
  { name: 'Domestic CDN', id: 'domestic_cdn', sources: ['non_ip/domestic_cdn'] },
  { name: 'GitLab', id: 'gitlab', sources: ['non_ip/gitlab'] },
  { name: 'Sogou Input', id: 'sogouinput', sources: ['non_ip/sogouinput'] },
  // Keep process/source-IP conditions intact; other writers cannot preserve this ruleset.
  { name: 'CloudMounter / RaiDrive', id: 'cloudmounter', sources: ['non_ip/cloudmounter'], surgeOnly: true },
].map(({ name, id, sources, surgeOnly }): SpecialRuleConfig => ({
  name,
  targetFile: `List/${id}.list`,
  sourceFiles: sources.map(source => `https://ruleset.skk.moe/List/${source}.conf`),
  targets: surgeOnly ? ['surge'] : ['surge', 'clash', 'singbox', 'loon'],
  defaultPolicy: null,
  applyNoResolve: true,
}));

export const specialRules: SpecialRuleConfig[] = [
  ...geositeSubscriptions,
  ...sukkaAdditionalRules,
  ...serviceRules,
  {
    name: 'Download',
    targetFile: 'List/download.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/domainset/download.conf',
      'https://ruleset.skk.moe/List/non_ip/download.conf',
      'https://ruleset.skk.moe/List/ip/download.conf',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'],
    keepComments: false,
    deleteSourceFiles: true,
  },
  {
    name: 'CDN',
    targetFile: 'List/cdn.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/domainset/cdn.conf',
      'https://ruleset.skk.moe/List/non_ip/cdn.conf',
      'https://ruleset.skk.moe/List/ip/cdn.conf',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'],
    keepComments: false,
    applyNoResolve: true,
    deleteSourceFiles: true,
  },
  {
    name: 'AI',
    targetFile: 'List/ai.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/non_ip/ai.conf',
      `${BLACKMATRIX_SURGE}/OpenAI/OpenAI.list`,
      'https://ruleset.skk.moe/List/ip/ai.conf',
      'https://github.com/ConnersHua/RuleGo/raw/master/Surge/Ruleset/Extra/AI.list',
      'https://github.com/dler-io/Rules/raw/main/Surge/Surge%203/Provider/AI%20Suite.list',
      // Use Meta's text geosite format; the JSON path cannot preserve every field.
      `${META_RULES}/geosite/category-ai-!cn.list`,
    ],
    defaultPolicy: null, // 无策略，纯RULE-SET格式
    targets: ['surge', 'clash', 'singbox', 'loon'], // 多平台支持
    keepComments: false,
    deleteSourceFiles: true,
  },
  {
    name: 'Apple',
    targetFile: 'List/apple.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/non_ip/apple_services.conf',
      'https://ruleset.skk.moe/List/non_ip/apple_cn.conf',
      'https://ruleset.skk.moe/List/domainset/apple_cdn.conf',
      'https://ruleset.skk.moe/List/ip/apple_services.conf',
      'https://ruleset.skk.moe/List/domainset/icloud_private_relay.conf',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'],
    keepComments: false,
    applyNoResolve: true,
  },
  {
    name: 'Microsoft',
    targetFile: 'List/microsoft.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/non_ip/microsoft.conf',
      'https://ruleset.skk.moe/List/non_ip/microsoft_cdn.conf',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'],
    keepComments: false,
    applyNoResolve: true,
  },
  {
    name: 'Amazon',
    targetFile: 'List/amazon.list',
    sourceFiles: [
      'https://github.com/MetaCubeX/meta-rules-dat/raw/meta/geo/geosite/amazon.list',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'],
    keepComments: false,
  },
  {
    name: 'Reject',
    targetFile: 'List/ads.list',
    sourceFiles: [
      'https://github.com/ConnersHua/RuleGo/raw/master/Surge/Ruleset/Extra/Reject/Advertising.list',
      'https://github.com/ConnersHua/RuleGo/raw/master/Surge/Ruleset/Extra/Reject/Malicious.list',
      'https://github.com/ConnersHua/RuleGo/raw/master/Surge/Ruleset/Extra/Reject/Tracking.list',
      'https://raw.githubusercontent.com/TG-Twilight/AWAvenue-Ads-Rule/main/Filters/AWAvenue-Ads-Rule-Surge.list',
      // 'https://raw.githubusercontent.com/privacy-protection-tools/anti-AD/master/anti-ad-surge.txt',
      // 'https://raw.githubusercontent.com/Cats-Team/AdRules/main/adrules.list',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'], // 多平台支持
  },
  {
    name: 'lucking - Reject',
    targetFile: 'List/reject.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/domainset/reject.conf',
      'https://ruleset.skk.moe/List/non_ip/reject.conf',
      'https://ruleset.skk.moe/List/ip/reject.conf',
      'https://ruleset.skk.moe/List/non_ip/my_reject.conf',
    ],
    defaultPolicy: 'REJECT', // 明确指定拒绝策略
    targets: ['surge', 'clash', 'singbox', 'loon'], // 多平台支持
    keepComments: false,
    applyNoResolve: true,
    deleteSourceFiles: true,
  },
  {
    name: 'lucking - Reject Extra',
    targetFile: 'List/reject_extra.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/domainset/reject_extra.conf',
      ...sukkaAdditionalRules
        .filter(rule => rule.targetFile === 'List/reject_phishing.list')
        .flatMap(rule => rule.sourceFiles),
    ],
    defaultPolicy: 'REJECT',
    targets: ['surge', 'clash', 'singbox', 'loon'],
    keepComments: false,
    applyNoResolve: true,
    deleteSourceFiles: true,
  },

  {
    name: 'Emby',
    targetFile: 'List/emby.list',
    sourceFiles: [
      'https://github.com/kefengyoyo/own/raw/main/Emby-P.list',
      'https://github.com/Repcz/Tool/raw/X/Surge/Custom/Emby.list',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'],
    keepComments: true,
    applyNoResolve: true,
    // Drop unrecoverable garbage; YAML list markers are stripped earlier.
    validate: true,
    deleteSourceFiles: false,
  },
  {
    name: 'NeteaseMusic',
    targetFile: 'List/neteasemusic.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/non_ip/neteasemusic.conf',
      'https://ruleset.skk.moe/List/ip/neteasemusic.conf',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'],
    deleteSourceFiles: true,
  },
  {
    name: 'Streaming',
    targetFile: 'List/stream.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/non_ip/stream.conf',
      'https://ruleset.skk.moe/List/ip/stream.conf',
      ...sukkaAdditionalRules
        .filter(rule => rule.targetFile.startsWith('List/stream_'))
        .flatMap(rule => rule.sourceFiles),
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'],
    applyNoResolve: true,
  },
  {
    name: 'lucking - Domestic',
    targetFile: 'List/domestic.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/non_ip/domestic.conf',
      'https://ruleset.skk.moe/List/ip/domestic.conf',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'],
    keepComments: false,
  },
  {
    name: 'Telegram',
    targetFile: 'List/telegram.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/non_ip/telegram.conf',
      'https://ruleset.skk.moe/List/ip/teleproto.conf',
      'https://ruleset.skk.moe/List/ip/telegram_asn.conf',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'],
  },
  {
    name: 'lucking - Direct',
    targetFile: 'List/direct.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/non_ip/my_direct.conf',
      'https://ruleset.skk.moe/List/non_ip/direct.conf',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'],
  },
  {
    name: 'Lan',
    targetFile: 'List/lan.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/non_ip/lan.conf',
      'https://ruleset.skk.moe/List/ip/lan.conf',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'],
  },
];

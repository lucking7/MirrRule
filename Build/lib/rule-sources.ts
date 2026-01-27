import type { FileConfig, RuleGroup, SpecialRuleConfig } from './rule-source-types';
import path from 'node:path';

const currentDir = path.dirname(__filename);
export const REPO_PATH = path.join(currentDir, '../../..');

export const DEFAULT_FILE_CONFIG = {
  validate: false,
  dedup: true,
  sort: true,
  keepComments: false,
  keepEmptyLines: false,
  keepInlineComments: false,
  formatConversion: true,
  applyNoResolve: false,
} as const;

export function applyDefaultConfig<T extends Partial<FileConfig>>(
  fileConfig: T
): T & typeof DEFAULT_FILE_CONFIG {
  return { ...DEFAULT_FILE_CONFIG, ...fileConfig };
}

export const ruleGroups: RuleGroup[] = [
  {
    name: 'Streaming',
    description: 'Global streaming media platforms',
    defaultPolicy: null, // 无策略，用户自定义
    targets: ['surge', 'clash', 'singbox', 'loon'], // 流媒体支持更多平台
    files: [
      applyDefaultConfig({
        path: 'List/netflix.list',
        url: 'https://rule.kelee.one/Loon/Netflix.lsr',
      }),
      applyDefaultConfig({
        path: 'List/disney.list',
        url: 'https://rule.kelee.one/Loon/Disney.lsr',
      }),
      applyDefaultConfig({
        path: 'List/spotify.list',
        url: 'https://rule.kelee.one/Loon/Spotify.lsr',
      }),
      applyDefaultConfig({
        path: 'List/primevideo.list',
        url: 'https://rule.kelee.one/Loon/PrimeVideo.lsr',
      }),
      applyDefaultConfig({
        path: 'List/youtube.list',
        url: 'https://rule.kelee.one/Loon/YouTube.lsr',
      }),
      /**
      applyDefaultConfig({
        path: 'List/stream/video/emby.list',
        url: 'https://github.com/Repcz/Tool/raw/X/Surge/Rules/Emby.list',
        description: 'This file contains rules for EmbyServer.',
      }),
      */
      applyDefaultConfig({
        path: 'List/biliintl.list',
        url: 'https://ruleset.skk.moe/List/non_ip/stream_biliintl.conf',
      }),
      applyDefaultConfig({
        path: 'List/bilibili.list',
        url: 'https://rule.kelee.one/Loon/BiliBili.lsr',
      }),
      applyDefaultConfig({
        path: 'List/tiktok.list',
        url: 'https://kelee.one/Tool/Loon/Lsr/TikTok.lsr',
      }),
      applyDefaultConfig({
        path: 'List/streaming_cn.list',
        url: 'https://github.com/ConnersHua/RuleGo/raw/master/Surge/Ruleset/Extra/Streaming/CN.list',
      }),
      applyDefaultConfig({
        path: 'List/streaming_!cn.list',
        url: 'https://github.com/ConnersHua/RuleGo/raw/master/Surge/Ruleset/Extra/Streaming/!CN.list',
      }),
    ],
  },
  {
    name: 'Reject',
    description: 'Ad blocking and privacy protection rules',
    defaultPolicy: null, // 无策略，生成纯拦截规则
    targets: ['surge', 'clash', 'singbox', 'loon'], // 广告拦截支持多平台
    files: [
      applyDefaultConfig({
        path: 'List/Reject-fmz.list',
        url: 'https://github.com/fmz200/wool_scripts/raw/main/QuantumultX/filter/filter.list',
        keepComments: false,
        dedup: true,
        sort: true,
        validate: true,
        keepEmptyLines: false,
        deleteSourceFiles: true,
      }),
      applyDefaultConfig({
        path: 'List/reject-no-drop.list',
        url: 'https://ruleset.skk.moe/List/non_ip/reject-no-drop.conf',
      }),
      applyDefaultConfig({
        path: 'List/reject-drop.list',
        url: 'https://ruleset.skk.moe/List/non_ip/reject-drop.conf',
      }),
    ],
  },
  {
    name: 'Direct',
    description: 'Rules for direct connection without proxy',
    defaultPolicy: 'DIRECT',
    targets: ['surge', 'clash', 'singbox', 'loon'],
    files: [
      applyDefaultConfig({
        path: 'List/Direct-fmz.list',
        url: 'https://github.com/fmz200/wool_scripts/raw/main/QuantumultX/filter/filterFix.list',
        keepComments: false,
        dedup: true,
        sort: true,
        validate: true,
        keepEmptyLines: false,
        deleteSourceFiles: true,
      }),
    ],
  },
  {
    name: 'Domestic',
    description: 'China mainland services and websites',
    defaultPolicy: null, // 无策略，纯规则格式
    targets: ['surge', 'clash', 'singbox', 'loon'],
    files: [
      applyDefaultConfig({
        path: 'List/wechat.list',
        url: 'https://rule.kelee.one/Loon/WeChat.lsr',
      }),
    ],
  },
  {
    name: 'CDN',
    targets: ['surge', 'clash', 'singbox', 'loon'],
    files: [
      applyDefaultConfig({
        path: 'List/download_global.list',
        url: 'https://kelee.one/Tool/Loon/Lsr/InternationalDownloadCDN.lsr',
      }),
      applyDefaultConfig({
        path: 'List/download_cn.list',
        url: 'https://kelee.one/Tool/Loon/Lsr/ChinaDownloadCDN.lsr',
      }),
    ],
  },
  {
    name: 'CN-IPCIDR',
    targets: ['surge', 'clash', 'singbox', 'loon'],
    files: [
      applyDefaultConfig({
        path: 'List/china_ip.list',
        url: 'https://ruleset.skk.moe/List/ip/china_ip.conf',
      }),
      applyDefaultConfig({
        path: 'List/china_ip_ipv6.list',
        url: 'https://ruleset.skk.moe/List/ip/china_ip_ipv6.conf',
      }),
      applyDefaultConfig({
        path: 'List/china_asn.list',
        url: 'https://raw.githubusercontent.com/missuo/ASN-China/main/ASN.China.list',
        title: 'Ruleset - Mainland China ASNs (Missuo)',
        description:
          'This file contains IP-ASN routes for mainland China networks maintained by missuo/ASN-China',
        keepComments: true, // 保留行首注释（// 格式的注释行）
        keepInlineComments: true, // 保留行内注释（规则后的 // 注释）- 提高可读性
        dedup: false, // 禁用去重 - 保持原始顺序
        sort: false, // 禁用排序 - 保持原始顺序
        validate: false, // 禁用规则验证 - 保留原始格式
        keepEmptyLines: false, // 不保留空行 - 减小文件体积
      }),
    ],
  },
  {
    name: 'Extra',
    targets: ['surge', 'clash', 'singbox', 'loon'],
    files: [
      applyDefaultConfig({
        path: 'List/speedtest_china.list',
        url: 'https://kelee.one/Tool/Loon/Lsr/SpeedtestChina.lsr',
      }),
      applyDefaultConfig({
        path: 'List/speedtest_international.list',
        url: 'https://kelee.one/Tool/Loon/Lsr/SpeedtestInternational.lsr',
      }),
      applyDefaultConfig({
        path: 'List/speedtest.list',
        url: 'https://ruleset.skk.moe/List/domainset/speedtest.conf',
      }),
    ],
  },
  {
    name: 'Proxy',
    description: 'Global proxy rules for international services',
    defaultPolicy: null, // 无策略，用户配置决定
    targets: ['surge', 'clash', 'singbox', 'loon'],
    files: [
      applyDefaultConfig({
        path: 'List/my_proxy.list',
        url: 'https://ruleset.skk.moe/List/non_ip/my_proxy.conf',
      }),
      applyDefaultConfig({
        path: 'List/my_git.list',
        url: 'https://ruleset.skk.moe/List/non_ip/my_git.conf',
      }),
      applyDefaultConfig({
        path: 'List/my_us.list',
        url: 'https://ruleset.skk.moe/List/non_ip/my_us.conf',
      }),
      applyDefaultConfig({
        path: 'List/my_tw.list',
        url: 'https://ruleset.skk.moe/List/non_ip/my_tw.conf',
      }),
      applyDefaultConfig({
        path: 'List/my_plus.list',
        url: 'https://ruleset.skk.moe/List/non_ip/my_plus.conf',
      }),
      applyDefaultConfig({
        path: 'List/global.list',
        url: 'https://ruleset.skk.moe/List/non_ip/global.conf',
        keepComments: true,
        formatConversion: true,
        applyNoResolve: true,
      }),
    ],
  },
  {
    name: 'Google',
    targets: ['surge', 'clash', 'singbox', 'loon'],
    files: [
      applyDefaultConfig({
        path: 'List/google.list',
        url: 'https://rule.kelee.one/Loon/Google.lsr',
      }),
    ],
  },
  {
    name: 'Github',
    targets: ['surge', 'clash', 'singbox', 'loon'],
    files: [
      applyDefaultConfig({
        path: 'List/github.list',
        url: 'https://rule.kelee.one/Loon/GitHub.lsr',
      }),
    ],
  },
];

export const specialRules: SpecialRuleConfig[] = [
  {
    name: 'Download',
    targetFile: 'List/download.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/domainset/download.conf',
      'https://ruleset.skk.moe/List/non_ip/download.conf',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'], dedup: true,
    sort: true,
    keepComments: false,
    keepEmptyLines: false,
    formatConversion: true,
    deleteSourceFiles: true,
    header: {
      enable: true,
      title: 'Ruleset - Large Files Hosting',
      description: 'This file contains ruleset for software updating & large file hosting.',
    },
  },
  {
    name: 'CDN',
    targetFile: 'List/cdn.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/domainset/cdn.conf',
      'https://ruleset.skk.moe/List/non_ip/cdn.conf',
      'https://ruleset.skk.moe/List/ip/cdn.conf',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'], dedup: true,
    sort: true,
    keepComments: false,
    keepEmptyLines: false,
    formatConversion: true,
    applyNoResolve: true,
    deleteSourceFiles: true,
    header: {
      enable: true,
      title: 'Ruleset - CDN',
      description: 'This file contains object storage and static assets CDN ruleset.',
    },
  },
  {
    name: 'AI',
    targetFile: 'List/ai.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/non_ip/ai.conf',
      'https://kelee.one/Tool/Loon/Lsr/AI.lsr',
      'https://github.com/ConnersHua/RuleGo/raw/master/Surge/Ruleset/Extra/AI.list',
      'https://github.com/dler-io/Rules/raw/main/Surge/Surge%203/Provider/AI%20Suite.list',
      // MetaCubeX sing-box 格式 AI 规则（自动转换为 Surge 格式）
      'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/category-ai-!cn.json',
      // 自定义 AI 规则补充（TS 模块，支持注释和分组）
      path.join(REPO_PATH, 'Source/ai-custom.ts'),
    ],
    defaultPolicy: null, // 无策略，纯RULE-SET格式
    targets: ['surge', 'clash', 'singbox', 'loon'], // 多平台支持
    dedup: true,
    sort: true,
    keepComments: false,
    deleteSourceFiles: true,
    header: {
      enable: true,
      title: 'Ruleset - AIGC',
      description:
        'This file contains rules for generative AI platforms including OpenAI, Google Gemini, Claude, Grok and etc.',
    },
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
    targets: ['surge', 'clash', 'singbox', 'loon'], dedup: true,
    sort: true,
    keepComments: false,
    keepEmptyLines: false,
    applyNoResolve: true,
    formatConversion: true,
    header: {
      enable: true,
      title: 'Ruleset - Apple',
      description:
        'This file contains rules for Apple services worldwide, including mainland China deployments such as iCloud.com.cn and Apple Maps CN',
    },
  },
  {
    name: 'Microsoft',
    targetFile: 'List/microsoft.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/non_ip/microsoft.conf',
      'https://ruleset.skk.moe/List/non_ip/microsoft_cdn.conf',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'], dedup: true,
    sort: true,
    keepComments: false,
    keepEmptyLines: false,
    applyNoResolve: true,
    formatConversion: true,
    header: {
      enable: true,
      title: 'Ruleset - Microsoft',
      description:
        'This file contains ruleset for Microsoft 365, Teams, Azure, and other Microsoft services, including mainland China tenants',
    },
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
    dedup: true,
    sort: true,
    formatConversion: true, // 启用格式转换,将 domain-set 格式(.example.com)转换为 rule-set 格式(DOMAIN-SUFFIX,example.com)
    header: {
      enable: true,
      title: 'Ruleset - Advertising, Malware & Tracking Protection',
      description: 'This file contains combined rulesets for advertising, malicious and tracking.',
    },
  },
  {
    name: 'lucking - Reject',
    targetFile: 'List/reject.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/domainset/reject.conf',
      'https://ruleset.skk.moe/List/non_ip/reject.conf',
      'https://ruleset.skk.moe/List/domainset/reject_extra.conf',
      'https://ruleset.skk.moe/List/ip/reject.conf',
      'https://ruleset.skk.moe/List/non_ip/my_reject.conf',
    ],
    defaultPolicy: 'REJECT', // 明确指定拒绝策略
    targets: ['surge', 'clash', 'singbox', 'loon'], // 多平台支持
    dedup: true,
    sort: true,
    keepComments: false,
    keepEmptyLines: false,
    applyNoResolve: true,
    formatConversion: true,
    deleteSourceFiles: true,
    header: {
      enable: true,
      title: 'Ruleset - Privacy & Security Protection',
      description:
        'This file contains rulesets covering advertising, telemetry, malware, and phishing infrastructure',
    },
  },

  {
    name: 'Emby',
    targetFile: 'List/emby.list',
    sourceFiles: [
      'https://github.com/kefengyoyo/own/raw/main/Emby-P.list',
      'https://github.com/Repcz/Tool/raw/X/Surge/Custom/Emby.list',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'], dedup: true,
    sort: false,
    keepComments: true,
    formatConversion: true, // 启用格式转换,确保跨平台规则兼容性
    applyNoResolve: true,
    deleteSourceFiles: false,
    header: {
      enable: true,
      title: 'Ruleset - Emby Media Servers',
      description:
        'This file contains rules for third-party Emby media servers that require proxy access',
    },
  },
  {
    name: 'NeteaseMusic',
    targetFile: 'List/neteasemusic.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/non_ip/neteasemusic.conf',
      'https://ruleset.skk.moe/List/ip/neteasemusic.conf',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'], dedup: true,
    sort: true,
    deleteSourceFiles: true,
    header: {
      enable: true,
      title: 'Ruleset - NetEase Cloud Music',
      description: 'This file contains ruleset for Netease Music.',
    },
  },
  {
    name: 'Streaming',
    targetFile: 'List/stream.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/non_ip/stream.conf',
      'https://ruleset.skk.moe/List/ip/stream.conf',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'], header: {
      enable: true,
      title: 'Ruleset - Global Streaming Services',
      description:
        'This file contains ruleset for streaming platforms such as Netflix, Disney+, HBO, Amazon Prime, Spotify, YouTube, Twitch, BBC, and Hulu',
    },
  },
  {
    name: 'lucking - Domestic',
    targetFile: 'List/domestic.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/non_ip/domestic.conf',
      'https://ruleset.skk.moe/List/ip/domestic.conf',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'], dedup: true,
    sort: true,
    keepComments: false,
    keepEmptyLines: false,
    header: {
      enable: true,
      title: 'Ruleset - Domestic',
      description: 'This file contains known addresses that are avaliable in the Mainland China.',
    },
  },
  {
    name: 'Telegram',
    targetFile: 'List/telegram.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/non_ip/telegram.conf',
      'https://ruleset.skk.moe/List/ip/telegram.conf',
      'https://ruleset.skk.moe/List/ip/telegram_asn.conf',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'], dedup: true,
    sort: true,
    header: {
      enable: true,
      title: 'Ruleset - Telegram',
      description: 'This file contains domains, IP ranges, and ASN resources used by Telegram',
    },
  },
  {
    name: 'lucking - Direct',
    targetFile: 'List/direct.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/non_ip/my_direct.conf',
      'https://ruleset.skk.moe/List/non_ip/direct.conf',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'], dedup: true,
    sort: true,
    header: {
      enable: true,
      title: 'Ruleset - Direct Connection',
      description:
        'This file contains domains, processes, and apps that should always connect directly without a proxy',
    },
  },
  {
    name: 'Lan',
    targetFile: 'List/lan.list',
    sourceFiles: [
      'https://ruleset.skk.moe/List/non_ip/lan.conf',
      'https://ruleset.skk.moe/List/ip/lan.conf',
    ],
    targets: ['surge', 'clash', 'singbox', 'loon'], dedup: true,
    sort: false,
    header: {
      enable: true,
      title: 'Ruleset - Local Area Network',
      description:
        'This file contains LAN address ranges, private IP blocks, and reserved TLDs kept on intranet paths',
    },
  },
];

export const ruleGroupDefaults = {
  keepComments: true,
  dedup: true,
  sort: false,
  validate: true,
  keepEmptyLines: true,
};

export const specialRuleDefaults = {
  keepComments: false,
  dedup: true,
  sort: true,
  validate: true,
  keepEmptyLines: false,
  deleteSourceFiles: true,
};

export const config = {
  repoPath: REPO_PATH,
  defaultFormat: 'Surge',
  deleteSourceFiles: true,
  stats: true,
  converter: { format: 'Surge' },
};

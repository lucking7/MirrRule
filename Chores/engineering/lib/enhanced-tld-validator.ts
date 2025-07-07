import tldts from 'tldts';
import { normalizeTldtsOpt, strictTldtsOpt } from './constants/tldts-options.js';
import picocolors from 'picocolors';

/**
 * 规则来源类型
 */
export enum RuleSource {
  AdGuardFilter = 'adguard', // AdGuard 过滤器（严格模式）
  LocalFile = 'local', // 本地规则文件（宽松模式）
  RemoteList = 'remote', // 远程域名列表（宽松模式）
  Unknown = 'unknown', // 未知来源（默认宽松模式）
}

/**
 * TLD 验证结果
 */
export interface TldValidationResult {
  valid: boolean;
  reason?: string;
  publicSuffix?: string | undefined;
  isIcann?: boolean | null;
  isPrivate?: boolean | null;
}

/**
 * 验证选项
 */
export interface ValidationOptions {
  source: RuleSource;
  whitelist?: string[]; // 额外的白名单
}

// 参考 Surge-master-2 的 ICP TLD 白名单
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

// 特殊用途 TLD（不应该被判定为非法）
const SPECIAL_PURPOSE_TLD = [
  'localhost',
  'local',
  'localdomain',
  'test',
  'example',
  'invalid',
  'lan',
  'home',
  'corp',
  'mail',
  'internal',
];

/**
 * 增强的 TLD 验证器
 * 根据规则来源使用不同的验证策略
 */
export class EnhancedTldValidator {
  private icpTldSet: Set<string>;
  private specialTldSet: Set<string>;

  constructor() {
    this.icpTldSet = new Set(ICP_TLD);
    this.specialTldSet = new Set(SPECIAL_PURPOSE_TLD);
  }

  /**
   * 验证域名的 TLD 合法性
   */
  validate(domain: string, options: ValidationOptions): TldValidationResult {
    // 基本检查
    if (!domain || typeof domain !== 'string') {
      return { valid: false, reason: '无效的域名' };
    }

    // 根据来源选择解析选项
    // 注意：无论哪种模式，都需要使用 allowPrivateDomains: true 来正确识别私有后缀
    // 然后根据来源决定是否接受私有后缀
    const tldtsOpt = normalizeTldtsOpt; // 都使用宽松模式解析，然后根据来源判断

    // 解析域名
    const parsed = tldts.parse(domain, tldtsOpt);

    // 没有有效的 publicSuffix
    if (!parsed.publicSuffix) {
      return {
        valid: false,
        reason: '无法解析有效的 TLD',
        publicSuffix: undefined,
        isIcann: parsed.isIcann,
        isPrivate: parsed.isPrivate,
      };
    }

    // 根据不同来源应用不同的验证策略
    switch (options.source) {
      case RuleSource.AdGuardFilter:
        // AdGuard 过滤器：严格模式，只接受 ICANN TLD
        if (!parsed.isIcann) {
          return {
            valid: false,
            reason: `非 ICANN 认证的 TLD: ${parsed.publicSuffix}`,
            publicSuffix: parsed.publicSuffix,
            isIcann: false,
            isPrivate: parsed.isPrivate,
          };
        }
        break;

      case RuleSource.LocalFile:
      case RuleSource.RemoteList:
      case RuleSource.Unknown:
      default:
        // 本地文件和其他来源：宽松模式
        // 接受 ICANN TLD 和私有后缀
        if (!parsed.isIcann && !parsed.isPrivate) {
          // 检查是否在 ICP 白名单中
          if (!this.icpTldSet.has(parsed.publicSuffix)) {
            // 检查是否为特殊用途 TLD
            if (!this.specialTldSet.has(parsed.publicSuffix)) {
              return {
                valid: false,
                reason: `非法 TLD: ${parsed.publicSuffix}`,
                publicSuffix: parsed.publicSuffix,
                isIcann: false,
                isPrivate: false,
              };
            }
          }
        }
        break;
    }

    // 检查额外的白名单
    if (options.whitelist && options.whitelist.includes(domain)) {
      return {
        valid: true,
        publicSuffix: parsed.publicSuffix,
        isIcann: parsed.isIcann,
        isPrivate: parsed.isPrivate,
      };
    }

    // 通过验证
    return {
      valid: true,
      publicSuffix: parsed.publicSuffix,
      isIcann: parsed.isIcann,
      isPrivate: parsed.isPrivate,
    };
  }

  /**
   * 批量验证域名
   */
  validateBatch(domains: string[], options: ValidationOptions): Map<string, TldValidationResult> {
    const results = new Map<string, TldValidationResult>();

    for (const domain of domains) {
      results.set(domain, this.validate(domain, options));
    }

    return results;
  }

  /**
   * 生成验证报告
   */
  generateReport(results: Map<string, TldValidationResult>): void {
    let validCount = 0;
    let invalidCount = 0;
    const invalidByReason = new Map<string, number>();

    for (const [domain, result] of results) {
      if (result.valid) {
        validCount++;
      } else {
        invalidCount++;
        const reason = result.reason || '未知原因';
        invalidByReason.set(reason, (invalidByReason.get(reason) || 0) + 1);
      }
    }

    console.log('\n📊 TLD 验证报告');
    console.log('================');
    console.log(`总计: ${results.size} 个域名`);
    console.log(`✅ 有效: ${validCount} (${((validCount / results.size) * 100).toFixed(2)}%)`);
    console.log(`❌ 无效: ${invalidCount} (${((invalidCount / results.size) * 100).toFixed(2)}%)`);

    if (invalidByReason.size > 0) {
      console.log('\n无效原因分布:');
      for (const [reason, count] of invalidByReason) {
        console.log(`  ${reason}: ${count}`);
      }
    }
  }
}

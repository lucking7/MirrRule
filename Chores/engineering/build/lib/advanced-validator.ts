/**
 * 高级验证模块
 * 包含非法 TLD 检测、哈希冲突检测等高级验证功能
 */

import { createHash } from 'node:crypto';
import picocolors from 'picocolors';
import tldts from 'tldts-experimental';
import { HostnameSmolTrie } from './trie.js';
import { looseTldtsOpt } from '../constants/loose-tldts-opt.js';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  type: 'illegal-tld' | 'hash-collision' | 'syntax-error' | 'duplicate';
  message: string;
  file?: string | undefined;
  line?: number | undefined;
  details?: any;
}

export interface ValidationWarning {
  type: string;
  message: string;
  file?: string | undefined;
  line?: number | undefined;
  details?: any;
}

/**
 * 非法顶级域名列表
 * 这些通常是打字错误或者不存在的 TLD
 */
const ILLEGAL_TLDS = new Set([
  'con',
  'prn',
  'aux',
  'nul', // Windows 保留名称
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9', // Windows 设备名
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9', // Windows 设备名
  'local',
  'localhost',
  'localdomain', // 本地域名
  'example',
  'invalid',
  'test', // 保留域名
  'onion',
  'i2p', // 特殊网络
  'arpa', // 反向 DNS
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '0', // 纯数字
  'cmo',
  'cpm',
  'coom',
  'comm',
  'comn',
  'con',
  'cmo', // 常见的 .com 拼写错误
  'ogr',
  'og',
  'orgg',
  'orgn',
  'orh', // 常见的 .org 拼写错误
  'ent',
  'nte',
  'neet',
  'nett',
  'met', // 常见的 .net 拼写错误
  'gov',
  'edu',
  'mil', // 通常需要特殊权限的 TLD（当不带国家代码时）
]);

/**
 * 可疑但不一定非法的 TLD
 */
const SUSPICIOUS_TLDS = new Set([
  'tk',
  'ml',
  'ga',
  'cf', // 免费域名，常被滥用
  'top',
  'icu',
  'buzz',
  'live', // 便宜域名，常被滥用
  'download',
  'stream',
  'online', // 常见的钓鱼域名后缀
]);

/**
 * 验证域名的 TLD 是否合法
 */
export function validateTld(domain: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // 获取域名的 TLD
  const publicSuffix = tldts.getPublicSuffix(domain, looseTldtsOpt);

  if (!publicSuffix) {
    errors.push({
      type: 'illegal-tld',
      message: `无法解析域名的顶级域: ${domain}`,
      details: { domain },
    });
    return { valid: false, errors, warnings };
  }

  // 检查是否是非法 TLD
  const tldParts = publicSuffix.split('.');
  const topLevelDomain = tldParts[tldParts.length - 1];

  if (ILLEGAL_TLDS.has(topLevelDomain.toLowerCase())) {
    errors.push({
      type: 'illegal-tld',
      message: `非法的顶级域名: .${topLevelDomain}`,
      details: { domain, tld: topLevelDomain },
    });
  }

  // 检查是否是可疑 TLD
  if (SUSPICIOUS_TLDS.has(topLevelDomain.toLowerCase())) {
    warnings.push({
      type: 'suspicious-tld',
      message: `可疑的顶级域名（常被滥用）: .${topLevelDomain}`,
      details: { domain, tld: topLevelDomain },
    });
  }

  // 检查是否是 IDN（国际化域名）
  if (domain.includes('xn--') || /[^\x00-\x7F]/.test(domain)) {
    warnings.push({
      type: 'idn-domain',
      message: `国际化域名（IDN）: ${domain}`,
      details: { domain },
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 哈希冲突检测器
 */
export class HashCollisionDetector {
  private hashMap: Map<string, Set<string>> = new Map();
  private collisions: Array<{ hash: string; domains: string[] }> = [];

  /**
   * 添加域名并检测哈希冲突
   */
  public add(domain: string, algorithm: string = 'md5'): boolean {
    const hash = this.computeHash(domain, algorithm);

    if (!this.hashMap.has(hash)) {
      this.hashMap.set(hash, new Set([domain]));
      return false; // 无冲突
    }

    const existingDomains = this.hashMap.get(hash)!;
    if (!existingDomains.has(domain)) {
      existingDomains.add(domain);

      // 记录冲突
      const collision = this.collisions.find(c => c.hash === hash);
      if (collision) {
        collision.domains.push(domain);
      } else {
        this.collisions.push({
          hash,
          domains: Array.from(existingDomains),
        });
      }

      return true; // 发生冲突
    }

    return false; // 重复域名，不算冲突
  }

  /**
   * 计算域名的哈希值
   */
  private computeHash(domain: string, algorithm: string): string {
    return createHash(algorithm).update(domain).digest('hex');
  }

  /**
   * 获取所有哈希冲突
   */
  public getCollisions(): Array<{ hash: string; domains: string[] }> {
    return this.collisions;
  }

  /**
   * 生成冲突报告
   */
  public generateReport(): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    for (const collision of this.collisions) {
      errors.push({
        type: 'hash-collision',
        message: `哈希冲突: ${collision.domains.length} 个域名产生相同的哈希值`,
        details: {
          hash: collision.hash,
          domains: collision.domains,
        },
      });
    }

    if (this.collisions.length > 0) {
      console.log(picocolors.red(`[哈希冲突] 发现 ${this.collisions.length} 组哈希冲突`));
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

/**
 * 规则语法验证器
 */
export class RuleSyntaxValidator {
  private errors: ValidationError[] = [];
  private warnings: ValidationWarning[] = [];

  /**
   * 验证 Surge 规则语法
   */
  public validateSurgeRule(rule: string, file?: string, line?: number): boolean {
    const trimmedRule = rule.trim();

    // 忽略空行和注释
    if (!trimmedRule || trimmedRule.startsWith('#') || trimmedRule.startsWith('//')) {
      return true;
    }

    // 检查基本格式
    const parts = trimmedRule.split(',');
    if (parts.length < 2) {
      this.errors.push({
        type: 'syntax-error',
        message: `规则格式错误，缺少逗号分隔: ${trimmedRule}`,
        ...(file !== undefined && { file }),
        ...(line !== undefined && { line }),
      });
      return false;
    }

    const ruleType = parts[0].toUpperCase();
    const validRuleTypes = [
      'DOMAIN',
      'DOMAIN-SUFFIX',
      'DOMAIN-KEYWORD',
      'DOMAIN-SET',
      'IP-CIDR',
      'IP-CIDR6',
      'GEOIP',
      'IP-ASN',
      'USER-AGENT',
      'URL-REGEX',
      'PROCESS-NAME',
      'AND',
      'OR',
      'NOT',
      'RULE-SET',
      'PROTOCOL',
      'DEST-PORT',
      'SRC-IP',
      'SRC-PORT',
      'IN-PORT',
      'DSCP',
      'SCRIPT',
      'CELLULAR-RADIO',
      'SUBNET',
      'DOMAIN-WILDCARD',
    ];

    if (!validRuleTypes.includes(ruleType)) {
      this.errors.push({
        type: 'syntax-error',
        message: `未知的规则类型: ${ruleType}`,
        ...(file !== undefined && { file }),
        ...(line !== undefined && { line }),
        details: { rule: trimmedRule },
      });
      return false;
    }

    // 验证特定规则类型的参数
    switch (ruleType) {
      case 'DOMAIN':
      case 'DOMAIN-SUFFIX':
      case 'DOMAIN-KEYWORD':
        if (parts.length < 2 || !parts[1]) {
          this.errors.push({
            type: 'syntax-error',
            message: `${ruleType} 规则缺少域名参数`,
            ...(file !== undefined && { file }),
            ...(line !== undefined && { line }),
          });
          return false;
        }
        break;

      case 'IP-CIDR':
      case 'IP-CIDR6':
        if (parts.length < 2 || !parts[1]) {
          this.errors.push({
            type: 'syntax-error',
            message: `${ruleType} 规则缺少 CIDR 参数`,
            ...(file !== undefined && { file }),
            ...(line !== undefined && { line }),
          });
          return false;
        }
        // 验证 CIDR 格式
        const cidrPattern =
          ruleType === 'IP-CIDR'
            ? /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/
            : /^[0-9a-fA-F:]+\/\d{1,3}$/;

        if (!cidrPattern.test(parts[1])) {
          this.errors.push({
            type: 'syntax-error',
            message: `${ruleType} 规则的 CIDR 格式不正确: ${parts[1]}`,
            ...(file !== undefined && { file }),
            ...(line !== undefined && { line }),
          });
          return false;
        }
        break;
    }

    return true;
  }

  /**
   * 批量验证规则文件
   */
  public validateRuleFile(rules: string[], filePath?: string): ValidationResult {
    this.errors = [];
    this.warnings = [];

    rules.forEach((rule, index) => {
      this.validateSurgeRule(rule, filePath, index + 1);
    });

    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
    };
  }
}

/**
 * 域名重复检测器
 */
export class DuplicateDomainDetector {
  private domainMap: Map<string, Array<{ file: string; line: number }>> = new Map();
  private trie: HostnameSmolTrie = new HostnameSmolTrie();

  /**
   * 添加域名
   */
  public add(domain: string, file: string, line: number): void {
    const key = domain.toLowerCase();

    if (!this.domainMap.has(key)) {
      this.domainMap.set(key, []);
    }

    this.domainMap.get(key)!.push({ file, line });
    this.trie.add(domain);
  }

  /**
   * 检测并报告重复
   */
  public detectDuplicates(): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    for (const [domain, locations] of this.domainMap) {
      if (locations.length > 1) {
        warnings.push({
          type: 'duplicate-domain',
          message: `域名重复出现 ${locations.length} 次: ${domain}`,
          details: {
            domain,
            locations,
          },
        });
      }
    }

    // 检测被父域名覆盖的子域名
    for (const [domain] of this.domainMap) {
      if (domain.includes('.')) {
        const parts = domain.split('.');
        for (let i = 1; i < parts.length; i++) {
          const parentDomain = parts.slice(i).join('.');
          if (this.trie.has('.' + parentDomain, true)) {
            warnings.push({
              type: 'redundant-subdomain',
              message: `子域名 ${domain} 已被父域名 .${parentDomain} 覆盖`,
              details: {
                subdomain: domain,
                parentDomain: '.' + parentDomain,
              },
            });
            break;
          }
        }
      }
    }

    return {
      valid: true, // 重复不算错误，只是警告
      errors,
      warnings,
    };
  }
}

/**
 * 综合验证器
 */
export async function validateRulesets(
  ruleFiles: Array<{ path: string; content: string[] }>,
  options: {
    checkTld?: boolean;
    checkHashCollision?: boolean;
    checkSyntax?: boolean;
    checkDuplicates?: boolean;
  } = {}
): Promise<ValidationResult> {
  const allErrors: ValidationError[] = [];
  const allWarnings: ValidationWarning[] = [];

  // 初始化检测器
  const hashDetector = options.checkHashCollision ? new HashCollisionDetector() : null;
  const syntaxValidator = options.checkSyntax ? new RuleSyntaxValidator() : null;
  const duplicateDetector = options.checkDuplicates ? new DuplicateDomainDetector() : null;

  // 处理每个文件
  for (const { path, content } of ruleFiles) {
    for (let i = 0; i < content.length; i++) {
      const rule = content[i].trim();
      const lineNumber = i + 1;

      // 忽略空行和注释
      if (!rule || rule.startsWith('#') || rule.startsWith('//')) {
        continue;
      }

      // 语法验证
      if (syntaxValidator) {
        syntaxValidator.validateSurgeRule(rule, path, lineNumber);
      }

      // 提取域名进行其他验证
      const parts = rule.split(',');
      const ruleType = parts[0]?.toUpperCase();

      if (ruleType === 'DOMAIN' || ruleType === 'DOMAIN-SUFFIX') {
        const domain = parts[1]?.trim();
        if (domain) {
          // TLD 验证
          if (options.checkTld) {
            const tldResult = validateTld(domain);
            tldResult.errors.forEach(error => {
              error.file = path;
              error.line = lineNumber;
              allErrors.push(error);
            });
            tldResult.warnings.forEach(warning => {
              warning.file = path;
              warning.line = lineNumber;
              allWarnings.push(warning);
            });
          }

          // 哈希冲突检测
          if (hashDetector) {
            hashDetector.add(domain);
          }

          // 重复检测
          if (duplicateDetector) {
            duplicateDetector.add(domain, path, lineNumber);
          }
        }
      }
    }
  }

  // 收集所有验证结果
  if (syntaxValidator) {
    const syntaxResult = syntaxValidator.validateRuleFile([], '');
    allErrors.push(...syntaxResult.errors);
    allWarnings.push(...syntaxResult.warnings);
  }

  if (hashDetector) {
    const hashResult = hashDetector.generateReport();
    allErrors.push(...hashResult.errors);
    allWarnings.push(...hashResult.warnings);
  }

  if (duplicateDetector) {
    const duplicateResult = duplicateDetector.detectDuplicates();
    allErrors.push(...duplicateResult.errors);
    allWarnings.push(...duplicateResult.warnings);
  }

  // 输出统计
  if (allErrors.length > 0) {
    console.log(picocolors.red(`[验证] 发现 ${allErrors.length} 个错误`));
  }
  if (allWarnings.length > 0) {
    console.log(picocolors.yellow(`[验证] 发现 ${allWarnings.length} 个警告`));
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}

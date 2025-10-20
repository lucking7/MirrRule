/**
 * 共享验证工具模块
 *
 * 提供统一的域名、IP、URL等验证功能
 * 消除各平台输出策略中的重复验证逻辑
 *
 * @module validators
 */

/**
 * 域名验证器
 * 提供各种域名格式的验证功能
 */
export class DomainValidator {
  /**
   * 域名格式正则表达式
   * 匹配标准域名格式：example.com, sub.example.com
   */
  private static readonly DOMAIN_REGEX =
    /^[\da-z]([\da-z-]*[\da-z])?(\.[\da-z]([\da-z-]*[\da-z])?)*$/i;

  /**
   * 检查字符串是否为有效的域名格式
   *
   * @param text - 待检查的字符串
   * @returns 如果是有效域名返回true，否则返回false
   *
   * @example
   * ```typescript
   * DomainValidator.isDomainLike('example.com'); // true
   * DomainValidator.isDomainLike('sub.example.com'); // true
   * DomainValidator.isDomainLike('.example.com'); // false
   * DomainValidator.isDomainLike('example..com'); // false
   * ```
   */
  static isDomainLike(text: string): boolean {
    return this.DOMAIN_REGEX.test(text);
  }

  /**
   * 检查字符串是否为域名后缀格式（以.开头）
   *
   * @param text - 待检查的字符串
   * @returns 如果是域名后缀格式返回true，否则返回false
   *
   * @example
   * ```typescript
   * DomainValidator.isDomainSuffix('.example.com'); // true
   * DomainValidator.isDomainSuffix('example.com'); // false
   * ```
   */
  static isDomainSuffix(text: string): boolean {
    if (!text.startsWith('.')) {
      return false;
    }
    const withoutDot = text.slice(1);
    return this.isDomainLike(withoutDot);
  }

  /**
   * 规范化域名格式
   * 移除前导和尾随空格，转换为小写
   *
   * @param domain - 待规范化的域名
   * @returns 规范化后的域名
   */
  static normalize(domain: string): string {
    return domain.trim().toLowerCase();
  }
}

/**
 * IP地址验证器
 * 提供IPv4和IPv6地址及CIDR的验证功能
 */
export class IPValidator {
  /**
   * IPv4地址正则表达式（支持CIDR）
   * 匹配格式：192.168.1.1 或 192.168.1.0/24
   */
  private static readonly IPV4_CIDR_REGEX = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;

  /**
   * IPv6地址正则表达式（支持CIDR）
   * 匹配格式：2001:db8::1 或 2001:db8::/32
   */
  private static readonly IPV6_CIDR_REGEX = /^([\da-f]{1,4}:){2,7}[\da-f]{1,4}(\/\d{1,3})?$/i;

  /**
   * 检查字符串是否为IPv4 CIDR格式
   *
   * @param text - 待检查的字符串
   * @returns 如果是有效的IPv4 CIDR返回true，否则返回false
   *
   * @example
   * ```typescript
   * IPValidator.isIPv4Cidr('192.168.1.1'); // true
   * IPValidator.isIPv4Cidr('192.168.1.0/24'); // true
   * IPValidator.isIPv4Cidr('256.1.1.1'); // false（会通过正则但不是有效IP）
   * ```
   */
  static isIPv4Cidr(text: string): boolean {
    if (!this.IPV4_CIDR_REGEX.test(text)) {
      return false;
    }

    // 进一步验证八位组范围（0-255）
    const parts = text.split('/')[0].split('.');
    return parts.every(part => {
      const num = Number.parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }

  /**
   * 检查字符串是否为IPv6 CIDR格式
   *
   * @param text - 待检查的字符串
   * @returns 如果是有效的IPv6 CIDR返回true，否则返回false
   *
   * @example
   * ```typescript
   * IPValidator.isIPv6Cidr('2001:db8::1'); // true
   * IPValidator.isIPv6Cidr('2001:db8::/32'); // true
   * IPValidator.isIPv6Cidr('::1'); // false（格式不匹配，但可能是有效IPv6）
   * ```
   */
  static isIPv6Cidr(text: string): boolean {
    return this.IPV6_CIDR_REGEX.test(text);
  }

  /**
   * 检查字符串是否为任意IP CIDR格式（IPv4或IPv6）
   *
   * @param text - 待检查的字符串
   * @returns 如果是有效的IP CIDR返回true，否则返回false
   *
   * @example
   * ```typescript
   * IPValidator.isIpCidr('192.168.1.0/24'); // true
   * IPValidator.isIpCidr('2001:db8::/32'); // true
   * IPValidator.isIpCidr('example.com'); // false
   * ```
   */
  static isIpCidr(text: string): boolean {
    return this.isIPv4Cidr(text) || this.isIPv6Cidr(text);
  }

  /**
   * 判断IP CIDR类型
   *
   * @param text - IP CIDR字符串
   * @returns 'ipv4' | 'ipv6' | null
   */
  static getIpType(text: string): 'ipv4' | 'ipv6' | null {
    if (this.isIPv4Cidr(text)) return 'ipv4';
    if (this.isIPv6Cidr(text)) return 'ipv6';
    return null;
  }
}

/**
 * URL验证器
 * 提供URL格式的验证功能
 */
export class URLValidator {
  /**
   * URL正则表达式
   * 匹配标准URL格式
   */
  private static readonly URL_REGEX = /^(https?:\/\/)?([\w.-]+)\.([a-z]{2,})(:\d+)?(\/.*)?$/i;

  /**
   * 检查字符串是否为有效的URL格式
   *
   * @param text - 待检查的字符串
   * @returns 如果是有效URL返回true，否则返回false
   *
   * @example
   * ```typescript
   * URLValidator.isValidURL('https://example.com'); // true
   * URLValidator.isValidURL('http://sub.example.com:8080/path'); // true
   * URLValidator.isValidURL('not-a-url'); // false
   * ```
   */
  static isValidURL(text: string): boolean {
    return this.URL_REGEX.test(text);
  }

  /**
   * 从URL中提取主机名
   *
   * @param url - URL字符串
   * @returns 主机名，如果无法提取则返回null
   *
   * @example
   * ```typescript
   * URLValidator.extractHostname('https://example.com/path'); // 'example.com'
   * URLValidator.extractHostname('http://sub.example.com:8080'); // 'sub.example.com'
   * ```
   */
  static extractHostname(url: string): string | null {
    try {
      const urlObj = new URL(url.includes('://') ? url : `https://${url}`);
      return urlObj.hostname;
    } catch {
      return null;
    }
  }
}

/**
 * 规则格式验证器
 * 提供代理规则格式的验证功能
 */
export const RuleValidator = {
  /**
   * 检查字符串是否为注释行
   *
   * 支持的注释格式:
   * - # - 井号注释 (最常见)
   * - ! - 感叹号注释 (AdBlock 格式)
   * - // - 双斜杠注释 (C/JavaScript 风格)
   * - ; - 分号注释 (INI/配置文件风格)
   *
   * @param line - 待检查的字符串
   * @returns 如果是注释返回true，否则返回false
   *
   * @example
   * ```typescript
   * RuleValidator.isComment('# This is a comment'); // true
   * RuleValidator.isComment('! AdBlock comment'); // true
   * RuleValidator.isComment('// JavaScript comment'); // true
   * RuleValidator.isComment('; INI comment'); // true
   * RuleValidator.isComment('DOMAIN,example.com'); // false
   * ```
   */
  isComment(line: string): boolean {
    const trimmed = line.trim();
    return (
      trimmed.startsWith('#') ||
      trimmed.startsWith('!') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith(';')
    );
  },

  /**
   * 移除行内注释 (仅支持 // 格式)
   *
   * @param line - 待处理的字符串
   * @returns 移除行内注释后的字符串
   *
   * @example
   * ```typescript
   * RuleValidator.removeInlineComment('DOMAIN,example.com // comment');
   * // 'DOMAIN,example.com'
   * RuleValidator.removeInlineComment('DOMAIN,example.com # not removed');
   * // 'DOMAIN,example.com # not removed'
   * ```
   */
  removeInlineComment(line: string): string {
    const commentIndex = line.indexOf('//');
    if (commentIndex === -1) {
      return line;
    }
    // 移除 // 及其后面的所有内容
    return line.substring(0, commentIndex).trim();
  },

  /**
   * 检查字符串是否为空行
   *
   * @param line - 待检查的字符串
   * @returns 如果是空行返回true，否则返回false
   */
  isEmptyLine(line: string): boolean {
    return line.trim().length === 0;
  },

  /**
   * 检查是否应该跳过该行（注释或空行）
   *
   * @param line - 待检查的字符串
   * @returns 如果应该跳过返回true，否则返回false
   */
  shouldSkipLine(line: string): boolean {
    return this.isEmptyLine(line) || this.isComment(line);
  },

  /**
   * 解析规则行，提取规则类型和值
   *
   * @param line - 规则行字符串
   * @returns { type: string, value: string, params?: string } 或 null
   *
   * @example
   * ```typescript
   * RuleValidator.parseRule('DOMAIN-SUFFIX,example.com');
   * // { type: 'DOMAIN-SUFFIX', value: 'example.com' }
   *
   * RuleValidator.parseRule('IP-CIDR,192.168.1.0/24,no-resolve');
   * // { type: 'IP-CIDR', value: '192.168.1.0/24', params: 'no-resolve' }
   * ```
   */
  parseRule(line: string): {
    type: string;
    value: string;
    params?: string;
  } | null {
    const trimmed = line.trim();

    if (this.shouldSkipLine(trimmed)) {
      return null;
    }

    const parts = trimmed.split(',').map(p => p.trim());

    if (parts.length < 2) {
      return null;
    }

    return {
      type: parts[0].toUpperCase(),
      value: parts[1],
      params: parts.length > 2 ? parts.slice(2).join(',') : undefined,
    };
  },

  /**
   * 验证规则格式是否有效
   *
   * @param line - 规则行字符串
   * @returns 如果是有效规则返回true，否则返回false
   *
   * @example
   * ```typescript
   * RuleValidator.isValidRule('DOMAIN,example.com'); // true
   * RuleValidator.isValidRule('DOMAIN-SUFFIX,example.com'); // true
   * RuleValidator.isValidRule('IP-CIDR,192.168.1.0/24'); // true
   * RuleValidator.isValidRule('INVALID'); // false
   * RuleValidator.isValidRule('# comment'); // false
   * ```
   */
  isValidRule(line: string): boolean {
    const trimmed = line.trim();

    // 跳过注释和空行
    if (this.shouldSkipLine(trimmed)) {
      return false;
    }

    // 解析规则
    const parsed = this.parseRule(trimmed);
    if (!parsed) {
      return false;
    }

    // 验证规则类型
    const validTypes = [
      'DOMAIN',
      'DOMAIN-SUFFIX',
      'DOMAIN-KEYWORD',
      'DOMAIN-WILDCARD',
      'IP-CIDR',
      'IP-CIDR6',
      'GEOIP',
      'IP-ASN',
      'USER-AGENT',
      'URL-REGEX',
      'PROCESS-NAME',
      'PROCESS-PATH',
      'SRC-IP-CIDR',
      'SRC-PORT',
      'DST-PORT',
      'DEST-PORT',
      'PROTOCOL',
      'NETWORK',
      'AND',
      'OR',
      'NOT',
    ];

    if (!validTypes.includes(parsed.type)) {
      return false;
    }

    // 验证值不为空
    if (!parsed.value || parsed.value.length === 0) {
      return false;
    }

    return true;
  },
};

/**
 * 复合验证器
 * 提供综合性的验证功能
 */
export const Validator = {
  /**
   * 智能识别文本类型
   *
   * @param text - 待识别的文本
   * @returns 'domain' | 'domain-suffix' | 'ipv4' | 'ipv6' | 'url' | 'unknown'
   *
   * @example
   * ```typescript
   * Validator.identifyType('example.com'); // 'domain'
   * Validator.identifyType('.example.com'); // 'domain-suffix'
   * Validator.identifyType('192.168.1.0/24'); // 'ipv4'
   * Validator.identifyType('2001:db8::/32'); // 'ipv6'
   * ```
   */
  identifyType(text: string): 'domain' | 'domain-suffix' | 'ipv4' | 'ipv6' | 'url' | 'unknown' {
    // 检查域名后缀
    if (DomainValidator.isDomainSuffix(text)) {
      return 'domain-suffix';
    }

    // 检查IP类型
    const ipType = IPValidator.getIpType(text);
    if (ipType === 'ipv4') return 'ipv4';
    if (ipType === 'ipv6') return 'ipv6';

    // 检查域名
    if (DomainValidator.isDomainLike(text)) {
      return 'domain';
    }

    // 检查URL
    if (URLValidator.isValidURL(text)) {
      return 'url';
    }

    return 'unknown';
  },

  /**
   * 验证并规范化输入文本
   *
   * @param text - 待处理的文本
   * @returns 规范化后的文本和类型信息
   */
  validateAndNormalize(text: string): {
    normalized: string;
    type: string;
    isValid: boolean;
  } {
    const type = this.identifyType(text);
    const isValid = type !== 'unknown';

    let normalized = text.trim();
    if (type === 'domain' || type === 'domain-suffix') {
      normalized = DomainValidator.normalize(normalized);
    }

    return { normalized, type, isValid };
  },
};

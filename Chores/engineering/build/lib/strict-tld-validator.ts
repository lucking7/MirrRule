import { parse } from 'tldts';

/**
 * 严格的 TLD 验证器
 * 使用 tldts 库进行基于 Public Suffix List 的验证
 */
export class StrictTldValidator {
  /**
   * 验证域名是否有效
   */
  isValidDomain(domain: string): boolean {
    if (!domain || typeof domain !== 'string') {
      return false;
    }

    // 解析域名
    const parsed = parse(domain, {
      allowPrivateDomains: true,
      allowIcannDomains: true,
    });

    // 特殊情况：如果输入就是一个有效的后缀（如 github.io, org.cn）
    // 这种情况下 domain 是 null，但 publicSuffix 等于输入，且 isIcann 或 isPrivate 为 true
    if (!parsed.domain && parsed.publicSuffix === domain) {
      return !!parsed.isIcann || !!parsed.isPrivate;
    }

    // 标准情况：完整域名
    if (!parsed.domain) {
      return false;
    }

    // 检查是否是 ICANN 认证的域名或私有域名
    return !!parsed.isIcann || !!parsed.isPrivate;
  }

  /**
   * 获取验证错误的详细信息
   */
  getValidationError(domain: string): string | null {
    if (!domain || typeof domain !== 'string') {
      return '无效的域名格式';
    }

    const parsed = parse(domain, {
      allowPrivateDomains: true,
      allowIcannDomains: true,
    });

    // 特殊情况：如果输入就是一个有效的后缀
    if (!parsed.domain && parsed.publicSuffix === domain) {
      if (!parsed.isIcann && !parsed.isPrivate) {
        return '非 ICANN 认证或私有域名后缀';
      }
      return null;
    }

    // 标准情况
    if (!parsed.domain) {
      return '无法解析域名';
    }

    if (!parsed.isIcann && !parsed.isPrivate) {
      return '非 ICANN 认证或私有域名后缀';
    }

    return null;
  }

  /**
   * 获取域名的公共后缀
   */
  getPublicSuffix(domain: string): string | null {
    const parsed = parse(domain, {
      allowPrivateDomains: true,
      allowIcannDomains: true,
    });

    return parsed.publicSuffix || null;
  }

  /**
   * 检查是否是 ICANN 域名
   */
  isIcannDomain(domain: string): boolean {
    const parsed = parse(domain, {
      allowPrivateDomains: true,
      allowIcannDomains: true,
    });

    return !!parsed.isIcann;
  }

  /**
   * 检查是否是私有域名
   */
  isPrivateDomain(domain: string): boolean {
    const parsed = parse(domain, {
      allowPrivateDomains: true,
      allowIcannDomains: true,
    });

    return !!parsed.isPrivate;
  }
}

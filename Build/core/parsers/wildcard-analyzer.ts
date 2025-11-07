/**
 * 通配符分析器 - 分析域名通配符模式
 *
 * 职责：
 * - 分析通配符模式的类型和复杂度
 * - 识别简单后缀模式（可转换为DOMAIN-SUFFIX）
 * - 检测复杂通配符（需要特殊处理）
 */

import type { WildcardAnalysis } from './types';

/**
 * 通配符分析器类
 */
export class WildcardAnalyzer {
  /**
   * 分析通配符模式
   *
   * @param pattern - 通配符模式字符串
   * @returns 通配符分析结果
   *
   * 示例：
   * - "*.example.com" → isSimpleSuffix: true, extractedSuffix: "example.com"
   * - "*ad*.example.com" → hasComplexWildcard: true
   */
  static analyzeWildcard(pattern: string): WildcardAnalysis {
    const result: WildcardAnalysis = {
      isSimpleSuffix: false,
      hasComplexWildcard: false,
      originalPattern: pattern
    };

    // 检查是否为简单的后缀模式 (*.example.com)
    if (this.isSimpleSuffixPattern(pattern)) {
      result.isSimpleSuffix = true;
      result.extractedSuffix = pattern.slice(2); // 移除 "*."
    } else if (this.hasWildcard(pattern)) {
      result.hasComplexWildcard = true;
    }

    return result;
  }

  /**
   * 检查是否为简单后缀模式
   * 模式：以"*."开头，不包含其他通配符
   */
  private static isSimpleSuffixPattern(pattern: string): boolean {
    return (
      pattern.startsWith('*.')
      && !pattern.includes('?')
      && pattern.split('*').length === 2
    );
  }

  /**
   * 检查是否包含通配符
   */
  private static hasWildcard(pattern: string): boolean {
    return pattern.includes('*') || pattern.includes('?');
  }

  /**
   * 验证域名格式
   *
   * @param domain - 待验证的域名
   * @returns 是否为有效域名
   */
  static isValidDomain(domain: string): boolean {
    if (!domain || domain.length === 0) {
      return false;
    }

    // 基本域名格式验证：允许字母、数字、连字符和点
    const domainRegex =
      /^[\da-z]([\da-z-]*[\da-z])?(\.[\da-z]([\da-z-]*[\da-z])?)*$/i;
    return domainRegex.test(domain);
  }
}

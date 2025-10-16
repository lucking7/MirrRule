/**
 * 平台检测器 - 识别代理客户端规则格式
 *
 * 职责：
 * - 检测规则所属平台（Surge/Clash/Loon/QuantumultX）
 * - 基于规则语法特征进行模式匹配
 *
 * 使用示例：
 * ```typescript
 * const platform = PlatformDetector.detectPlatform(rule);
 * if (platform === ProxyPlatform.SURGE) { ... }
 * ```
 */

import { ProxyPlatform } from '../../constants/rule-formats';

/**
 * 平台检测器类
 */
export class PlatformDetector {
  /**
   * 检测规则的平台类型
   *
   * @param rule - 原始规则字符串
   * @returns 检测到的平台类型，无法识别返回null
   *
   * 注意：跳过注释和空行，仅分析有效规则
   */
  static detectPlatform(rule: string): ProxyPlatform | null {
    const trimmed = rule.trim();

    // 跳过注释和空行
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
      return null;
    }

    // 逻辑规则检测（Surge特有）
    if (/^(and|or|not)\s*,/i.test(trimmed)) {
      return this.detectLogicalRulePlatform(trimmed);
    }

    // QuantumultX特征检测（小写规则名）
    if (this.isQuantumultXRule(trimmed)) {
      return ProxyPlatform.QUANTUMULT_X;
    }

    // Loon特征检测（通常缺少策略部分）
    if (this.isLoonRule(trimmed)) {
      return ProxyPlatform.LOON;
    }

    // Surge特征检测（完整的三段式）
    if (this.isSurgeRule(trimmed)) {
      return ProxyPlatform.SURGE;
    }

    // Clash特征检测
    if (this.isClashRule(trimmed)) {
      return ProxyPlatform.CLASH;
    }

    return null;
  }

  /**
   * 检测逻辑规则的平台类型
   * 根据子规则判断平台，默认为Surge
   */
  private static detectLogicalRulePlatform(rule: string): ProxyPlatform {
    const parts = rule.split(',');
    if (parts.length > 1) {
      const subRule = parts.slice(1).join(',').trim();
      return this.detectPlatform(subRule) || ProxyPlatform.SURGE;
    }
    return ProxyPlatform.SURGE;
  }

  /**
   * 检测是否为QuantumultX规则
   * 特征：小写规则名（host, host-suffix等）
   */
  private static isQuantumultXRule(rule: string): boolean {
    return /^(host|host-suffix|host-keyword|host-wildcard|ip-cidr|ip6-cidr|geoip|ip-asn|user-agent)\s*,/i.test(
      rule
    );
  }

  /**
   * 检测是否为Loon规则
   * 特征：大写规则名，通常缺少策略部分（两段式）
   */
  private static isLoonRule(rule: string): boolean {
    return /^(domain|domain-suffix|domain-keyword|ip-cidr|ip-cidr6|geoip|ip-asn|user-agent)\s*,[^,]+$/i.test(
      rule
    );
  }

  /**
   * 检测是否为Surge规则
   * 特征：大写规则名，完整的三段式（规则类型,值,策略）
   */
  private static isSurgeRule(rule: string): boolean {
    return /^(domain|domain-suffix|domain-keyword|domain-wildcard|ip-cidr|ip-cidr6|geoip|ip-asn|user-agent|url-regex|process-name|and|or|not)\s*,.*,\s*(direct|reject|proxy)/i.test(
      rule
    );
  }

  /**
   * 检测是否为Clash规则
   * 特征：大写规则名，但不包含REJECT策略（Clash通过规则集管理拒绝）
   */
  private static isClashRule(rule: string): boolean {
    return (
      /^(domain|domain-suffix|domain-keyword|ip-cidr|ip-cidr6|geoip|ip-asn)\s*,/i.test(rule)
      && !rule.includes('REJECT')
    );
  }
}

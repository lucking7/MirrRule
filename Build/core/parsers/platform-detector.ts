/**
 * 平台检测器 - 识别代理客户端规则格式
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
  static detectPlatform(this: void, rule: string): ProxyPlatform | null {
    const trimmed = rule.trim();

    // 跳过注释和空行 - 支持 #、!、//、; 四种格式
    if (
      !trimmed ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('!') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith(';')
    ) {
      return null;
    }

    // 逻辑规则检测（Surge特有）
    if (/^(?:and|or|not)\s*,/i.test(trimmed)) {
      return PlatformDetector.detectLogicalRulePlatform(trimmed);
    }

    // Loon特征检测（通常缺少策略部分）
    if (PlatformDetector.isLoonRule(trimmed)) {
      return ProxyPlatform.LOON;
    }

    // Surge特征检测（完整的三段式）
    if (PlatformDetector.isSurgeRule(trimmed)) {
      return ProxyPlatform.SURGE;
    }

    // Clash特征检测
    if (PlatformDetector.isClashRule(trimmed)) {
      return ProxyPlatform.CLASH;
    }

    return null;
  }

  /**
   * 检测逻辑规则的平台类型
   * 根据子规则判断平台，默认为Surge
   */
  private static detectLogicalRulePlatform(this: void, rule: string): ProxyPlatform {
    const parts = rule.split(',');
    if (parts.length > 1) {
      const subRule = parts.slice(1).join(',').trim();
      return PlatformDetector.detectPlatform(subRule) || ProxyPlatform.SURGE;
    }
    return ProxyPlatform.SURGE;
  }

  /**
   * 检测是否为Loon规则
   * 特征：大写规则名，通常缺少策略部分（两段式）
   */
  private static isLoonRule(this: void, rule: string): boolean {
    return /^(?:domain|domain-suffix|domain-keyword|ip-cidr|ip-cidr6|geoip|ip-asn|user-agent)\s*,[^,]+$/i.test(
      rule
    );
  }

  /**
   * 检测是否为Surge规则
   * 特征：大写规则名，完整的三段式（规则类型,值,策略）
   */
  private static isSurgeRule(this: void, rule: string): boolean {
    return /^(?:domain|domain-suffix|domain-keyword|domain-wildcard|ip-cidr|ip-cidr6|geoip|ip-asn|user-agent|url-regex|process-name|and|or|not)\s*,.*,\s*(?:direct|reject|proxy)/i.test(
      rule
    );
  }

  /**
   * 检测是否为Clash规则
   * 特征：大写规则名，但不包含REJECT策略（Clash通过规则集管理拒绝）
   */
  private static isClashRule(this: void, rule: string): boolean {
    return (
      /^(?:domain|domain-suffix|domain-keyword|ip-cidr|ip-cidr6|geoip|ip-asn)\s*,/i.test(rule) &&
      !rule.includes('REJECT')
    );
  }
}

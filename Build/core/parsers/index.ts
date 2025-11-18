/**
 * 跨平台规则解析器 - 统一导出入口
 *
 * 支持Surge、Loon、QuantumultX等多种代理客户端的规则格式解析和转换
 *
 * 本模块已重构为多个子模块，提高代码可维护性：
 * - types: 类型定义
 * - platform-detector: 平台检测
 * - wildcard-analyzer: 通配符分析
 * - rule-validator: 规则验证
 * - rule-converter: 格式转换
 * - rule-parser: 核心解析逻辑
 *
 * 向后兼容：保持原有API不变，外部代码无需修改
 */

import type { ProxyPlatform } from '../../constants/rule-formats';
import type { ParsedRule, RuleValidationResult, RuleStats } from './types';
import { PlatformDetector } from './platform-detector';
import { RuleParser } from './rule-parser';
import { RuleConverter } from './rule-converter';
import { RuleValidator } from './rule-validator';
import { WildcardAnalyzer } from './wildcard-analyzer';

/**
 * 跨平台规则解析器类（主入口）
 *
 * 提供完整的规则解析、转换和验证功能
 */
export const CrossPlatformRuleParser = {
  /**
   * 检测规则的平台类型
   *
   * @param rule - 原始规则字符串
   * @returns 检测到的平台类型，无法识别返回null
   */
  detectPlatform(rule: string): ProxyPlatform | null {
    return PlatformDetector.detectPlatform(rule);
  },

  /**
   * 解析规则字符串
   *
   * @param rule - 原始规则字符串
   * @param targetPlatform - 可选的目标平台（用于验证）
   * @returns 解析后的规则对象，无法解析返回null
   */
  parseRule(rule: string, targetPlatform?: ProxyPlatform): ParsedRule | null {
    return RuleParser.parseRule(rule, targetPlatform);
  },

  /**
   * 将解析后的规则转换为目标平台格式
   *
   * @param parsedRule - 解析后的规则对象
   * @param targetPlatform - 目标平台
   * @returns 转换后的规则字符串
   */
  convertToTargetPlatform(parsedRule: ParsedRule, targetPlatform: ProxyPlatform): string {
    return RuleConverter.convertToTargetPlatform(parsedRule, targetPlatform);
  },

  /**
   * 转换为RULE-SET payload格式（无策略组）
   *
   * @param parsedRule - 解析后的规则对象
   * @returns RULE-SET格式的规则字符串
   */
  convertToRuleSetPayload(parsedRule: ParsedRule): string {
    return RuleConverter.convertToRuleSetPayload(parsedRule);
  },

  /**
   * 批量转换规则
   *
   * @param rules - 规则字符串数组
   * @param targetPlatform - 目标平台
   * @returns 转换后的规则数组
   */
  convertRules(rules: string[], targetPlatform: ProxyPlatform): string[] {
    const convertedRules: string[] = [];

    for (const rule of rules) {
      const parsed = this.parseRule(rule, targetPlatform);
      const value = parsed ? this.convertToTargetPlatform(parsed, targetPlatform) : rule;

      if (value.trim().length > 0) {
        convertedRules.push(value);
      }
    }

    return convertedRules;
  },

  /**
   * 智能格式转换（自动检测源平台）
   *
   * @param rule - 原始规则字符串
   * @param targetPlatform - 目标平台
   * @returns 转换后的规则字符串
   */
  smartConvert(rule: string, targetPlatform: ProxyPlatform): string {
    const trimmed = rule.trim();

    // 🔧 预处理 domainset 格式规则（Surge domain-set 专用格式）
    // 格式1: .example.com → DOMAIN-SUFFIX,example.com
    // 格式2: example.com（纯域名，不含逗号）→ DOMAIN,example.com
    if (!trimmed.includes(',')) {
      // 以点开头的域名后缀格式
      if (trimmed.startsWith('.')) {
        const domain = trimmed.slice(1);
        if (domain && WildcardAnalyzer.isValidDomain(domain)) {
          // 转换为标准 DOMAIN-SUFFIX 格式后再解析
          const normalized = `DOMAIN-SUFFIX,${domain}`;
          const parsed = this.parseRule(normalized, targetPlatform);
          if (parsed) {
            return this.convertToTargetPlatform(parsed, targetPlatform);
          }
        }
      } else if (
        // 纯域名格式（不含逗号、不以点/数字开头、不是注释）
        !trimmed.startsWith('#') &&
        !trimmed.startsWith('!') &&
        !trimmed.startsWith('//') &&
        !trimmed.startsWith(';') &&
        !/^\d/.test(trimmed) && // 不以数字开头（排除 IP）
        WildcardAnalyzer.isValidDomain(trimmed)
      ) {
        // 转换为标准 DOMAIN 格式后再解析
        const normalized = `DOMAIN,${trimmed}`;
        const parsed = this.parseRule(normalized, targetPlatform);
        if (parsed) {
          return this.convertToTargetPlatform(parsed, targetPlatform);
        }
      }
    }

    // 常规解析流程
    const parsed = this.parseRule(trimmed, targetPlatform);
    if (!parsed) {
      return rule;
    }
    return this.convertToTargetPlatform(parsed, targetPlatform);
  },

  /**
   * 转换为RULE-SET payload格式（智能检测源平台）
   *
   * @param rule - 原始规则字符串
   * @returns RULE-SET格式的规则字符串
   */
  smartConvertToRuleSet(rule: string): string {
    const trimmed = rule.trim();

    // 保留注释行 - 支持 #、!、//、; 四种格式
    if (
      !trimmed ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('!') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith(';')
    ) {
      return rule;
    }

    // 处理特殊格式
    const smartConverted = RuleConverter.smartConvertToRuleSet(rule);
    if (smartConverted !== rule) {
      return smartConverted;
    }

    // 正常解析和转换
    const parsed = this.parseRule(rule);
    if (!parsed) {
      return rule;
    }
    return this.convertToRuleSetPayload(parsed);
  },

  /**
   * 批量转换为RULE-SET格式
   *
   * @param rules - 规则字符串数组
   * @returns RULE-SET格式的规则数组
   */
  convertRulesToRuleSet(rules: string[]): string[] {
    const convertedRules: string[] = [];

    for (const rule of rules) {
      const converted = this.smartConvertToRuleSet(rule);
      if (converted.trim().length > 0) {
        convertedRules.push(converted);
      }
    }

    return convertedRules;
  },

  /**
   * 验证规则格式
   *
   * @param rule - 原始规则字符串
   * @param platform - 目标平台
   * @returns 是否为有效规则
   */
  validateRule(rule: string, platform: ProxyPlatform): boolean {
    const parsed = this.parseRule(rule, platform);
    return parsed !== null && parsed.platform === platform;
  },

  /**
   * 验证规则的完整性
   *
   * @param rule - 原始规则字符串
   * @param platform - 目标平台
   * @returns 验证结果（包含错误和警告信息）
   */
  validateRuleDetailed(rule: string, platform: ProxyPlatform): RuleValidationResult {
    const result: RuleValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    const parsed = this.parseRule(rule, platform);
    if (!parsed) {
      result.isValid = false;
      result.errors.push('无法解析规则');
      return result;
    }

    return RuleValidator.validateRule(parsed, platform);
  },

  /**
   * 获取规则统计信息
   *
   * @param rules - 规则字符串数组
   * @returns 统计信息对象
   */
  getRuleStats(rules: string[]): RuleStats {
    const stats: RuleStats = {
      total: rules.length,
      byPlatform: {},
      byType: {},
      byPolicy: {},
    };

    rules.forEach(rule => {
      const parsed = this.parseRule(rule);
      if (parsed) {
        // 平台统计
        if (parsed.platform) {
          stats.byPlatform[parsed.platform] = (stats.byPlatform[parsed.platform] || 0) + 1;
        }

        // 类型统计
        stats.byType[parsed.type] = (stats.byType[parsed.type] || 0) + 1;

        // 策略统计
        if (parsed.policy) {
          stats.byPolicy[parsed.policy] = (stats.byPolicy[parsed.policy] || 0) + 1;
        }
      }
    });

    return stats;
  },

  /**
   * 策略组清理方法
   *
   * @param parsedRule - 解析后的规则对象
   * @param targetPlatform - 目标平台
   * @returns 清理后的规则对象
   */
  cleanupPolicyGroups(parsedRule: ParsedRule, targetPlatform: ProxyPlatform): ParsedRule {
    return RuleConverter.cleanupPolicyGroups(parsedRule, targetPlatform);
  },

  /**
   * 检查策略组是否为自定义策略组
   *
   * @param policy - 策略字符串
   * @returns 是否为自定义策略组
   */
  isCustomPolicyGroup(policy: string): boolean {
    return RuleConverter.isCustomPolicyGroup(policy);
  },

  /**
   * 清理策略组名称
   *
   * @param policy - 策略类型或字符串
   * @param targetPlatform - 目标平台
   * @returns 清理后的策略类型
   */
  cleanupPolicyName(policy: any, targetPlatform: ProxyPlatform): any {
    return RuleConverter.cleanupPolicyName(policy, targetPlatform);
  },

  /**
   * 验证域名格式
   *
   * @param domain - 待验证的域名
   * @returns 是否为有效域名
   */
  isValidDomain(domain: string): boolean {
    return WildcardAnalyzer.isValidDomain(domain);
  },
};

// 导出类型定义
export type {
  ParsedRule,
  RuleValidationResult,
  WildcardAnalysis,
  RuleStats,
  ParameterValidationResult,
} from './types';

// 导出子模块（供高级用户使用）
export { PlatformDetector, RuleParser, RuleConverter, RuleValidator, WildcardAnalyzer };

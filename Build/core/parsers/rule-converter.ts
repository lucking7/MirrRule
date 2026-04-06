/**
 * 规则转换器 - 在不同平台格式间转换规则
 */

import {
  ProxyPlatform,
  PolicyType,
  RULE_TO_PLATFORM_MAPPING,
  POLICY_TO_PLATFORM_MAPPING,
  PLATFORM_LOGICAL_SUPPORT,
  PLATFORM_PARAMETER_SUPPORT,
  STRATEGY_CLEANUP_CONFIG,
} from '../../constants/rule-formats';
import type { ParsedRule } from './types';
import { PlatformRuleValidator } from './rule-validator';
import { WildcardAnalyzer } from './wildcard-analyzer';
import { cleanPolicy } from './policy-cleaner';

/**
 * 规则转换器类
 */
export class RuleConverter {
  /**
   * 将解析后的规则转换为目标平台格式
   *
   * @param parsedRule - 解析后的规则对象
   * @param targetPlatform - 目标平台
   * @returns 转换后的规则字符串
   */
  static convertToTargetPlatform(
    this: void,
    parsedRule: ParsedRule,
    targetPlatform: ProxyPlatform
  ): string {
    if (parsedRule.isLogical && parsedRule.logicalOperator) {
      return RuleConverter.convertLogicalRule(parsedRule, targetPlatform);
    }

    return RuleConverter.convertNormalRule(parsedRule, targetPlatform);
  }

  /**
   * 转换逻辑规则
   */
  private static convertLogicalRule(
    this: void,
    parsedRule: ParsedRule,
    targetPlatform: ProxyPlatform
  ): string {
    const supportedOperators = PLATFORM_LOGICAL_SUPPORT[targetPlatform] || [];

    if (!parsedRule.logicalOperator || !supportedOperators.includes(parsedRule.logicalOperator)) {
      // 如果目标平台不支持逻辑操作符，返回原始规则或第一个子规则
      return parsedRule.subRules?.[0]
        ? RuleConverter.convertToTargetPlatform(parsedRule.subRules[0], targetPlatform)
        : parsedRule.raw;
    }

    // parsedRule.type 在 parseLogicalRule 中被设置为逻辑操作符（AND/OR/NOT）
    const operatorMapping = RULE_TO_PLATFORM_MAPPING[parsedRule.type];

    if (operatorMapping) {
      const targetOperator = operatorMapping[targetPlatform];

      if (targetOperator && parsedRule.subRules && parsedRule.subRules.length > 0) {
        const convertedSubRules = parsedRule.subRules.map(subRule =>
          RuleConverter.convertToTargetPlatform(subRule, targetPlatform)
        );

        return `${targetOperator},((${convertedSubRules.join('),(')}))`;
      }
    }

    return parsedRule.raw;
  }

  /**
   * 转换普通规则
   */
  private static convertNormalRule(
    this: void,
    parsedRule: ParsedRule,
    targetPlatform: ProxyPlatform
  ): string {
    const ruleMapping = RULE_TO_PLATFORM_MAPPING[parsedRule.type];
    const policyMapping = POLICY_TO_PLATFORM_MAPPING[parsedRule.policy || PolicyType.REJECT];

    if (!ruleMapping || !policyMapping) {
      return parsedRule.raw;
    }

    const targetRuleType = ruleMapping[targetPlatform];
    const targetPolicy = policyMapping[targetPlatform];

    if (!targetRuleType || !targetPolicy) {
      return parsedRule.raw;
    }

    let result = `${targetRuleType},${parsedRule.value}`;

    if (targetPlatform !== ProxyPlatform.SINGBOX) {
      result += `,${targetPolicy}`;
    }

    if (parsedRule.parameters && parsedRule.parameters.length > 0) {
      const supportedParams = PLATFORM_PARAMETER_SUPPORT[targetPlatform] || [];
      const validParams = parsedRule.parameters.filter(param => supportedParams.includes(param));
      if (validParams.length > 0) {
        result += `,${validParams.join(',')}`;
      }
    }

    if (parsedRule.options && parsedRule.options.length > 0) {
      result += `,${parsedRule.options.join(',')}`;
    }

    return result;
  }

  /**
   * 转换为RULE-SET payload格式（无策略组）
   * 严格遵循RULE-SET格式规范：规则类型,匹配值[,允许的参数]
   *
   * @param parsedRule - 解析后的规则对象
   * @returns RULE-SET格式的规则字符串
   */
  static convertToRuleSetPayload(this: void, parsedRule: ParsedRule): string {
    if (parsedRule.isLogical && parsedRule.logicalOperator) {
      return RuleConverter.convertLogicalRuleToRuleSet(parsedRule);
    }

    const ruleMapping = RULE_TO_PLATFORM_MAPPING[parsedRule.type];
    if (!ruleMapping) {
      return parsedRule.raw;
    }

    const targetRuleType = ruleMapping[ProxyPlatform.SURGE];
    if (!targetRuleType) {
      return parsedRule.raw;
    }

    let result = `${targetRuleType},${parsedRule.value}`;

    if (parsedRule.parameters) {
      const allowedParams = PlatformRuleValidator.filterRuleSetParameters(
        parsedRule.parameters,
        parsedRule.type
      );
      if (allowedParams.length > 0) {
        result += `,${allowedParams.join(',')}`;
      }
    }

    return result;
  }

  /**
   * 转换逻辑规则为RULE-SET格式
   */
  private static convertLogicalRuleToRuleSet(this: void, parsedRule: ParsedRule): string {
    // 保留逻辑规则，但移除策略，递归处理子规则
    if (parsedRule.subRules && parsedRule.subRules.length > 0) {
      const convertedSubRules = parsedRule.subRules.map(subRule =>
        RuleConverter.convertToRuleSetPayload(subRule)
      );
      // 逻辑规则格式：操作符,((子规则1),(子规则2))
      return `${parsedRule.logicalOperator},((${convertedSubRules.join('),(')}))`;
    }

    const originalParts = parsedRule.raw.split(',');
    if (originalParts.length >= 3) {
      const lastPart = originalParts[originalParts.length - 1].trim().toUpperCase();
      if (RuleConverter.isStandardPolicy(lastPart)) {
        return originalParts.slice(0, -1).join(',');
      }
    }

    return parsedRule.raw;
  }

  /**
   * 智能转换为RULE-SET格式（处理特殊格式）
   *
   * @param rule - 原始规则字符串
   * @returns RULE-SET格式的规则字符串（移除策略，仅保留允许参数）
   */
  static smartConvertToRuleSet(this: void, rule: string): string {
    const trimmed = rule.trim();

    if (
      !trimmed ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('!') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith(';')
    ) {
      return rule;
    }

    if (trimmed.startsWith('.') && !trimmed.includes(',')) {
      const domain = trimmed.slice(1);
      if (domain && WildcardAnalyzer.isValidDomain(domain)) {
        return `DOMAIN-SUFFIX,${domain}`;
      }
    }

    return cleanPolicy(rule);
  }

  /**
   * 策略组清理方法
   * 根据规则类型和平台要求清理策略组
   *
   * @param parsedRule - 解析后的规则对象
   * @param targetPlatform - 目标平台
   * @returns 清理后的规则对象
   */
  static cleanupPolicyGroups(
    this: void,
    parsedRule: ParsedRule,
    _targetPlatform: ProxyPlatform
  ): ParsedRule {
    const cleanupConfig = STRATEGY_CLEANUP_CONFIG[parsedRule.type];
    if (!cleanupConfig) {
      return parsedRule;
    }

    const cleanedRule = { ...parsedRule };

    switch (cleanupConfig.cleanupMode) {
      case 'keep':
        // 保持策略不变
        break;

      case 'remove':
        cleanedRule.policy = undefined;
        break;

      case 'convert':
        if (cleanedRule.isLogical && cleanedRule.subRules && cleanedRule.subRules.length > 0) {
          for (const subRule of cleanedRule.subRules) {
            if (subRule.policy) {
              cleanedRule.policy = subRule.policy;
              break;
            }
          }
        }
        break;

      default:
        break;
    }

    return cleanedRule;
  }

  /**
   * 清理策略组名称（移除自定义策略组，保留标准策略）
   *
   * @param policy - 策略类型或字符串
   * @param targetPlatform - 目标平台
   * @returns 清理后的策略类型
   */
  static cleanupPolicyName(
    this: void,
    policy: PolicyType | string | undefined,
    targetPlatform: ProxyPlatform
  ): PolicyType | undefined {
    if (!policy) {
      return undefined;
    }

    const policyStr = typeof policy === 'string' ? policy : policy;

    if (
      RuleConverter.isCustomPolicyGroup(policyStr) &&
      (targetPlatform === ProxyPlatform.CLASH || targetPlatform === ProxyPlatform.SINGBOX)
    ) {
      return PolicyType.PROXY;
    }

    return policy as PolicyType;
  }

  /**
   * 检查策略组是否为自定义策略组
   */
  static isCustomPolicyGroup(this: void, policy: string): boolean {
    return !RuleConverter.isStandardPolicy(policy.toUpperCase());
  }

  /**
   * 检查是否为标准策略
   */
  private static isStandardPolicy(this: void, policy: string): boolean {
    const standardPolicies = [
      'DIRECT',
      'REJECT',
      'REJECT-200',
      'REJECT-IMG',
      'REJECT-DICT',
      'REJECT-ARRAY',
      'PROXY',
    ];
    return standardPolicies.includes(policy);
  }
}

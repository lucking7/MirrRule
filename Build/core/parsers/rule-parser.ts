/**
 * 规则解析器 - 核心解析逻辑
 *
 * 职责：
 * - 解析规则字符串为结构化对象
 * - 处理逻辑规则（AND/OR/NOT）
 * - 推断默认策略
 * - 协调其他组件完成解析任务
 */

import {
  ProxyPlatform,
  RuleType,
  PolicyType,
  RuleParameter,
  LogicalOperator,
  PLATFORM_RULE_MAPPING,
  PLATFORM_POLICY_MAPPING,
  DEFAULT_POLICIES,
  PLATFORM_LOGICAL_SUPPORT,
} from '../../constants/rule-formats';
import type { ParsedRule } from './types';
import { PlatformDetector } from './platform-detector';
import { WildcardAnalyzer } from './wildcard-analyzer';
import { RuleValidator } from './rule-validator';

/**
 * 规则解析器类
 */
export class RuleParser {
  /**
   * 解析规则字符串
   *
   * @param rule - 原始规则字符串
   * @param targetPlatform - 可选的目标平台（用于验证）
   * @returns 解析后的规则对象，无法解析返回null
   */
  static parseRule(rule: string, targetPlatform?: ProxyPlatform): ParsedRule | null {
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

    const detectedPlatform = PlatformDetector.detectPlatform(trimmed);
    if (!detectedPlatform) {
      return null;
    }

    const parts = trimmed.split(',').map(part => part.trim());
    if (parts.length < 2) {
      return null;
    }

    const ruleTypeStr = parts[0].toUpperCase();

    // 检查是否为逻辑规则
    if (ruleTypeStr === 'AND' || ruleTypeStr === 'OR' || ruleTypeStr === 'NOT') {
      return this.parseLogicalRule(trimmed, detectedPlatform);
    }

    return this.parseNormalRule(parts, rule, detectedPlatform, ruleTypeStr);
  }

  /**
   * 解析普通规则
   */
  private static parseNormalRule(
    parts: string[],
    originalRule: string,
    detectedPlatform: ProxyPlatform,
    ruleTypeStr: string
  ): ParsedRule | null {
    const value = parts[1];

    // 获取规则类型映射
    const platformMapping = PLATFORM_RULE_MAPPING[detectedPlatform];
    if (!platformMapping) {
      return null;
    }

    // 转换为标准规则类型
    const standardRuleType = platformMapping[ruleTypeStr];
    if (!standardRuleType) {
      return null;
    }

    // 处理QuantumultX的host-wildcard特殊情况
    let finalRuleType = standardRuleType;
    let finalValue = value;

    if (ruleTypeStr === 'HOST-WILDCARD' && detectedPlatform === ProxyPlatform.QUANTUMULT_X) {
      const wildcardAnalysis = WildcardAnalyzer.analyzeWildcard(value);
      if (wildcardAnalysis.isSimpleSuffix && wildcardAnalysis.extractedSuffix) {
        finalRuleType = RuleType.DOMAIN_SUFFIX;
        finalValue = wildcardAnalysis.extractedSuffix;
      }
    }

    // 解析策略和参数
    const { policy, parameters, options } = this.parsePolicyAndParameters(
      parts,
      detectedPlatform,
      finalRuleType,
      finalValue
    );

    return {
      type: finalRuleType,
      value: finalValue,
      policy,
      parameters,
      options,
      raw: originalRule,
      platform: detectedPlatform,
      isLogical: false,
    };
  }

  /**
   * 解析策略和参数
   */
  private static parsePolicyAndParameters(
    parts: string[],
    detectedPlatform: ProxyPlatform,
    ruleType: RuleType,
    value: string
  ): {
    policy: PolicyType | undefined;
    parameters: RuleParameter[];
    options: string[];
  } {
    let policy: PolicyType | undefined;
    let parameters: RuleParameter[] = [];
    let options: string[] = [];

    if (parts.length >= 3) {
      // 解析策略
      policy = this.parsePolicy(parts[2], detectedPlatform);

      // 处理额外参数和选项
      if (parts.length > 3) {
        const extraParts = parts.slice(3);
        ({ parameters, options } = this.parseExtraParameters(extraParts));
      }
    } else {
      // 对于Loon等缺少策略的规则，根据规则类型推断默认策略
      policy = this.inferDefaultPolicy(ruleType, value);
    }

    // 验证参数的适用性
    const validatedParameters = RuleValidator.validateParameters(ruleType, policy, parameters);
    parameters = validatedParameters.validParameters;

    return { policy, parameters, options };
  }

  /**
   * 解析策略
   */
  private static parsePolicy(policyStr: string, platform: ProxyPlatform): PolicyType {
    const policyLower = policyStr.toLowerCase();
    const policyMapping = PLATFORM_POLICY_MAPPING[platform];

    if (policyMapping) {
      if (policyMapping[policyLower]) {
        return policyMapping[policyLower];
      }
      if (policyMapping[policyStr.toUpperCase()]) {
        return policyMapping[policyStr.toUpperCase()];
      }
    }

    // 尝试从默认策略中匹配
    return DEFAULT_POLICIES[policyLower] || PolicyType.REJECT;
  }

  /**
   * 解析额外参数
   */
  private static parseExtraParameters(extraParts: string[]): {
    parameters: RuleParameter[];
    options: string[];
  } {
    const parameters: RuleParameter[] = [];
    const options: string[] = [];

    for (const part of extraParts) {
      const paramLower = part.toLowerCase();
      switch (paramLower) {
        case 'no-resolve': {
          parameters.push(RuleParameter.NO_RESOLVE);

          break;
        }
        case 'pre-matching': {
          parameters.push(RuleParameter.PRE_MATCHING);

          break;
        }
        case 'extended-matching': {
          parameters.push(RuleParameter.EXTENDED_MATCHING);

          break;
        }
        default: {
          options.push(part);
        }
      }
    }

    return { parameters, options };
  }

  /**
   * 推断默认策略
   * 基于规则值中的关键词推断策略类型
   */
  private static inferDefaultPolicy(ruleType: RuleType, value: string): PolicyType {
    const lowerValue = value.toLowerCase();

    // 对于广告拦截相关的规则，默认使用REJECT
    const adKeywords = [
      'ad',
      'ads',
      'advertising',
      'tracker',
      'analytics',
      'doubleclick',
      'googleads',
    ];
    if (adKeywords.some(keyword => lowerValue.includes(keyword))) {
      return PolicyType.REJECT;
    }

    // 对于中国大陆相关的规则，默认使用DIRECT
    const cnKeywords = ['cn', 'china', 'baidu', 'qq', 'weibo', 'taobao', 'alipay'];
    if (cnKeywords.some(keyword => lowerValue.includes(keyword))) {
      return PolicyType.DIRECT;
    }

    // 默认策略
    return PolicyType.REJECT;
  }

  /**
   * 解析逻辑规则（增强版，支持复杂嵌套）
   */
  private static parseLogicalRule(rule: string, platform: ProxyPlatform): ParsedRule | null {
    const parts = rule.split(',').map(part => part.trim());
    if (parts.length < 2) {
      return null;
    }

    const operatorStr = parts[0].toUpperCase() as LogicalOperator;
    const subRuleText = parts.slice(1).join(',').trim();

    // 🔧 移除平台支持检查 - 解析阶段应该解析所有逻辑规则
    // 转换阶段会在 convertLogicalRule 中检查目标平台是否支持
    // const supportedOperators = PLATFORM_LOGICAL_SUPPORT[platform] || [];
    // if (!supportedOperators.includes(operatorStr)) {
    //   return null;
    // }

    // 解析子规则
    const subRules = this.parseSubRules(subRuleText, operatorStr);

    // 策略继承逻辑：从第一个有效子规则继承策略
    let inheritedPolicy: PolicyType | undefined;
    for (const subRule of subRules) {
      if (subRule.policy) {
        inheritedPolicy = subRule.policy;
        break;
      }
    }

    return {
      type: operatorStr as any, // 逻辑操作符作为特殊的规则类型
      value: subRuleText,
      policy: inheritedPolicy,
      parameters: [],
      options: [],
      raw: rule,
      platform,
      isLogical: true,
      logicalOperator: operatorStr,
      subRules,
    };
  }

  /**
   * 解析子规则
   */
  private static parseSubRules(subRuleText: string, operator: LogicalOperator): ParsedRule[] {
    const subRules: ParsedRule[] = [];

    // 处理括号嵌套的复杂逻辑规则
    if (subRuleText.includes('((') && subRuleText.includes('))')) {
      const nestedRules = this.parseNestedLogicalRule(subRuleText);
      subRules.push(...nestedRules);
    } else {
      // 简单逻辑规则解析
      if (operator === LogicalOperator.NOT) {
        // NOT只有一个子规则
        const subRule = this.parseRule(subRuleText);
        if (subRule) {
          subRules.push(subRule);
        }
      } else {
        // AND/OR可能有多个子规则，用括号分隔
        const subRuleTexts = this.splitLogicalSubRules(subRuleText);
        for (const text of subRuleTexts) {
          const subRule = this.parseRule(text);
          if (subRule) {
            subRules.push(subRule);
          }
        }
      }
    }

    return subRules;
  }

  /**
   * 分割逻辑子规则
   */
  private static splitLogicalSubRules(text: string): string[] {
    const rules: string[] = [];
    let current = '';
    let depth = 0;
    let inParens = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (char === '(') {
        depth++;
        inParens = true;
        current += char;
      } else if (char === ')') {
        depth--;
        current += char;
        if (depth === 0) {
          inParens = false;
          if (current.trim()) {
            rules.push(current.trim().replaceAll(/^\(|\)$/g, ''));
            current = '';
          }
        }
      } else if (char === ',' && !inParens) {
        if (current.trim()) {
          rules.push(current.trim());
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      rules.push(current.trim());
    }

    return rules.length > 0 ? rules : [text];
  }

  /**
   * 解析嵌套逻辑规则
   *
   * 处理格式: ((rule1),(rule2),(rule3))
   * 例如: ((DOMAIN-KEYWORD,chatgpt-async-webps-prod-),(DOMAIN-SUFFIX,webpubsub.azure.com))
   */
  private static parseNestedLogicalRule(text: string): ParsedRule[] {
    const rules: ParsedRule[] = [];

    // 移除前导/尾随空格
    const trimmed = text.trim();

    // 检查是否为嵌套格式 ((...)(...))
    if (!trimmed.startsWith('((') || !trimmed.endsWith('))')) {
      // 不是嵌套格式，尝试直接解析
      const subRule = this.parseRule(trimmed);
      if (subRule) {
        rules.push(subRule);
      }
      return rules;
    }

    // 移除外层括号: ((rule1),(rule2)) → (rule1),(rule2)
    const inner = trimmed.slice(2, -2);

    // 按 ),( 分割子规则
    const subRuleTexts = inner.split('),(');

    // 解析每个子规则
    for (const subRuleText of subRuleTexts) {
      // 移除前导/尾随括号和空格
      let cleaned = subRuleText.trim();
      if (cleaned.startsWith('(')) {
        cleaned = cleaned.slice(1);
      }
      if (cleaned.endsWith(')')) {
        cleaned = cleaned.slice(0, -1);
      }
      cleaned = cleaned.trim();

      // 解析子规则
      const subRule = this.parseRule(cleaned);
      if (subRule) {
        rules.push(subRule);
      }
    }

    return rules;
  }
}

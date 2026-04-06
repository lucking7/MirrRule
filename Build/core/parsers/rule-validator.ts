/**
 * 规则验证器 - 验证规则格式和参数的有效性
 */

import type { ProxyPlatform, PolicyType, LogicalOperator } from '../../constants/rule-formats';
import {
  RuleType,
  RuleParameter,
  PARAMETER_APPLICABILITY,
  PLATFORM_PARAMETER_SUPPORT,
  PLATFORM_LOGICAL_SUPPORT,
} from '../../constants/rule-formats';
import type { ParsedRule, RuleValidationResult, ParameterValidationResult } from './types';

/**
 * 规则验证器类
 */
export class PlatformRuleValidator {
  /**
   * 验证规则的完整性
   *
   * @param parsed - 解析后的规则对象
   * @param targetPlatform - 目标平台
   * @returns 验证结果（包含错误和警告信息）
   */
  static validateRule(
    this: void,
    parsed: ParsedRule,
    targetPlatform: ProxyPlatform
  ): RuleValidationResult {
    const result: RuleValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    // 检查平台兼容性
    if (parsed.platform && parsed.platform !== targetPlatform) {
      result.warnings.push(`规则格式为 ${parsed.platform}，但目标平台为 ${targetPlatform}`);
    }

    // 检查参数支持
    if (parsed.parameters) {
      const paramErrors = PlatformRuleValidator.validatePlatformParameterSupport(
        parsed.parameters,
        targetPlatform
      );
      result.warnings.push(...paramErrors);
    }

    // 检查逻辑规则支持
    if (parsed.isLogical && parsed.logicalOperator) {
      const operatorError = PlatformRuleValidator.validateLogicalOperator(
        parsed.logicalOperator,
        targetPlatform
      );
      if (operatorError) {
        result.errors.push(operatorError);
        result.isValid = false;
      }
    }

    return result;
  }

  /**
   * 验证平台参数支持
   */
  private static validatePlatformParameterSupport(
    this: void,
    parameters: RuleParameter[],
    platform: ProxyPlatform
  ): string[] {
    const warnings: string[] = [];
    const supportedParams = PLATFORM_PARAMETER_SUPPORT[platform] || [];

    for (const param of parameters) {
      if (!supportedParams.includes(param)) {
        warnings.push(`平台 ${platform} 不支持参数 ${param}`);
      }
    }

    return warnings;
  }

  /**
   * 验证逻辑操作符支持
   */
  private static validateLogicalOperator(
    this: void,
    operator: LogicalOperator,
    platform: ProxyPlatform
  ): string | null {
    const supportedOperators = PLATFORM_LOGICAL_SUPPORT[platform] || [];
    if (!supportedOperators.includes(operator)) {
      return `平台 ${platform} 不支持逻辑操作符 ${operator}`;
    }
    return null;
  }

  /**
   * 验证参数的适用性
   *
   * @param ruleType - 规则类型
   * @param policy - 策略类型
   * @param parameters - 参数列表
   * @returns 验证结果（有效参数列表和错误信息）
   */
  static validateParameters(
    this: void,
    ruleType: RuleType,
    policy: PolicyType | undefined,
    parameters: RuleParameter[]
  ): ParameterValidationResult {
    const validParameters: RuleParameter[] = [];
    const errors: string[] = [];

    for (const param of parameters) {
      const applicability = PARAMETER_APPLICABILITY[param];

      // 检查规则类型适用性
      if (!applicability.ruleTypes.includes(ruleType)) {
        errors.push(`参数 ${param} 不适用于规则类型 ${ruleType}`);
        continue;
      }

      // 检查策略适用性（如果有限制）
      if (applicability.policies && policy && !applicability.policies.includes(policy)) {
        errors.push(`参数 ${param} 不适用于策略 ${policy}`);
        continue;
      }

      validParameters.push(param);
    }

    return { validParameters, errors };
  }

  /**
   * 过滤RULE-SET允许的参数
   * 仅保留no-resolve和extended-matching参数
   *
   * @param parameters - 参数列表
   * @param ruleType - 规则类型
   * @returns 过滤后的参数列表
   */
  static filterRuleSetParameters(
    this: void,
    parameters: RuleParameter[],
    ruleType: RuleType
  ): string[] {
    const allowedParams: string[] = [];

    for (const param of parameters) {
      // eslint-disable-next-line default-case, @typescript-eslint/switch-exhaustiveness-check -- switch over a closed enum where unknown params are intentionally ignored
      switch (param) {
        case RuleParameter.NO_RESOLVE:
          // 仅适用于IP类规则
          if (PlatformRuleValidator.isIpRule(ruleType)) {
            allowedParams.push('no-resolve');
          }
          break;
        case RuleParameter.EXTENDED_MATCHING:
          // 仅适用于域名类规则
          if (PlatformRuleValidator.isDomainRule(ruleType)) {
            allowedParams.push('extended-matching');
          }
          break;
        // 其他参数在RULE-SET中不被支持，直接忽略
      }
    }

    return allowedParams;
  }

  /**
   * 检查是否为IP类规则
   */
  private static isIpRule(this: void, ruleType: RuleType): boolean {
    return [RuleType.IP_CIDR, RuleType.IP_CIDR6, RuleType.GEOIP, RuleType.IP_ASN].includes(
      ruleType
    );
  }

  /**
   * 检查是否为域名类规则
   */
  private static isDomainRule(this: void, ruleType: RuleType): boolean {
    return [
      RuleType.DOMAIN,
      RuleType.DOMAIN_SUFFIX,
      RuleType.DOMAIN_KEYWORD,
      RuleType.DOMAIN_WILDCARD,
    ].includes(ruleType);
  }
}

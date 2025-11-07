/**
 * 规则解析器类型定义
 *
 * 定义规则解析、验证和转换所需的核心接口和类型
 */

import type {
  ProxyPlatform,
  RuleType,
  PolicyType,
  RuleParameter,
  LogicalOperator
} from '../../constants/rule-formats';

/**
 * 解析后的规则对象
 */
export interface ParsedRule {
  /** 规则类型 */
  type: RuleType,
  /** 规则值 */
  value: string,
  /** 策略 */
  policy?: PolicyType,
  /** 规则参数 */
  parameters?: RuleParameter[],
  /** 额外选项 */
  options?: string[],
  /** 原始规则文本 */
  raw: string,
  /** 检测到的平台 */
  platform?: ProxyPlatform,
  /** 是否为逻辑规则 */
  isLogical?: boolean,
  /** 逻辑操作符（仅用于逻辑规则） */
  logicalOperator?: LogicalOperator,
  /** 子规则（仅用于逻辑规则） */
  subRules?: ParsedRule[]
}

/**
 * 规则验证结果
 */
export interface RuleValidationResult {
  /** 是否有效 */
  isValid: boolean,
  /** 错误信息 */
  errors: string[],
  /** 警告信息 */
  warnings: string[]
}

/**
 * 通配符分析结果
 */
export interface WildcardAnalysis {
  /** 是否为简单后缀模式 */
  isSimpleSuffix: boolean,
  /** 是否包含复杂通配符 */
  hasComplexWildcard: boolean,
  /** 提取的域名后缀（如果是简单后缀） */
  extractedSuffix?: string,
  /** 原始模式 */
  originalPattern: string
}

/**
 * 规则统计信息
 */
export interface RuleStats {
  total: number,
  byPlatform: Record<string, number>,
  byType: Record<string, number>,
  byPolicy: Record<string, number>
}

/**
 * 参数验证结果
 */
export interface ParameterValidationResult {
  validParameters: RuleParameter[],
  errors: string[]
}

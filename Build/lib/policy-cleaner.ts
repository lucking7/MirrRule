/**
 * 统一的 Surge 规则策略清理工具
 * 用于移除规则中的策略组，仅保留必要参数
 */

/**
 * Surge 规则允许保留的参数
 * 仅保留这 3 个参数，其他一律移除
 */
const ALLOWED_PARAMETERS = [
  'no-resolve', // 不进行 DNS 解析（适用于 IP 规则）
  'pre-matching', // 预匹配
  'extended-matching' // 扩展匹配
] as const;

/**
 * Surge 内置策略（可在模块中直接使用，不依赖外部策略组）
 *
 * - DIRECT:          直连
 * - REJECT:          拦截并返回错误页面/RST
 * - REJECT-DROP:     静默丢弃连接（不回复）
 * - REJECT-TINYGIF:  拦截并返回 1×1 透明 GIF（适用于图片广告）
 * - REJECT-NO-DROP:  同 REJECT，但保证不会被自动优化为 DROP
 * - REJECT-DICT:     拦截并返回空 JSON 字典 {}
 * - REJECT-ARRAY:    拦截并返回空 JSON 数组 []
 */
const SURGE_BUILTIN_POLICIES = new Set([
  'direct',
  'reject',
  'reject-drop',
  'reject-tinygif',
  'reject-no-drop',
  'reject-dict',
  'reject-array'
]);

/** 模块规则中缺失策略时的默认策略 */
const DEFAULT_MODULE_POLICY = 'REJECT';

/**
 * 清理单条 Surge 规则的策略组
 *
 * 处理逻辑：
 * 1. 保留前两部分：规则类型,匹配值
 * 2. 从第三部分开始，只保留允许的参数
 * 3. 移除所有策略组（标准和自定义）
 *
 * @param rule - 原始规则字符串
 * @returns 清理后的规则（无策略，仅保留允许参数）
 *
 * @example
 * cleanPolicy('DOMAIN-SUFFIX,example.com,PROXY')
 * // => 'DOMAIN-SUFFIX,example.com'
 *
 * @example
 * cleanPolicy('IP-CIDR,1.2.3.0/24,REJECT,no-resolve')
 * // => 'IP-CIDR,1.2.3.0/24,no-resolve'
 *
 * @example
 * cleanPolicy('DOMAIN,test.com,MyGroup,pre-matching,extended-matching')
 * // => 'DOMAIN,test.com,pre-matching,extended-matching'
 */
export function cleanPolicy(rule: string): string {
  const trimmed = rule.trim();

  // 跳过注释和空行
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('!')) {
    return rule;
  }

  // 格式：AND,((规则1),(规则2)),策略
  const firstComma = trimmed.indexOf(',');
  if (firstComma !== -1) {
    const ruleType = trimmed.slice(0, Math.max(0, firstComma)).trim().toUpperCase();

    if (ruleType === 'AND' || ruleType === 'OR' || ruleType === 'NOT') {
      // 这是逻辑规则，需要找到最后的 )) 来定位策略
      const lastDoubleParen = trimmed.lastIndexOf('))');

      if (lastDoubleParen !== -1) {
        // 找到闭合括号后的部分
        const afterParens = trimmed.slice(Math.max(0, lastDoubleParen + 2)).trim();

        // 如果闭合括号后有逗号，说明后面是策略或参数
        if (afterParens.startsWith(',')) {
          const remaining = afterParens.slice(1).trim();
          const remainingParts = remaining.split(',').map(p => p.trim());
          const allowedParams: string[] = [];

          // 只保留允许的参数
          for (const part of remainingParts) {
            const partLower = part.toLowerCase();
            if (ALLOWED_PARAMETERS.includes(partLower as any)) {
              allowedParams.push(part);
            }
          }

          // 构建结果：逻辑规则部分 + 允许的参数
          const logicalPart = trimmed.slice(0, Math.max(0, lastDoubleParen + 2));
          if (allowedParams.length > 0) {
            return `${logicalPart},${allowedParams.join(',')}`;
          }
          return logicalPart;
        }
      }

      // 没有找到完整的逻辑规则结构，返回原规则
      return rule;
    }
  }

  // 常规规则处理
  const parts = rule.split(',').map(p => p.trim());

  // 规则至少需要 2 部分：规则类型,值
  if (parts.length < 2) {
    return rule;
  }

  // 如果只有 2 部分，直接返回（无策略无参数）
  if (parts.length === 2) {
    return rule;
  }

  // 保留前两部分（规则类型和匹配值）
  const result = [parts[0], parts[1]];

  // 检查第三部分及之后的内容，只保留允许的参数
  for (let i = 2; i < parts.length; i++) {
    const part = parts[i];
    const partLower = part.toLowerCase();

    // 如果是允许的参数，保留
    if (ALLOWED_PARAMETERS.includes(partLower as any)) {
      result.push(part);
    }
    // 其他内容（策略组、未知参数）一律跳过
  }

  return result.join(',');
}

/**
 * 批量清理规则列表
 *
 * @param rules - 规则数组
 * @returns 清理后的规则数组
 *
 * @example
 * cleanPolicies([
 *   'DOMAIN-SUFFIX,example.com,PROXY',
 *   'IP-CIDR,1.2.3.0/24,REJECT,no-resolve'
 * ])
 * // => [
 * //   'DOMAIN-SUFFIX,example.com',
 * //   'IP-CIDR,1.2.3.0/24,no-resolve'
 * // ]
 */
export function cleanPolicies(rules: string[]): string[] {
  return rules.map(cleanPolicy);
}

/**
 * 检查规则是否包含策略
 *
 * @param rule - 规则字符串
 * @returns 如果规则包含策略返回 true
 */
export function hasPolicy(rule: string): boolean {
  const cleaned = cleanPolicy(rule);
  return cleaned !== rule;
}

/**
 * 检查规则是否包含允许的参数
 *
 * @param rule - 规则字符串
 * @returns 包含的允许参数列表
 */
export function getRetainedParameters(rule: string): string[] {
  const parts = rule.split(',').map(p => p.trim().toLowerCase());
  const retained: string[] = [];

  for (let i = 2; i < parts.length; i++) {
    if (ALLOWED_PARAMETERS.includes(parts[i] as any)) {
      retained.push(parts[i]);
    }
  }

  return retained;
}

/**
 * 为模块输出清理规则策略
 *
 * 与 cleanPolicy 不同，此函数：
 * 1. 保留 Surge 内置策略（REJECT、REJECT-DROP、DIRECT 等）
 * 2. 将自定义策略组替换为 REJECT（模块不应引用外部策略组）
 * 3. 为缺失策略的规则补充默认 REJECT 策略
 * 4. 始终保留允许的参数（no-resolve、pre-matching、extended-matching）
 *
 * @param rule - 原始规则字符串
 * @returns 清理后的规则（保留内置策略 + 参数）
 *
 * @example
 * cleanPolicyForModule('DOMAIN-SUFFIX,ad.com,MyProxy')
 * // => 'DOMAIN-SUFFIX,ad.com,REJECT'
 *
 * @example
 * cleanPolicyForModule('DOMAIN-SUFFIX,ad.com,REJECT-DROP,no-resolve')
 * // => 'DOMAIN-SUFFIX,ad.com,REJECT-DROP,no-resolve'
 *
 * @example
 * cleanPolicyForModule('DOMAIN-SUFFIX,ad.com')
 * // => 'DOMAIN-SUFFIX,ad.com,REJECT'
 *
 * @example
 * cleanPolicyForModule('IP-CIDR,1.2.3.0/24,no-resolve')
 * // => 'IP-CIDR,1.2.3.0/24,REJECT,no-resolve'
 */
export function cleanPolicyForModule(rule: string): string {
  const trimmed = rule.trim();

  // 跳过注释和空行
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('!')) {
    return rule;
  }

  // 处理逻辑规则（AND, OR, NOT）
  const firstComma = trimmed.indexOf(',');
  if (firstComma !== -1) {
    const ruleType = trimmed.slice(0, Math.max(0, firstComma)).trim().toUpperCase();
    if (ruleType === 'AND' || ruleType === 'OR' || ruleType === 'NOT') {
      return _cleanLogicalRuleForModule(trimmed);
    }
  }

  // 常规规则处理
  const parts = rule.split(',').map(p => p.trim());
  if (parts.length < 2) {
    return rule;
  }

  const result = [parts[0], parts[1]];
  let foundPolicy = false;
  const params: string[] = [];

  for (let i = 2; i < parts.length; i++) {
    const part = parts[i];
    const partLower = part.toLowerCase();

    if (SURGE_BUILTIN_POLICIES.has(partLower) && !foundPolicy) {
      // 保留 Surge 内置策略，规范大小写
      result.push(part.toUpperCase());
      foundPolicy = true;
    } else if (ALLOWED_PARAMETERS.includes(partLower as any)) {
      // 收集允许的参数，最后统一追加
      params.push(part);
    } else if (!foundPolicy) {
      // 自定义策略组 → 替换为默认 REJECT
      result.push(DEFAULT_MODULE_POLICY);
      foundPolicy = true;
    }
    // 其他内容（重复策略、未知参数）直接忽略
  }

  // 如果没有找到任何策略，补充默认 REJECT
  if (!foundPolicy) {
    result.push(DEFAULT_MODULE_POLICY);
  }

  // 参数追加在策略之后
  result.push(...params);
  return result.join(',');
}

/**
 * 清理逻辑规则（AND, OR, NOT）的策略，保留内置策略
 */
function _cleanLogicalRuleForModule(rule: string): string {
  const lastDoubleParen = rule.lastIndexOf('))');
  if (lastDoubleParen === -1) {
    return rule;
  }

  const logicalPart = rule.slice(0, lastDoubleParen + 2);
  const afterParens = rule.slice(lastDoubleParen + 2).trim();

  // 闭合括号后没有逗号，补充默认策略
  if (!afterParens.startsWith(',')) {
    return `${logicalPart},${DEFAULT_MODULE_POLICY}`;
  }

  const remaining = afterParens.slice(1).trim();
  const remainingParts = remaining.split(',').map(p => p.trim());

  let foundPolicy = false;
  const kept: string[] = [];
  const params: string[] = [];

  for (const part of remainingParts) {
    const partLower = part.toLowerCase();
    if (SURGE_BUILTIN_POLICIES.has(partLower) && !foundPolicy) {
      kept.push(part.toUpperCase());
      foundPolicy = true;
    } else if (ALLOWED_PARAMETERS.includes(partLower as any)) {
      params.push(part);
    } else if (!foundPolicy) {
      kept.push(DEFAULT_MODULE_POLICY);
      foundPolicy = true;
    }
  }

  if (!foundPolicy) {
    kept.push(DEFAULT_MODULE_POLICY);
  }

  kept.push(...params);
  return `${logicalPart},${kept.join(',')}`;
}

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

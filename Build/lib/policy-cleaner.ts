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
 * 按逗号拆分规则字段。字段开头的双引号包住的内容属于同一字段；未加引号的 URL-REGEX 正则中，
 * 转义逗号以及字符类、分组和量词里的逗号也不是分隔符。
 */
function splitRuleFields(rule: string): string[] {
  const firstComma = rule.indexOf(',');
  const isUrlRegex = firstComma !== -1 && rule.slice(0, firstComma).trim().toUpperCase() === 'URL-REGEX';
  const fields: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  let inCharacterClass = false;
  let groupDepth = 0;
  let quantifierDepth = 0;
  for (let i = 0; i < rule.length; i++) {
    const character = rule[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted) {
      if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"' && !rule.slice(start, i).trim()) {
      quoted = true;
      continue;
    }
    if (isUrlRegex && fields.length === 1) {
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (inCharacterClass) {
        if (character === ']') inCharacterClass = false;
        continue;
      }
      switch (character) {
        case '[':
          inCharacterClass = true;
          break;
        case '(':
          groupDepth++;
          break;
        case ')':
          groupDepth = Math.max(0, groupDepth - 1);
          break;
        case '{':
          quantifierDepth++;
          break;
        case '}':
          quantifierDepth = Math.max(0, quantifierDepth - 1);
          break;
        default:
          break;
      }
    }
    if (character === ',' && groupDepth === 0 && quantifierDepth === 0) {
      fields.push(rule.slice(start, i).trim());
      start = i + 1;
    }
  }
  fields.push(rule.slice(start).trim());
  return fields;
}

/** Preserve source switches separately from the case-insensitive rule type. */
export function splitRulePrefix(rule: string): { prefix: string, body: string } {
  const prefix = /^(?:{{{[^{}]+}}}\s*)+/.exec(rule)?.[0] ?? '';
  return { prefix, body: rule.slice(prefix.length) };
}

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
  const { prefix, body } = splitRulePrefix(trimmed);
  if (prefix) return prefix + cleanPolicy(body);

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
  const parts = splitRuleFields(rule);

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

/** 源模块参数（如 {{{policy}}}）由用户在 Surge 中填写，原样保留。 */
const PARAMETER_PATTERN = /{{{[^{}]+}}}/;

/**
 * 为模块输出清理规则策略
 *
 * 与 cleanPolicy 不同，此函数：
 * 1. 保留 Surge 内置策略（REJECT、REJECT-DROP、DIRECT 等），规范为大写
 * 2. 保留含参数的策略（如 {{{policy}}}）
 * 3. 为缺失策略的规则补充默认 REJECT 策略
 * 4. 始终保留允许的参数（no-resolve、pre-matching、extended-matching）
 *
 * 模块规则只能使用内置策略或用户配置中存在的策略，未知策略会让 Surge 报错。
 * 因此字面量的非内置策略（PROXY、策略组名）返回 null，由调用方删除该规则并警告。
 *
 * @param rule - 原始规则字符串
 * @returns 清理后的规则；策略不是内置策略也不是参数时返回 null
 *
 * @example
 * cleanPolicyForModule('DOMAIN-SUFFIX,ad.com,MyProxy')
 * // => null
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
export function cleanPolicyForModule(rule: string): string | null {
  const trimmed = rule.trim();
  const { prefix, body } = splitRulePrefix(trimmed);
  if (prefix) {
    const cleaned = cleanPolicyForModule(body);
    return cleaned === null ? null : prefix + cleaned;
  }

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
  const parts = splitRuleFields(rule);
  if (parts.length < 2) {
    return rule;
  }

  const policyAndParams = _modulePolicyFields(parts.slice(2));
  return policyAndParams && [parts[0], parts[1], ...policyAndParams].join(',');
}

/**
 * 清理逻辑规则（AND, OR, NOT）的策略，保留内置策略
 */
function _cleanLogicalRuleForModule(rule: string): string | null {
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

  const policyAndParams = _modulePolicyFields(afterParens.slice(1).split(',').map(p => p.trim()));
  return policyAndParams && `${logicalPart},${policyAndParams.join(',')}`;
}

/** 返回策略和允许的参数；第一个非参数字段是未知字面量策略时返回 null。 */
function _modulePolicyFields(fields: string[]): string[] | null {
  let policy: string | undefined;
  const params: string[] = [];

  for (const part of fields) {
    const partLower = part.toLowerCase();
    if (ALLOWED_PARAMETERS.includes(partLower as any)) {
      params.push(part);
    } else if (!part || policy !== undefined) {
      // 空字段、重复策略、未知参数直接忽略
    } else if (SURGE_BUILTIN_POLICIES.has(partLower)) {
      policy = part.toUpperCase();
    } else if (PARAMETER_PATTERN.test(part)) {
      policy = part;
    } else {
      return null;
    }
  }

  return [policy ?? DEFAULT_MODULE_POLICY, ...params];
}

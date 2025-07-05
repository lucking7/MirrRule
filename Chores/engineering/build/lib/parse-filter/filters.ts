/**
 * AdGuard 过滤规则解析器
 * 解析 AdGuard/uBlock Origin 等格式的过滤规则
 */

export interface ParsedFilter {
  /**
   * 规则类型
   */
  type: 'block' | 'allow' | 'hide' | 'script' | 'redirect' | 'other';

  /**
   * 匹配模式
   */
  pattern: string;

  /**
   * 域名（如果是域名规则）
   */
  domain?: string;

  /**
   * 选项
   */
  options?: string[];

  /**
   * 是否是例外规则
   */
  isException?: boolean;

  /**
   * 原始规则
   */
  raw: string;
}

/**
 * 解析 AdGuard 格式的过滤规则
 */
export function parseFilterRule(rule: string): ParsedFilter | null {
  const trimmed = rule.trim();

  // 跳过空行和注释
  if (!trimmed || trimmed.startsWith('!')) {
    return null;
  }

  // 例外规则（白名单）
  if (trimmed.startsWith('@@')) {
    const parsed = parseBasicRule(trimmed.substring(2));
    if (parsed) {
      parsed.isException = true;
      parsed.raw = trimmed;
    }
    return parsed;
  }

  // CSS 隐藏规则
  if (trimmed.includes('##') || trimmed.includes('#@#')) {
    return parseCssRule(trimmed);
  }

  // 脚本规则
  if (trimmed.includes('#%#') || trimmed.includes('#@%#')) {
    return parseScriptRule(trimmed);
  }

  // 基本拦截规则
  return parseBasicRule(trimmed);
}

/**
 * 解析基本拦截规则
 */
function parseBasicRule(rule: string): ParsedFilter | null {
  const trimmed = rule.trim();
  if (!trimmed) return null;

  // 分离选项
  const optionIndex = trimmed.lastIndexOf('$');
  let pattern = trimmed;
  let options: string[] = [];

  if (optionIndex > 0) {
    pattern = trimmed.substring(0, optionIndex);
    const optionString = trimmed.substring(optionIndex + 1);
    options = optionString
      .split(',')
      .map(opt => opt.trim())
      .filter(opt => opt);
  }

  // 提取域名
  let domain: string | undefined;

  // 域名规则
  if (pattern.startsWith('||') && pattern.endsWith('^')) {
    domain = pattern.substring(2, pattern.length - 1);
  } else if (pattern.startsWith('||')) {
    const endIndex = pattern.indexOf('/', 2);
    if (endIndex > 0) {
      domain = pattern.substring(2, endIndex);
    } else {
      domain = pattern.substring(2);
    }
  }

  return {
    type: 'block',
    pattern,
    ...(domain && { domain }),
    ...(options.length > 0 && { options }),
    raw: rule,
  };
}

/**
 * 解析 CSS 隐藏规则
 */
function parseCssRule(rule: string): ParsedFilter {
  const isException = rule.includes('#@#');
  const separator = isException ? '#@#' : '##';
  const parts = rule.split(separator);

  return {
    type: 'hide',
    pattern: parts[1] || '',
    ...(parts[0] && { domain: parts[0] }),
    isException,
    raw: rule,
  };
}

/**
 * 解析脚本规则
 */
function parseScriptRule(rule: string): ParsedFilter {
  const isException = rule.includes('#@%#');
  const separator = isException ? '#@%#' : '#%#';
  const parts = rule.split(separator);

  return {
    type: 'script',
    pattern: parts[1] || '',
    ...(parts[0] && { domain: parts[0] }),
    isException,
    raw: rule,
  };
}

/**
 * 从过滤规则中提取域名列表
 */
export function extractDomainsFromFilters(rules: string[]): {
  blacklist: string[];
  whitelist: string[];
  keywords: string[];
} {
  const blacklist = new Set<string>();
  const whitelist = new Set<string>();
  const keywords = new Set<string>();

  for (const rule of rules) {
    const parsed = parseFilterRule(rule);
    if (!parsed) continue;

    // 域名规则
    if (parsed.domain) {
      if (parsed.isException) {
        whitelist.add(parsed.domain);
      } else {
        blacklist.add(parsed.domain);
      }
    }

    // 提取关键词（简化处理）
    if (parsed.pattern && !parsed.domain) {
      const keywordMatch = parsed.pattern.match(/^[a-zA-Z0-9-]+$/);
      if (keywordMatch) {
        keywords.add(keywordMatch[0]);
      }
    }
  }

  return {
    blacklist: Array.from(blacklist).sort(),
    whitelist: Array.from(whitelist).sort(),
    keywords: Array.from(keywords).sort(),
  };
}

/**
 * 转换过滤规则到 Surge 格式
 */
export function convertFilterToSurge(filter: ParsedFilter): string | null {
  if (filter.isException || filter.type !== 'block') {
    return null; // Surge 不支持白名单和非拦截规则
  }

  // 域名规则
  if (filter.domain) {
    // 检查是否需要 DOMAIN-SUFFIX
    if (filter.pattern.startsWith('||') && filter.pattern.endsWith('^')) {
      return `DOMAIN-SUFFIX,${filter.domain}`;
    }
    return `DOMAIN,${filter.domain}`;
  }

  // 关键词规则
  const keywordMatch = filter.pattern.match(/^[a-zA-Z0-9-]+$/);
  if (keywordMatch) {
    return `DOMAIN-KEYWORD,${keywordMatch[0]}`;
  }

  // URL 正则规则（简化处理）
  if (filter.pattern.includes('*') || filter.pattern.includes('?')) {
    // 转换通配符到正则表达式
    const regex = filter.pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.');
    return `URL-REGEX,${regex}`;
  }

  return null;
}

/**
 * 批量转换过滤规则
 */
export function batchConvertFilters(
  rules: string[],
  options: {
    skipWhitelist?: boolean;
    skipNonBlock?: boolean;
    deduplicateDomains?: boolean;
  } = {}
): string[] {
  const converted = new Set<string>();

  for (const rule of rules) {
    const parsed = parseFilterRule(rule);
    if (!parsed) continue;

    if (options.skipWhitelist && parsed.isException) continue;
    if (options.skipNonBlock && parsed.type !== 'block') continue;

    const surgeRule = convertFilterToSurge(parsed);
    if (surgeRule) {
      converted.add(surgeRule);
    }
  }

  const result = Array.from(converted);

  // 域名去重
  if (options.deduplicateDomains) {
    // 简单实现：如果有 DOMAIN-SUFFIX，删除对应的 DOMAIN
    const suffixes = new Set<string>();
    const domains = new Set<string>();

    for (const rule of result) {
      if (rule.startsWith('DOMAIN-SUFFIX,')) {
        suffixes.add(rule.substring(14));
      } else if (rule.startsWith('DOMAIN,')) {
        domains.add(rule.substring(7));
      }
    }

    // 过滤被后缀覆盖的域名
    const filteredDomains = Array.from(domains).filter(domain => {
      return !Array.from(suffixes).some(suffix => domain.endsWith('.' + suffix));
    });

    // 重建规则列表
    return [
      ...filteredDomains.map(d => `DOMAIN,${d}`),
      ...Array.from(suffixes).map(s => `DOMAIN-SUFFIX,${s}`),
      ...result.filter(r => !r.startsWith('DOMAIN,') && !r.startsWith('DOMAIN-SUFFIX,')),
    ].sort();
  }

  return result.sort();
}

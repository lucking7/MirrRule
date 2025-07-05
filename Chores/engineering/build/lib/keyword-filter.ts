/**
 * 关键词过滤器
 * 用于检测域名是否被关键词规则覆盖
 */

export interface KeywordFilter {
  /**
   * 检查域名是否匹配任何关键词
   */
  matches(domain: string): boolean;

  /**
   * 获取匹配的关键词
   */
  getMatchingKeyword(domain: string): string | null;
}

/**
 * 创建关键词过滤器
 */
export function createKeywordFilter(keywords: string[]): KeywordFilter {
  // 预处理关键词，去除重复和空值
  const processedKeywords = [...new Set(keywords.filter(k => k.trim()))];

  // 按长度降序排序，优先匹配更长的关键词
  processedKeywords.sort((a, b) => b.length - a.length);

  return {
    matches(domain: string): boolean {
      const lowerDomain = domain.toLowerCase();
      return processedKeywords.some(keyword => lowerDomain.includes(keyword.toLowerCase()));
    },

    getMatchingKeyword(domain: string): string | null {
      const lowerDomain = domain.toLowerCase();
      for (const keyword of processedKeywords) {
        if (lowerDomain.includes(keyword.toLowerCase())) {
          return keyword;
        }
      }
      return null;
    },
  };
}

/**
 * 创建高级关键词过滤器（支持通配符）
 */
export function createAdvancedKeywordFilter(patterns: string[]): KeywordFilter {
  // 将通配符模式转换为正则表达式
  const regexPatterns = patterns.map(pattern => {
    // 转义特殊字符
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 将 * 替换为 .* （匹配任意字符）
    const regex = escaped.replace(/\\\*/g, '.*');
    return new RegExp(`^${regex}$`, 'i');
  });

  return {
    matches(domain: string): boolean {
      return regexPatterns.some(regex => regex.test(domain));
    },

    getMatchingKeyword(domain: string): string | null {
      for (let i = 0; i < regexPatterns.length; i++) {
        if (regexPatterns[i].test(domain)) {
          return patterns[i];
        }
      }
      return null;
    },
  };
}

/**
 * 从文件内容中提取关键词规则
 */
export function extractKeywordsFromRules(content: string): string[] {
  const keywords: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // 跳过注释和空行
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
      continue;
    }

    // 提取 DOMAIN-KEYWORD 规则
    const keywordMatch = trimmed.match(/^(?:DOMAIN-)?KEYWORD,(.+)$/i);
    if (keywordMatch) {
      keywords.push(keywordMatch[1].trim());
    }

    // 提取 URL-REGEX 中的关键词（简化处理）
    const urlRegexMatch = trimmed.match(/^URL-REGEX,.*?([a-zA-Z0-9-]+).*$/i);
    if (urlRegexMatch && urlRegexMatch[1].length > 3) {
      keywords.push(urlRegexMatch[1]);
    }
  }

  return keywords;
}

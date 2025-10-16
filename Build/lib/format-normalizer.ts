/**
 * Surge规则格式标准化工具
 * 确保所有规则符合标准Surge格式（逗号后无空格）
 */

export function normalizeSurgeRule(rule: string): string | null {
  const trimmed = rule.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
    return trimmed;
  }

  // 标准化Surge规则格式：移除逗号后的多余空格
  return trimmed
    .split(',')
    .map(part => part.trim())
    .join(',');
}

export function normalizeSurgeRules(rules: string[]): string[] {
  return rules
    .map(rule => normalizeSurgeRule(rule))
    .filter((rule): rule is string => rule !== null);
}

/**
 * 批量处理文件内容，标准化所有规则格式
 */
export function normalizeFileContent(content: string): string {
  return content
    .split('\n')
    .map(line => normalizeSurgeRule(line))
    .filter((line): line is string => line !== null)
    .join('\n');
}

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
  const parts = trimmed.split(',');
  const normalizedParts = parts.map(part => part.trim());
  return normalizedParts.join(',');
}

export function normalizeSurgeRules(rules: string[]): string[] {
  const normalizedRules: string[] = [];

  for (const rule of rules) {
    const normalized = normalizeSurgeRule(rule);
    if (normalized !== null) {
      normalizedRules.push(normalized);
    }
  }

  return normalizedRules;
}

/**
 * 批量处理文件内容，标准化所有规则格式
 */
export function normalizeFileContent(content: string): string {
  const lines = content.split('\n');
  const normalizedLines: string[] = [];

  for (const line of lines) {
    const normalized = normalizeSurgeRule(line);
    if (normalized !== null) {
      normalizedLines.push(normalized);
    }
  }

  return normalizedLines.join('\n');
}

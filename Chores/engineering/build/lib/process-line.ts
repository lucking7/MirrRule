/**
 * 行处理器 - 处理规则文件中的每一行
 * 跳过注释行和空行，清理内容
 */

/**
 * 处理单行文本
 * @param line 输入的行文本
 * @returns 处理后的文本，如果是注释或空行则返回null
 */
export function processLine(line: string): string | null {
  const trimmed = line.trim();

  // 跳过空行
  if (trimmed.length === 0) {
    return null;
  }

  const firstChar = trimmed.charCodeAt(0);

  // 跳过不同类型的注释行
  if (
    firstChar === 35 || // # 开头
    firstChar === 33 || // ! 开头
    (firstChar === 47 && trimmed.charCodeAt(1) === 47) // // 开头
  ) {
    return null;
  }

  // 处理行内注释
  const commentIndex = Math.min(
    trimmed.indexOf(' #') >= 0 ? trimmed.indexOf(' #') : Number.MAX_SAFE_INTEGER,
    trimmed.indexOf(' //') >= 0 ? trimmed.indexOf(' //') : Number.MAX_SAFE_INTEGER
  );

  if (commentIndex !== Number.MAX_SAFE_INTEGER) {
    return trimmed.substring(0, commentIndex).trim();
  }

  return trimmed;
}

/**
 * Section 解析器
 * 用于解析 .sgmodule 文件中的各个 Section
 */

import type { ParsedSection, SectionType } from './types';
import { cleanPolicy } from '../../core/parsers/policy-cleaner';
import { RuleValidator } from '../../utils/validation/validators';

/**
 * Section 解析器类
 */
export class SectionParser {
  /** Section 匹配正则表达式 */
  private static readonly SECTION_REGEX = /\[(.*?)]\s*\n(.*?)(?=\n\[|$)/gs;

  /** MITM hostname 匹配正则表达式 */
  private static readonly HOSTNAME_REGEX = /hostname\s*=\s*(.*)/i;

  /** Rule 后缀清理正则表达式 - 已废弃，使用 policy-cleaner 模块替代 */
  // @deprecated

  /**
   * 解析模块内容,提取所有 Section
   * @param content 模块文件内容
   * @param header 模块的 header 名称
   * @returns 解析后的 Section 数组
   */
  static parse(content: string, header: string): ParsedSection[] {
    const sections: ParsedSection[] = [];
    const matches = content.matchAll(this.SECTION_REGEX);

    for (const match of matches) {
      const [, sectionName, sectionContent] = match;
      const type = this.getSectionType(sectionName);

      if (type) {
        sections.push({
          type,
          content: this.cleanContent(sectionContent, type),
          header,
        });
      }
    }

    return sections;
  }

  /**
   * 获取 Section 类型
   * @param name Section 名称
   * @returns Section 类型,如果不是有效类型则返回 null
   */
  private static getSectionType(name: string): SectionType | null {
    const normalized = name.trim();

    // 使用 switch 语句进行精确匹配
    switch (normalized) {
      case 'Rule':
        return 'Rule' as SectionType;
      case 'URL Rewrite':
        return 'URL Rewrite' as SectionType;
      case 'Map Local':
        return 'Map Local' as SectionType;
      case 'Script':
        return 'Script' as SectionType;
      case 'MITM':
        return 'MITM' as SectionType;
      case 'General':
        return 'General' as SectionType;
      default:
        return null;
    }
  }

  /**
   * 清理 Section 内容
   * @param content Section 原始内容
   * @param type Section 类型
   * @returns 清理后的内容
   */
  private static cleanContent(content: string, type: SectionType): string {
    let cleaned = content.trim();

    // Rule Section: 使用统一清理器移除策略
    if (type === ('Rule' as SectionType)) {
      // 逐行清理策略
      cleaned = cleaned
        .split('\n')
        .map(line => cleanPolicy(line))
        .join('\n');
    }

    // 🔧 统一注释处理 - 使用 RuleValidator (支持 #、!、//、; 四种格式)
    cleaned = cleaned
      .split('\n')
      .filter(line => {
        const trimmed = line.trim();
        // 使用统一的注释检测
        return trimmed && !RuleValidator.isComment(trimmed);
      })
      .join('\n');

    return cleaned;
  }

  /**
   * 提取 MITM hostnames
   * @param content MITM Section 内容
   * @returns hostname 数组
   */
  static extractHostnames(content: string): string[] {
    const match = content.match(this.HOSTNAME_REGEX);
    if (!match) return [];

    return match[1]
      .replaceAll('%APPEND%', '')
      .split(',')
      .map(h => h.trim())
      .filter(Boolean);
  }
}

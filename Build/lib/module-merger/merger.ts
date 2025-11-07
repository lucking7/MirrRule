/**
 * 模块合并引擎
 * 负责合并多个 Section 并生成最终内容
 */

import type { ParsedSection, SectionType, MergeOptions } from './types';
import { SectionParser } from './section-parser';

/**
 * 模块合并引擎类
 */
export class ModuleMerger {
  /** 存储各类型的 Section */
  private readonly sections = new Map<SectionType, ParsedSection[]>();

  /** 存储去重后的 MITM hostnames */
  private readonly hostnames = new Set<string>();

  /**
   * 构造函数
   * @param options 合并选项
   */
  constructor(private readonly options: MergeOptions) {}

  /**
   * 添加解析后的 Section
   * @param section 解析后的 Section
   */
  addSection(section: ParsedSection): void {
    if (section.type === ('MITM' as SectionType)) {
      // MITM Section 特殊处理: 提取并去重 hostnames
      const hostnames = SectionParser.extractHostnames(section.content);
      hostnames.forEach(h => this.hostnames.add(h));
      return;
    }

    // 其他 Section: 添加到对应类型的数组中
    const existing = this.sections.get(section.type) || [];
    existing.push(section);
    this.sections.set(section.type, existing);
  }

  /**
   * 生成合并后的内容
   * @returns 合并后的 sections 和 hostnames
   */
  merge(): { sections: Map<SectionType, string>, hostnames: string[] } {
    const merged = new Map<SectionType, string>();

    // 合并各个类型的 Section
    for (const [type, sections] of this.sections) {
      const content = this.mergeSections(sections, type);
      merged.set(type, content);
    }

    return {
      sections: merged,
      hostnames: Array.from(this.hostnames)
    };
  }

  /**
   * 合并同类型的 Sections
   * @param sections Section 数组
   * @param _type Section 类型
   * @returns 合并后的内容
   */
  private mergeSections(sections: ParsedSection[], _type: SectionType): string {
    const parts: string[] = [];

    for (const section of sections) {
      // 添加分隔符
      if (this.options.addDividers && section.header) {
        const divider = this.createDivider(section.header);
        parts.push(divider);
      }

      // 添加内容
      parts.push(section.content);
    }

    return parts.join('\n\n');
  }

  /**
   * 创建分隔符
   * @param header 模块名称
   * @returns 分隔符字符串
   */
  private createDivider(header: string): string {
    const length = this.options.dividerLength || 30;
    const leftDashes = Math.floor((length - header.length) / 2);
    const rightDashes = length - header.length - leftDashes;

    return `# ${'-'.repeat(leftDashes)} ${header} ${'-'.repeat(rightDashes)}`;
  }

  /**
   * 获取统计信息
   * @returns 统计信息对象
   */
  getStats() {
    return {
      sectionsExtracted: Array.from(this.sections.values()).reduce(
        (sum, arr) => sum + arr.length,
        0
      ),
      hostnamesDeduplicated: this.hostnames.size
    };
  }
}

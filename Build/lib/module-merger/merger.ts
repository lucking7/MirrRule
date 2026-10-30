/**
 * 模块合并引擎
 * 负责合并多个 Section 并生成最终内容
 */

import type { ParsedSection, SectionType, MergeOptions } from './types';
import { SectionParser } from './section-parser';
import { cleanPolicy } from '../policy-cleaner';

/**
 * 模块合并引擎类
 */
export class ModuleMerger {
  /** 存储各类型的 Section */
  private readonly sections = new Map<SectionType, ParsedSection[]>();

  /** 存储 MITM hostnames */
  private readonly hostnames: string[] = [];

  /** hostnames 去重集合 */
  private readonly hostnameSet = new Set<string>();

  /** Rule 匹配条件（去掉策略后）去重集合 */
  private readonly ruleMatchers = new Set<string>();

  private sectionsExtracted = 0;

  private rulesDeduplicated = 0;

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
    const typeKey = section.type;

    // 存储 Section
    const existing = this.sections.get(typeKey) || [];
    existing.push(typeKey === 'Rule' ? { ...section, content: this.dropRepeatedRules(section.content) } : section);
    this.sections.set(typeKey, existing);
    this.sectionsExtracted++;

    // MITM Section 特殊处理: 提取 hostnames
    if (typeKey.toLowerCase() === 'mitm') {
      const hostnames = SectionParser.extractHostnames(section.content);
      this.collectHostnames(hostnames);
    }
  }

  /**
   * 生成合并后的内容
   * @returns 合并后的 sections 和 hostnames
   */
  merge(): { sections: Map<SectionType, string>; hostnames: string[] } {
    const merged = new Map<SectionType, string>();

    // 合并各个类型的 Section
    for (const [type, sections] of this.sections) {
      const content = this.mergeSections(sections);
      merged.set(type, content);
    }

    return {
      sections: merged,
      hostnames: [...this.hostnames],
    };
  }

  /**
   * 合并同类型的 Sections
   * @param sections Section 数组
   * @returns 合并后的内容
   */
  private mergeSections(sections: ParsedSection[]): string {
    const parts: string[] = [];

    for (const section of sections) {
      // 规则全部重复的模块不留下空分段
      if (!section.content.trim()) continue;

      // 添加分隔符
      if (this.options.addDividers && section.header) {
        const divider = this.createDivider(section.header);
        parts.push(divider);
      }

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
      sectionsExtracted: this.sectionsExtracted,
      hostnamesDeduplicated: this.options.deduplicateHostnames
        ? this.hostnameSet.size
        : this.hostnames.length,
      rulesDeduplicated: this.rulesDeduplicated,
    };
  }

  /**
   * Surge 按顺序取第一条匹配的规则，匹配条件与前面某条相同的规则不会生效，不论策略是否相同。
   * 比较时去掉策略、保留 no-resolve 等参数，因为参数会改变匹配方式。
   */
  private dropRepeatedRules(content: string): string {
    return content.split('\n').filter(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return true;
      const matcher = cleanPolicy(trimmed).replaceAll(/\s*,\s*/g, ',');
      const type = matcher.split(',', 1)[0];
      const key = `${type.toUpperCase()}${matcher.slice(type.length)}`;
      if (this.ruleMatchers.has(key)) {
        this.rulesDeduplicated++;
        return false;
      }
      this.ruleMatchers.add(key);
      return true;
    }).join('\n');
  }

  private collectHostnames(hosts: string[]): void {
    if (!hosts.length) return;

    if (!this.options.deduplicateHostnames) {
      this.hostnames.push(...hosts);
      return;
    }

    hosts.forEach(host => {
      if (!this.hostnameSet.has(host)) {
        this.hostnameSet.add(host);
        this.hostnames.push(host);
      }
    });
  }
}

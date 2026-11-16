/**
 * 模块合并引擎
 * 负责合并多个 Section 并生成最终内容
 */

import type { ParsedSection, SectionType, MergeOptions } from './types';
import { SectionParser } from './section-parser';
import { cleanPolicy } from '../policy-cleaner';
import { isActiveLine } from './module-content';

/** 整模块开关作用的段落：这些段落每行是一条独立条目，在行首加参数即可注释掉该行。 */
const SWITCHED_SECTIONS = new Set<SectionType>(['Rule', 'URL Rewrite', 'Header Rewrite', 'Body Rewrite', 'Map Local', 'Script']);

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

  /** 各模块 Rule 匹配条件（去掉策略后）去重集合，按模块 header 分开 */
  private readonly ruleMatchers = new Map<string, Set<string>>();

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
   * @param switchName 整模块开关参数名；在逐行条目段落的每条生效行前加 {{{switchName}}}
   */
  addSection(section: ParsedSection, switchName?: string): void {
    const typeKey = section.type;

    let content = typeKey === 'Rule' ? this.dropRepeatedRules(section.content, section.header ?? '') : section.content;
    if (switchName && SWITCHED_SECTIONS.has(typeKey)) {
      content = content.split('\n').map(line => (isActiveLine(line) ? `{{{${switchName}}}}${line}` : line)).join('\n');
    }

    // 存储 Section
    const existing = this.sections.get(typeKey) || [];
    existing.push({ ...section, content });
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
   * 比较时去掉策略（cleanPolicy 按字段解析，不改动引号内和 URL-REGEX 正则内部的空格和逗号），
   * 保留其他参数。带 no-resolve 的规则不参与：域名尚未解析时它会被跳过，若中间有规则触发
   * DNS 解析，后面相同的规则仍可能命中。
   * 只在同一模块内去重：每个模块都能单独关闭，若因前一模块已有相同规则而删掉后一模块的副本，
   * 关闭前一模块时后一模块就缺了这条规则。
   */
  private dropRepeatedRules(content: string, header: string): string {
    const ruleMatchers = this.ruleMatchers.get(header) ?? new Set<string>();
    this.ruleMatchers.set(header, ruleMatchers);
    return content.split('\n').filter(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return true;
      const matcher = cleanPolicy(trimmed);
      if (/,\s*no-resolve\s*(?:,|\)|$)/i.test(matcher)) return true;
      const type = matcher.split(',', 1)[0];
      const key = `${type.toUpperCase()}${matcher.slice(type.length)}`;
      if (ruleMatchers.has(key)) {
        this.rulesDeduplicated++;
        return false;
      }
      ruleMatchers.add(key);
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

/**
 * 模块合并器类型定义
 */

/**
 * 模块合并配置
 */
export interface MergeConfig {
  /** 模块名称 */
  name: string,
  /** 版本号 */
  version: string,
  /** 描述 */
  description: string,
  /** 分类 */
  category: string,
  /** 作者 */
  author: string,
  /** 要合并的模块列表 */
  modules: ModuleSource[],
  /** 输出配置 */
  output: OutputConfig,
  /** 合并选项 */
  options: MergeOptions
}

/**
 * 模块来源
 */
export interface ModuleSource {
  /** 模块的 URL 地址 */
  url: string,
  /** 模块的显示名称(用于分隔符) */
  header: string
}

/**
 * 输出配置
 */
export interface OutputConfig {
  /** 合并后的 .sgmodule 文件路径 */
  sgmodule: string,
  /** 提取的规则列表文件路径 */
  rulelist: string,
  /** 模板文件路径 */
  template: string
}

/**
 * 合并选项
 */
export interface MergeOptions {
  /** 是否去重 MITM hostnames */
  deduplicateHostnames: boolean,
  /** 是否移除注释 */
  stripComments: boolean,
  /** 是否添加分隔符 */
  addDividers: boolean,
  /** 分隔符长度 */
  dividerLength: number
}

/**
 * Section 类型枚举
 */
export enum SectionType {
  RULE = 'Rule',
  URL_REWRITE = 'URL Rewrite',
  MAP_LOCAL = 'Map Local',
  SCRIPT = 'Script',
  MITM = 'MITM',
  GENERAL = 'General'
}

/**
 * 解析后的 Section
 */
export interface ParsedSection {
  /** Section 类型 */
  type: SectionType,
  /** Section 内容 */
  content: string,
  /** 来源模块的 header */
  header?: string
}

/**
 * 合并结果
 */
export interface MergeResult {
  /** 合并后的 sgmodule 内容 */
  sgmodule: string,
  /** 提取的规则列表内容 */
  rulelist: string,
  /** 统计信息 */
  stats: MergeStats
}

/**
 * 合并统计信息
 */
export interface MergeStats {
  /** 处理的模块数量 */
  modulesProcessed: number,
  /** 提取的 Section 数量 */
  sectionsExtracted: number,
  /** 去重的 hostname 数量 */
  hostnamesDeduplicated: number
}

/**
 * 模板数据
 */
export interface TemplateData {
  /** 模块名称 */
  name: string,
  /** 描述 */
  description: string,
  /** 分类 */
  category: string,
  /** 作者 */
  author: string,
  /** 当前日期 */
  currentDate: string,
  /** MITM hostname 列表 */
  hostname_append: string,
  /** 各个 Section 的内容 */
  [key: string]: string
}

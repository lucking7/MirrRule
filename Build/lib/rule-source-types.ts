/**
 * 规则源处理系统的类型定义
 * 支持处理配置文件中定义的规则组和特殊规则合并配置
 */

export type RulePolicy = 'DIRECT' | 'REJECT' | 'PROXY' | string | null;
export type RuleTarget = 'surge' | 'clash' | 'singbox' | 'loon';

/** Shared normalization and output behavior for every rule input. */
export interface RuleProcessingOptions {
  /** 是否允许空文件 */
  allowEmpty?: boolean,
  /** 是否保留注释（行首注释） */
  keepComments?: boolean,
  /** 是否保留行内注释（优先级高于 keepComments，仅对 // 格式的行内注释生效） */
  keepInlineComments?: boolean,
  /** 是否保留空行 */
  keepEmptyLines?: boolean,
  /** 是否为IP规则添加no-resolve参数 */
  applyNoResolve?: boolean,
  /** 是否启用格式转换 (.domain.com → DOMAIN-SUFFIX,domain.com) */
  formatConversion?: boolean,
  /** 是否校验规则格式，丢弃无法识别的行 */
  validate?: boolean
}

/**
 * 单个文件下载配置
 */
export interface FileConfig extends RuleProcessingOptions {
  /** 文件保存路径（相对于输出目录） */
  path: string,
  /** 文件下载URL */
  url: string,
  /** 备用下载URL列表 */
  fallbackUrls?: string[],
  /** 文件标题 */
  title?: string,
  /** 文件描述 */
  description?: string
}

/**
 * 规则组配置
 * 用于组织相关的文件下载任务
 */
export interface RuleGroup {
  /** 组名称 */
  name: string,
  /** 组内文件列表 */
  files: FileConfig[],
  /** 组描述 */
  description?: string,
  /** 组级默认策略（覆盖全局默认，null表示无策略） */
  defaultPolicy?: RulePolicy,
  /** 目标平台列表（默认仅Surge） */
  targets?: RuleTarget[]
}

/**
 * 特殊规则合并配置
 * 用于将多个源文件合并为单个目标文件
 */
export interface SpecialRuleConfig extends RuleProcessingOptions {
  /** 规则名称 */
  name: string,
  /** 目标文件路径 */
  targetFile: string,
  /** 源文件URL列表 */
  sourceFiles: string[],
  /** 合并后是否删除源文件 */
  deleteSourceFiles?: boolean,
  /** 规则描述 */
  description?: string,
  /** 默认策略组（可设为null表示无策略，null时会移除规则中的策略） */
  defaultPolicy?: RulePolicy,
  /** 目标平台列表（默认仅Surge） */
  targets?: RuleTarget[]
}

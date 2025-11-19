/**
 * 规则源处理系统的类型定义
 * 支持处理配置文件中定义的规则组和特殊规则合并配置
 */

/**
 * 单个文件下载配置
 */
export interface FileConfig {
  /** 文件保存路径（相对于输出目录） */
  path: string,
  /** 文件下载URL */
  url: string,
  /** 备用下载URL列表 */
  fallbackUrls?: string[],
  /** 是否允许空文件 */
  allowEmpty?: boolean,
  /** 文件标题 */
  title?: string,
  /** 文件描述 */
  description?: string,
  /** 是否启用去重 */
  dedup?: boolean,
  /** 是否启用排序 */
  sort?: boolean,
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
  /** 头部信息配置 */
  header?: HeaderConfig,
  /** 默认策略组（null时会移除规则中的策略,生成纯规则格式） */
  defaultPolicy?: 'DIRECT' | 'REJECT' | 'PROXY' | string | null
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
  /** 是否启用此组 */
  enabled?: boolean,
  /** 组描述 */
  description?: string,
  /** 组级默认策略（覆盖全局默认，null表示无策略） */
  defaultPolicy?: 'DIRECT' | 'REJECT' | 'PROXY' | string | null,
  /** 目标平台列表（默认仅Surge） */
  targets?: Array<'surge' | 'clash' | 'singbox' | 'surfboard' | 'loon'>
}

/**
 * 头部信息配置
 */
export interface HeaderConfig {
  /** 是否启用头部信息 */
  enable: boolean,
  /** 自定义标题 */
  title?: string,
  /** 自定义描述信息 */
  description?: string,
  /** 自定义许可证信息 */
  license?: string,
  /** 自定义主页URL */
  homepage?: string,
  /** 过期时间（小时） */
  expires?: number
}

/**
 * 特殊规则合并配置
 * 用于将多个源文件合并为单个目标文件
 */
export interface SpecialRuleConfig {
  /** 规则名称 */
  name: string,
  /** 目标文件路径 */
  targetFile: string,
  /** 源文件URL列表 */
  sourceFiles: string[],
  /** 是否启用去重 */
  dedup?: boolean,
  /** 是否启用排序 */
  sort?: boolean,
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
  /** 合并后是否删除源文件 */
  deleteSourceFiles?: boolean,
  /** 头部信息配置 */
  header?: HeaderConfig,
  /** 是否启用此规则 */
  enabled?: boolean,
  /** 规则描述 */
  description?: string,
  /** 默认策略组（可设为null表示无策略，null时会移除规则中的策略） */
  defaultPolicy?: 'DIRECT' | 'REJECT' | 'PROXY' | string | null,
  /** 目标平台列表（默认仅Surge） */
  targets?: Array<'surge' | 'clash' | 'singbox' | 'surfboard' | 'loon'>
}

/**
 * 规则源配置文件结构
 */
export interface RuleSourceConfig {
  /** 规则组列表 */
  ruleGroups: RuleGroup[],
  /** 特殊规则合并配置列表 */
  specialRules: SpecialRuleConfig[],
  /** 全局配置 */
  globalConfig?: {
    /** 输出根目录 */
    outputDir?: string,
    /** 并发下载数量限制 */
    concurrency?: number,
    /** 默认重试次数 */
    retryCount?: number,
    /** 默认超时时间（毫秒） */
    timeout?: number
  }
}

/**
 * 处理结果统计信息
 */
export interface ProcessingStats {
  /** 处理的文件数量 */
  filesProcessed: number,
  /** 下载的文件数量 */
  filesDownloaded?: number,
  /** 处理的规则数量 */
  rulesProcessed?: number,
  /** 合并的规则数量 */
  rulesMerged?: number,
  /** 去重移除的规则数量 */
  rulesDeduped?: number,
  /** 总文件大小（字节） */
  totalSize?: number,
  /** 处理耗时（毫秒） */
  processingTime: number,
  /** 错误列表 */
  errors: Array<{
    file: string,
    error: string,
    url?: string
  }>
}

/**
 * 文件类型枚举
 */
export enum FileType {
  /** GEOIP数据库文件 */
  GEODB = 'geodb',
  /** 规则列表文件 */
  RULELIST = 'rulelist',
  /** 域名集合文件 */
  DOMAINSET = 'domainset',
  /** IP列表文件 */
  IPLIST = 'iplist',
  /** 未知类型 */
  UNKNOWN = 'unknown'
}

/**
 * 处理选项
 */
export interface ProcessingOptions {
  /** 是否启用详细日志 */
  verbose?: boolean,
  /** 是否强制重新下载 */
  forceDownload?: boolean,
  /** 是否跳过验证 */
  skipValidation?: boolean,
  /** 自定义输出目录 */
  outputDir?: string,
  /** 并发限制 */
  concurrency?: number
}

/**
 * 规则行类型
 */
export interface RuleLine {
  /** 原始行内容 */
  raw: string,
  /** 处理后的内容 */
  processed: string | null,
  /** 行类型 */
  type: 'comment' | 'empty' | 'rule' | 'directive',
  /** 是否为IP规则 */
  isIpRule?: boolean,
  /** 来源文件URL */
  source?: string
}

/**
 * 合并结果
 */
export interface MergeResult {
  /** 合并后的规则行 */
  lines: string[],
  /** 统计信息 */
  stats: {
    totalLines: number,
    ruleLines: number,
    commentLines: number,
    emptyLines: number,
    duplicatesRemoved: number
  },
  /** 数据源列表 */
  sources: string[]
}

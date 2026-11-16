/**
 * 插件转换系统类型定义
 * 用于将 Loon 插件转换为 Surge 模块
 */

/**
 * 插件信息
 */
export interface PluginInfo {
  /** 插件名称 */
  name: string,
  /** 插件 URL */
  url: string,
  /** 文件扩展名 */
  extension: 'plugin' | 'lpx' | 'module',
  /** 上游已经提供原生 Surge module，校验和镜像后直接发布。 */
  useNativeSurge?: boolean
}

export interface PluginSourceIdentity {
  /** Canonical plugin URL without a fragment. */
  sourceUrl: string,
  /** SHA-256 identity derived from sourceUrl. */
  sourceId: string
}

export interface PluginConversionResult extends PluginSourceIdentity {
  pluginName: string,
  content: string | { error: string },
  /** The error means the plugin could not be fetched (network error or HTTP 5xx). */
  upstreamUnavailable?: boolean
}

/**
 * Script-Hub 转换配置
 */
export interface ConversionConfig {
  /** 源类型 */
  sourceType: 'loon-plugin',
  /** 目标类型 */
  targetType: 'surge-module',
  /** 分类 */
  category?: string
}

/**
 * JavaScript 脚本信息
 */
export interface ScriptInfo {
  /** 原始 URL */
  originalUrl: string,
  /** 文件名 */
  filename: string,
  /** 是否已镜像 */
  isMirrored: boolean
}

/**
 * 转换结果
 */
type PluginArtifactStatus = 'ready' | 'degraded' | 'failed';

export interface ConversionResult extends PluginSourceIdentity {
  /** 插件名称 */
  pluginName: string,
  /** 当前产物状态 */
  status: PluginArtifactStatus,
  /** sgmodule 文件路径 */
  outputPath?: string,
  /** 提取的脚本列表 */
  scripts: ScriptInfo[],
  /** 错误信息 */
  error?: string,
  /**
   * 未就绪的原因只是上游暂时不可用：插件或其必需脚本因网络错误或 HTTP 5xx 无法下载。
   * 转换错误、4xx、内容无效、本地写入失败都不算。
   */
  upstreamUnavailable?: boolean
}

/**
 * 镜像结果
 */
export interface MirrorResult {
  /** 总脚本数 */
  total: number,
  /** 成功镜像数 */
  mirrored: number,
  /** 跳过数（已存在） */
  skipped: number,
  /** 失败数 */
  failed: number,
  /** 失败的脚本列表 */
  failedScripts: Array<{
    url: string,
    error: string,
    /** Every download candidate failed with a network error or HTTP 5xx. */
    unavailable: boolean
  }>
}

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
  extension: 'plugin' | 'lpx'
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
  /** 镜像 URL */
  mirrorUrl?: string,
  /** 是否已镜像 */
  isMirrored: boolean
}

/**
 * 转换结果
 */
export interface ConversionResult {
  /** 插件名称 */
  pluginName: string,
  /** 是否成功 */
  success: boolean,
  /** sgmodule 文件路径 */
  outputPath?: string,
  /** 提取的脚本列表 */
  scripts: ScriptInfo[],
  /** 错误信息 */
  error?: string
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
    error: string
  }>
}

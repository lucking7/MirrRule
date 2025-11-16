/**
 * 镜像同步系统类型定义
 * 用于从上游开源项目同步配置文件
 */

/**
 * GitHub Release Asset 信息
 */
export interface GitHubAsset {
  name: string,
  url: string,
  size: number,
  browser_download_url: string
}

/**
 * GitHub Release 信息
 */
export interface GitHubRelease {
  tag_name: string,
  name: string,
  assets: GitHubAsset[],
  html_url: string
}

/**
 * 文件类型枚举
 */
export enum FileType {
  PLUGIN = 'plugin',
  SGMODULE = 'sgmodule',
  SNIPPET = 'snippet',
  STOVERRIDE = 'stoverride',
  UNKNOWN = 'unknown'
}

/**
 * 镜像仓库配置
 */
export interface MirrorRepository {
  /** 仓库所有者/名称，如 "NSRingo/WeatherKit" */
  repo: string,
  /** 输出目录 */
  outputDir: string,
  /** 允许的文件类型 */
  allowedTypes: FileType[],
  /** 是否需要后处理 */
  postProcess?: (filePath: string, content: string) => string | Promise<string>
}

/**
 * 镜像同步配置组
 */
export interface MirrorGroup {
  /** 组名称 */
  name: string,
  /** 仓库列表 */
  repositories: MirrorRepository[],
  /** 额外下载的文件 */
  extraDownloads?: Array<{
    url: string,
    outputPath: string
  }>
}

/**
 * 文件校验结果
 */
export interface FileChecksum {
  filePath: string,
  checksum: string,
  size: number
}

/**
 * 同步结果
 */
export interface SyncResult {
  /** 是否有变更 */
  hasChanges: boolean,
  /** 更新的文件列表 */
  updatedFiles: string[],
  /** 新增的文件列表 */
  newFiles: string[],
  /** 失败的文件列表 */
  failedFiles: Array<{
    file: string,
    error: string
  }>
}

/**
 * API 错误类型
 */
export enum ApiErrorType {
  EMPTY_RESPONSE = 'EMPTY_RESPONSE',
  NULL_RESPONSE = 'NULL_RESPONSE',
  NOT_FOUND = '404',
  MOVED_PERMANENTLY = '301',
  RATE_LIMIT = '403',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN = 'UNKNOWN'
}

/**
 * API 错误信息
 */
export interface ApiError {
  type: ApiErrorType,
  message: string,
  url: string,
  canRetry: boolean
}

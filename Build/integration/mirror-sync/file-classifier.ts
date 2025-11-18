/**
 * 文件分类模块
 * 根据扩展名自动分类到不同目录
 */

import path from 'node:path';
import { FileType } from './types';
import type { GitHubAsset } from './types';

/**
 * 从文件名提取扩展名
 *
 * @param filename - 文件名
 * @returns 扩展名（不含点号）
 *
 * @example
 * ```ts
 * getFileExtension('Weather.sgmodule') // 'sgmodule'
 * getFileExtension('test.plugin') // 'plugin'
 * ```
 */
export function getFileExtension(filename: string): string {
  // 使用 ## 操作符获取最后一个点号后的内容
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

/**
 * 将扩展名映射到文件类型
 *
 * @param extension - 文件扩展名
 * @returns 文件类型枚举
 */
export function extensionToFileType(extension: string): FileType {
  const ext = extension.toLowerCase();

  switch (ext) {
    case 'plugin':
      return FileType.PLUGIN;
    case 'sgmodule':
      return FileType.SGMODULE;
    case 'snippet':
      return FileType.SNIPPET;
    case 'stoverride':
      return FileType.STOVERRIDE;
    default:
      return FileType.UNKNOWN;
  }
}

/**
 * 根据文件类型确定输出目录
 *
 * @param baseDir - 基础目录
 * @param fileType - 文件类型
 * @returns 完整的输出目录路径
 *
 * @example
 * ```ts
 * getOutputDirectory('./iRingo', FileType.SGMODULE)
 * // 返回: './iRingo/sgmodule'
 * ```
 */
export function getOutputDirectory(baseDir: string, fileType: FileType): string | null {
  switch (fileType) {
    case FileType.PLUGIN:
      return path.join(baseDir, 'plugin');
    case FileType.SGMODULE:
      return path.join(baseDir, 'sgmodule');
    case FileType.SNIPPET:
      return path.join(baseDir, 'snippet');
    case FileType.STOVERRIDE:
      return path.join(baseDir, 'stoverride');
    default:
      return null;
  }
}

/**
 * 分类单个 Asset
 *
 * @param asset - GitHub Asset 对象
 * @param baseDir - 基础输出目录
 * @returns 分类结果，包含文件类型和输出路径
 */
export interface ClassifiedAsset {
  asset: GitHubAsset,
  fileType: FileType,
  outputPath: string | null,
  shouldProcess: boolean
}

export function classifyAsset(
  asset: GitHubAsset,
  baseDir: string,
  allowedTypes: FileType[] = [FileType.PLUGIN, FileType.SGMODULE, FileType.SNIPPET, FileType.STOVERRIDE]
): ClassifiedAsset {
  const extension = getFileExtension(asset.name);
  const fileType = extensionToFileType(extension);

  // 检查是否是允许的文件类型
  const shouldProcess = allowedTypes.includes(fileType);

  let outputPath: string | null = null;
  if (shouldProcess) {
    const outputDir = getOutputDirectory(baseDir, fileType);
    if (outputDir) {
      outputPath = path.join(outputDir, asset.name);
    }
  }

  return {
    asset,
    fileType,
    outputPath,
    shouldProcess
  };
}

/**
 * 批量分类 Assets
 *
 * @param assets - GitHub Assets 数组
 * @param baseDir - 基础输出目录
 * @param allowedTypes - 允许的文件类型列表
 * @returns 分类后的 Assets 数组
 *
 * @example
 * ```ts
 * const classified = classifyAssets(
 *   release.assets,
 *   './iRingo',
 *   [FileType.SGMODULE, FileType.PLUGIN]
 * );
 *
 * const toProcess = classified.filter(c => c.shouldProcess);
 * console.log(`Will process ${toProcess.length} files`);
 * ```
 */
export function classifyAssets(
  assets: GitHubAsset[],
  baseDir: string,
  allowedTypes?: FileType[]
): ClassifiedAsset[] {
  return assets.map(asset => classifyAsset(asset, baseDir, allowedTypes));
}

/**
 * 过滤出需要处理的 Assets
 *
 * @param classifiedAssets - 已分类的 Assets
 * @returns 需要处理的 Assets
 */
export function filterProcessableAssets(
  classifiedAssets: ClassifiedAsset[]
): ClassifiedAsset[] {
  return classifiedAssets.filter(c => c.shouldProcess && c.outputPath !== null);
}

/**
 * 按文件类型分组 Assets
 *
 * @param classifiedAssets - 已分类的 Assets
 * @returns 按文件类型分组的 Map
 */
export function groupAssetsByType(
  classifiedAssets: ClassifiedAsset[]
): Map<FileType, ClassifiedAsset[]> {
  const groups = new Map<FileType, ClassifiedAsset[]>();

  for (const classified of classifiedAssets) {
    if (!classified.shouldProcess) continue;

    const existing = groups.get(classified.fileType) || [];
    existing.push(classified);
    groups.set(classified.fileType, existing);
  }

  return groups;
}

/**
 * 获取文件类型的统计信息
 *
 * @param classifiedAssets - 已分类的 Assets
 * @returns 统计信息对象
 */
export interface FileTypeStats {
  total: number,
  byType: Record<string, number>,
  processable: number,
  skipped: number
}

export function getFileTypeStats(classifiedAssets: ClassifiedAsset[]): FileTypeStats {
  const stats: FileTypeStats = {
    total: classifiedAssets.length,
    byType: {},
    processable: 0,
    skipped: 0
  };

  for (const classified of classifiedAssets) {
    const typeName = classified.fileType;
    stats.byType[typeName] = (stats.byType[typeName] || 0) + 1;

    if (classified.shouldProcess) {
      stats.processable++;
    } else {
      stats.skipped++;
    }
  }

  return stats;
}

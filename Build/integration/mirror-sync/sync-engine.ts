/**
 * 镜像同步引擎
 * 核心同步逻辑，处理文件下载、校验和更新
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Buffer } from 'node:buffer';
import picocolors from 'picocolors';
import { fetchLatestRelease, downloadAsset } from './github-api';
import type { GitHubAsset } from './github-api';
import { getErrorMessage } from '../../lib/misc';

// --- Types (from types.ts) ---

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

// --- Checksum utilities (from checksum.ts) ---

/**
 * 计算 Buffer 的 SHA256 校验和
 *
 * @param buffer - 文件内容 Buffer
 * @returns SHA256 哈希值（十六进制字符串）
 */
export function calculateBufferChecksum(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * 计算文件的 SHA256 校验和
 *
 * @param filePath - 文件路径
 * @returns 文件校验和信息
 */
async function calculateFileChecksum(filePath: string): Promise<FileChecksum | null> {
  try {
    const buffer = await fs.readFile(filePath);
    const checksum = calculateBufferChecksum(buffer);

    return {
      filePath,
      checksum,
      size: buffer.length
    };
  } catch {
    // 文件不存在或无法读取
    return null;
  }
}

/**
 * 检查文件是否需要更新
 *
 * @param filePath - 文件路径
 * @param newBuffer - 新文件内容
 * @returns 是否需要更新
 */
export async function shouldUpdateFile(filePath: string, newBuffer: Buffer): Promise<boolean> {
  const existingChecksum = await calculateFileChecksum(filePath);

  // 文件不存在，需要创建
  if (!existingChecksum) {
    return true;
  }

  // 计算新内容的校验和
  const newChecksum = calculateBufferChecksum(newBuffer);

  // 比较校验和
  return existingChecksum.checksum !== newChecksum;
}

/**
 * 验证文件大小是否合理
 *
 * @param size - 文件大小（字节）
 * @param minSize - 最小大小（默认 10 字节）
 * @param maxSize - 最大大小（默认 100MB）
 * @returns 是否合理
 */
export function isValidFileSize(size: number, minSize = 10, maxSize = 100 * 1024 * 1024): boolean {
  return size >= minSize && size <= maxSize;
}

// --- File classifier (from file-classifier.ts) ---

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

// --- Sync engine ---

/**
 * 确保目录存在
 */
async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch {
    // 忽略已存在的错误
  }
}

/**
 * 同步单个仓库
 *
 * @param repository - 仓库配置
 * @returns 同步结果
 */
export async function syncRepository(
  repository: MirrorRepository
): Promise<SyncResult> {
  const result: SyncResult = {
    hasChanges: false,
    updatedFiles: [],
    newFiles: [],
    failedFiles: []
  };

  console.log(picocolors.cyan(`\n[Sync] Processing repository: ${repository.repo}`));

  // 1. 获取最新 Release
  const releaseResult = await fetchLatestRelease(repository.repo);

  if ('error' in releaseResult) {
    const error = releaseResult.error;
    console.log(picocolors.red(`[Sync] ✗ Failed to fetch release: ${error.message}`));

    result.failedFiles.push({
      file: repository.repo,
      error: error.message
    });

    return result;
  }

  const release = releaseResult;
  console.log(picocolors.gray(`[Sync] Release: ${release.tag_name} (${release.assets.length} assets)`));

  // 2. 分类 Assets
  const classified = classifyAssets(
    release.assets,
    repository.outputDir,
    repository.allowedTypes
  );

  const stats = getFileTypeStats(classified);
  console.log(picocolors.gray(
    `[Sync] Files: ${stats.processable} processable, ${stats.skipped} skipped`
  ));

  const processable = filterProcessableAssets(classified);

  // 3. 处理每个文件
  for (const item of processable) {
    const { asset, outputPath } = item;

    if (!outputPath) continue;

    console.log(picocolors.gray(`[Sync] Processing: ${asset.name} (${asset.size} bytes)`));

    try {
      // 3.1 下载文件
      const downloadResult = await downloadAsset(asset.url);

      if ('error' in downloadResult) {
        console.log(picocolors.red(`[Sync] ✗ Download failed: ${downloadResult.error.message}`));
        result.failedFiles.push({
          file: asset.name,
          error: downloadResult.error.message
        });
        continue;
      }

      const buffer = downloadResult;

      // 3.2 验证文件大小
      if (!isValidFileSize(buffer.length)) {
        console.log(picocolors.yellow(`[Sync] Invalid file size: ${buffer.length} bytes`));
        result.failedFiles.push({
          file: asset.name,
          error: `Invalid file size: ${buffer.length} bytes`
        });
        continue;
      }

      // 3.3 检查是否需要更新
      const fileExisted = await fs.access(outputPath).then(() => true).catch(() => false);
      const needsUpdate = await shouldUpdateFile(outputPath, buffer);

      if (!needsUpdate) {
        console.log(picocolors.gray(`[Sync] ○ No changes: ${asset.name}`));
        continue;
      }

      // 3.4 确保输出目录存在
      await ensureDirectory(path.dirname(outputPath));

      // 3.5 应用后处理（如果有）
      let content = buffer.toString('utf-8');
      if (repository.postProcess) {
        try {
          content = await repository.postProcess(outputPath, content);
        } catch (error) {
          console.log(picocolors.yellow(
            `[Sync] Post-process failed: ${getErrorMessage(error)}`
          ));
        }
      }

      // 3.6 写入文件
      await fs.writeFile(outputPath, content, 'utf-8');

      // 3.7 记录结果
      const isNew = !fileExisted;
      if (isNew) {
        result.newFiles.push(asset.name);
        console.log(picocolors.green(`[Sync] ✓ Added: ${asset.name}`));
      } else {
        result.updatedFiles.push(asset.name);
        console.log(picocolors.green(`[Sync] ✓ Updated: ${asset.name}`));
      }

      result.hasChanges = true;
    } catch (error) {
      console.log(picocolors.red(
        `[Sync] ✗ Error processing ${asset.name}: ${getErrorMessage(error)}`
      ));
      result.failedFiles.push({
        file: asset.name,
        error: getErrorMessage(error)
      });
    }
  }

  return result;
}

/**
 * 下载额外文件
 *
 * @param url - 文件 URL
 * @param outputPath - 输出路径
 * @returns 是否成功
 */
export async function downloadExtraFile(
  url: string,
  outputPath: string
): Promise<boolean> {
  console.log(picocolors.cyan(`[Extra] Downloading: ${url}`));

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.log(picocolors.red(`[Extra] ✗ HTTP ${response.status}: ${response.statusText}`));
      return false;
    }

    const content = await response.text();

    await ensureDirectory(path.dirname(outputPath));
    await fs.writeFile(outputPath, content, 'utf-8');

    console.log(picocolors.green(`[Extra] ✓ Downloaded: ${path.basename(outputPath)}`));
    return true;
  } catch (error) {
    console.log(picocolors.red(
      `[Extra] ✗ Error: ${getErrorMessage(error)}`
    ));
    return false;
  }
}

/**
 * 合并多个同步结果
 */
export function mergeSyncResults(results: SyncResult[]): SyncResult {
  const merged: SyncResult = {
    hasChanges: false,
    updatedFiles: [],
    newFiles: [],
    failedFiles: []
  };

  for (const result of results) {
    if (result.hasChanges) {
      merged.hasChanges = true;
    }
    merged.updatedFiles.push(...result.updatedFiles);
    merged.newFiles.push(...result.newFiles);
    merged.failedFiles.push(...result.failedFiles);
  }

  return merged;
}

/**
 * 打印同步结果摘要
 */
export function printSyncSummary(result: SyncResult): void {
  console.log(picocolors.cyan('\n[Sync] Summary:'));
  console.log(picocolors.green(`  ✓ New files: ${result.newFiles.length}`));
  console.log(picocolors.blue(`  ↻ Updated files: ${result.updatedFiles.length}`));
  console.log(picocolors.red(`  ✗ Failed files: ${result.failedFiles.length}`));

  if (result.failedFiles.length > 0) {
    console.log(picocolors.red('\n[Sync] Failed files:'));
    for (const failed of result.failedFiles) {
      console.log(picocolors.red(`  - ${failed.file}: ${failed.error}`));
    }
  }
}

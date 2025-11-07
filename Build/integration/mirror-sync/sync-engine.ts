/**
 * 镜像同步引擎
 * 核心同步逻辑，处理文件下载、校验和更新
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import picocolors from 'picocolors';
import { fetchLatestRelease, downloadAsset } from './github-api';
import { classifyAssets, filterProcessableAssets, getFileTypeStats } from './file-classifier';
import { shouldUpdateFile, isValidFileSize } from './checksum';
import type { MirrorRepository, SyncResult, FileType } from './types';

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

    // 如果可以重试，记录为失败但不中断
    if (error.canRetry) {
      result.failedFiles.push({
        file: repository.repo,
        error: error.message
      });
    }

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
        console.log(picocolors.yellow(`[Sync] ⚠ Invalid file size: ${buffer.length} bytes`));
        result.failedFiles.push({
          file: asset.name,
          error: `Invalid file size: ${buffer.length} bytes`
        });
        continue;
      }

      // 3.3 检查是否需要更新
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
            `[Sync] ⚠ Post-process failed: ${error instanceof Error ? error.message : String(error)}`
          ));
        }
      }

      // 3.6 写入文件
      await fs.writeFile(outputPath, content, 'utf-8');

      // 3.7 记录结果
      const isNew = !(await fs.access(outputPath).then(() => true).catch(() => false));
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
        `[Sync] ✗ Error processing ${asset.name}: ${error instanceof Error ? error.message : String(error)}`
      ));
      result.failedFiles.push({
        file: asset.name,
        error: error instanceof Error ? error.message : String(error)
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

    // 确保目录存在
    await ensureDirectory(path.dirname(outputPath));

    // 写入文件
    await fs.writeFile(outputPath, content, 'utf-8');

    console.log(picocolors.green(`[Extra] ✓ Downloaded: ${path.basename(outputPath)}`));
    return true;
  } catch (error) {
    console.log(picocolors.red(
      `[Extra] ✗ Error: ${error instanceof Error ? error.message : String(error)}`
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

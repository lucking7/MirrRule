/**
 * 镜像同步模块入口
 * 导出所有公共 API
 */

export * from './github-api';
export * from './sync-engine';
export * from './mirror-config';

import picocolors from 'picocolors';
import {
  syncRepository,
  downloadExtraFile,
  mergeSyncResults,
  printSyncSummary
} from './sync-engine';
import { MIRROR_GROUPS } from './mirror-config';
import type { SyncResult } from './sync-engine';

/**
 * 同步所有镜像组
 *
 * @returns 总体同步结果
 */
export async function syncAllMirrors(): Promise<SyncResult> {
  console.log(picocolors.cyan('\nStarting Mirror Sync...\n'));

  const allResults: SyncResult[] = [];

  // 同步每个镜像组
  for (const group of MIRROR_GROUPS) {
    console.log(picocolors.yellow(`\nSyncing group: ${group.name}`));

    const groupResults: SyncResult[] = [];

    // 同步组内的所有仓库
    for (const repo of group.repositories) {
      const result = await syncRepository(repo);
      groupResults.push(result);
    }

    // 下载额外文件
    if (group.extraDownloads && group.extraDownloads.length > 0) {
      console.log(
        picocolors.cyan(`\n[Extra] Downloading ${group.extraDownloads.length} extra files...`)
      );

      for (const extra of group.extraDownloads) {
        await downloadExtraFile(extra.url, extra.outputPath);
      }
    }

    // 合并组内结果
    const groupResult = mergeSyncResults(groupResults);
    allResults.push(groupResult);

    // 打印组摘要
    console.log(picocolors.yellow(`\n[${group.name}] Group Summary:`));
    console.log(picocolors.green(`  ✓ New: ${groupResult.newFiles.length}`));
    console.log(picocolors.blue(`  ↻ Updated: ${groupResult.updatedFiles.length}`));
    console.log(picocolors.red(`  ✗ Failed: ${groupResult.failedFiles.length}`));
  }

  // 合并所有结果
  const totalResult = mergeSyncResults(allResults);

  // 打印总摘要
  console.log(picocolors.cyan('\nMirror Sync Complete!\n'));
  printSyncSummary(totalResult);

  return totalResult;
}

/**
 * 同步指定的镜像组
 *
 * @param groupName - 组名称
 * @returns 同步结果
 */
export async function syncMirrorGroup(groupName: string): Promise<SyncResult | null> {
  const group = MIRROR_GROUPS.find(g => g.name === groupName);

  if (!group) {
    console.log(picocolors.red(`[Error] Mirror group not found: ${groupName}`));
    return null;
  }

  console.log(picocolors.cyan(`\nSyncing Mirror Group: ${groupName}\n`));

  const results: SyncResult[] = [];

  // 同步所有仓库
  for (const repo of group.repositories) {
    const result = await syncRepository(repo);
    results.push(result);
  }

  // 下载额外文件
  if (group.extraDownloads && group.extraDownloads.length > 0) {
    console.log(
      picocolors.cyan(`\n[Extra] Downloading ${group.extraDownloads.length} extra files...`)
    );

    for (const extra of group.extraDownloads) {
      await downloadExtraFile(extra.url, extra.outputPath);
    }
  }

  const result = mergeSyncResults(results);

  console.log(picocolors.cyan('\nSync Complete!\n'));
  printSyncSummary(result);

  return result;
}

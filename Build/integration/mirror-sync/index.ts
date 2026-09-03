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
  mergeSyncResults,
  printSyncSummary
} from './sync-engine';
import { MIRROR_GROUPS } from './mirror-config';
import type { MirrorGroup, SyncResult } from './sync-engine';

async function syncConfiguredGroup(group: MirrorGroup): Promise<SyncResult> {
  const results: SyncResult[] = [];

  for (const repository of group.repositories) {
    results.push(await syncRepository(repository));
  }

  return mergeSyncResults(results);
}

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

    const groupResult = await syncConfiguredGroup(group);
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

  const result = await syncConfiguredGroup(group);

  console.log(picocolors.cyan('\nSync Complete!\n'));
  printSyncSummary(result);

  return result;
}

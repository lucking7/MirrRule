/**
 * 脚本镜像模块
 * 下载外部 JavaScript 文件并保存到本地
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import picocolors from 'picocolors';
import { $$fetch, defaultRequestInit } from '../../utils/network/fetch-retry';
import { UA_SURGE_MAC } from '../../constants/user-agents';
import type { ScriptInfo, MirrorResult } from './types';
import { getErrorMessage } from '../../utils/cli/logger';

// CommonJS 中的 __dirname 直接可用

/**
 * 脚本输出目录
 */
const SCRIPT_OUTPUT_DIR = path.join(__dirname, '../../../public/Scripts');

/**
 * 最小文件大小（字节）
 */
const MIN_FILE_SIZE = 10;

/**
 * 确保输出目录存在
 */
async function ensureOutputDirectory(): Promise<void> {
  try {
    await fs.mkdir(SCRIPT_OUTPUT_DIR, { recursive: true });
  } catch {
    // 忽略已存在的错误
  }
}

/**
 * 检查文件是否已存在
 *
 * @param filename - 文件名
 * @returns 是否存在
 */
async function fileExists(filename: string): Promise<boolean> {
  const filePath = path.join(SCRIPT_OUTPUT_DIR, filename);
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 下载单个脚本
 *
 * @param script - 脚本信息
 * @returns 是否成功
 */
export async function downloadScript(script: ScriptInfo): Promise<boolean> {
  const filePath = path.join(SCRIPT_OUTPUT_DIR, script.filename);

  console.log(picocolors.gray(`[Mirror] ${script.filename}`));
  console.log(picocolors.gray(`  From: ${script.originalUrl}`));

  try {
    const response = await $$fetch(script.originalUrl, {
      ...defaultRequestInit,
      headers: {
        'User-Agent': UA_SURGE_MAC,
        Accept: '*/*'
      }
    });

    if (!response.ok) {
      console.log(picocolors.red(`[Mirror] ✗ HTTP ${response.status}: ${response.statusText}`));
      return false;
    }

    const content = await response.text();

    // 验证文件大小
    if (content.length < MIN_FILE_SIZE) {
      console.log(picocolors.yellow(`[Mirror] File too small: ${content.length} bytes`));
      return false;
    }

    await fs.writeFile(filePath, content, 'utf-8');

    console.log(picocolors.green(`[Mirror] ✓ ${script.filename} (${content.length} bytes)`));
    return true;
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    console.log(picocolors.red(`[Mirror] ✗ ${script.filename}: ${errorMsg}`));
    return false;
  }
}

/**
 * 批量镜像脚本
 *
 * @param scripts - 脚本信息数组
 * @param concurrency - 并发数
 * @returns 镜像结果
 */
export async function mirrorScripts(scripts: ScriptInfo[], concurrency = 5): Promise<MirrorResult> {
  await ensureOutputDirectory();

  const result: MirrorResult = {
    total: scripts.length,
    mirrored: 0,
    skipped: 0,
    failed: 0,
    failedScripts: []
  };

  console.log(picocolors.cyan(`\n[Mirror] Processing ${scripts.length} scripts...\n`));

  const toDownload: ScriptInfo[] = [];

  for (const script of scripts) {
    if (script.isMirrored) {
      result.skipped++;
      continue;
    }

    // 检查文件是否已存在
    const exists = await fileExists(script.filename);
    if (exists) {
      console.log(picocolors.gray(`[Mirror] ○ Already exists: ${script.filename}`));
      result.skipped++;
      continue;
    }

    toDownload.push(script);
  }

  if (toDownload.length === 0) {
    console.log(picocolors.gray('[Mirror] No scripts to download\n'));
    return result;
  }

  console.log(picocolors.cyan(`[Mirror] Downloading ${toDownload.length} scripts...\n`));

  for (let i = 0; i < toDownload.length; i += concurrency) {
    const batch = toDownload.slice(i, i + concurrency);

    const batchResults = await Promise.all(batch.map(script => downloadScript(script)));

    for (let j = 0; j < batch.length; j++) {
      if (batchResults[j]) {
        result.mirrored++;
      } else {
        result.failed++;
        result.failedScripts.push({
          url: batch[j].originalUrl,
          error: 'Download failed'
        });
      }
    }
  }

  return result;
}

/**
 * 打印镜像结果摘要
 */
export function printMirrorSummary(result: MirrorResult): void {
  console.log(picocolors.cyan('\n[Mirror] Summary:'));
  console.log(picocolors.gray(`  Total: ${result.total}`));
  console.log(picocolors.green(`  ✓ Mirrored: ${result.mirrored}`));
  console.log(picocolors.blue(`  ○ Skipped: ${result.skipped}`));
  console.log(picocolors.red(`  ✗ Failed: ${result.failed}`));

  if (result.failedScripts.length > 0) {
    console.log(picocolors.red('\n[Mirror] Failed scripts:'));
    for (const failed of result.failedScripts) {
      console.log(picocolors.red(`  - ${failed.url}`));
    }
  }
}

/**
 * 清理未使用的脚本文件
 *
 * @param usedFilenames - 正在使用的文件名集合
 * @returns 删除的文件数
 */
export async function cleanupUnusedScripts(usedFilenames: Set<string>): Promise<number> {
  try {
    const files = await fs.readdir(SCRIPT_OUTPUT_DIR);
    let deletedCount = 0;

    for (const file of files) {
      if (!file.endsWith('.js')) {
        continue;
      }

      if (!usedFilenames.has(file)) {
        const filePath = path.join(SCRIPT_OUTPUT_DIR, file);
        await fs.unlink(filePath);
        console.log(picocolors.yellow(`[Cleanup] Deleted unused: ${file}`));
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(picocolors.cyan(`\n[Cleanup] Deleted ${deletedCount} unused scripts\n`));
    }

    return deletedCount;
  } catch (error) {
    console.log(
      picocolors.red(`[Cleanup] Error: ${getErrorMessage(error)}`)
    );
    return 0;
  }
}

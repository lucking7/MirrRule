/**
 * 插件下载模块 - 下载插件到本地供 Script-Hub 转换
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import picocolors from 'picocolors';
import { $$fetch } from '../../utils/network/fetch-retry';
import { UA_SURGE_MAC } from '../../constants/user-agents';
import type { PluginInfo } from './types';
import { getErrorMessage } from '../../lib/misc';

const TEMP_DIR = path.join(__dirname, '../../../.cache/plugins');

export interface DownloadResult {
  plugin: PluginInfo;
  localPath?: string;
  error?: string;
}

async function ensureTempDirectory(): Promise<void> {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

async function _cleanupTempDirectory(): Promise<void> {
  try {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    console.log(picocolors.gray('[Cleanup] Removed temporary plugin directory'));
  } catch (error) {
    console.log(picocolors.yellow(`[Cleanup] Failed to remove temp directory: ${String(error)}`));
  }
}
/**
 * 下载单个插件到本地（带重试机制）
 *
 * @param plugin - 插件信息
 * @param maxRetries - 最大重试次数
 * @returns 本地文件路径或错误信息
 */
async function downloadPlugin(
  plugin: PluginInfo,
  maxRetries = 3
): Promise<string | { error: string }> {
  await ensureTempDirectory();

  const filename = `${plugin.name}.${plugin.extension}`;
  const localPath = path.join(TEMP_DIR, filename);

  console.log(picocolors.gray(`[Download] ${plugin.name} (${plugin.extension})`));
  console.log(picocolors.gray(`  URL: ${plugin.url}`));

  let lastError = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        const retryDelay = 2000 + Math.random() * 3000;
        console.log(
          picocolors.yellow(
            `[Download] Retry ${attempt}/${maxRetries} for ${plugin.name} (waiting ${Math.round(
              retryDelay / 1000
            )}s)...`
          )
        );
        await new Promise<void>(resolve => { setTimeout(resolve, retryDelay); });
      }

      const response = await $$fetch(plugin.url, {
        headers: {
          'User-Agent': UA_SURGE_MAC,
          Accept: '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          Referer: new URL(plugin.url).origin,
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read response body');
        lastError = `HTTP ${response.status}: ${response.statusText}`;

        console.log(picocolors.red(`[Download] HTTP ${response.status} for ${plugin.name}`));
        if (errorText && errorText.length < 500) {
          console.log(picocolors.gray(`  Response: ${errorText.slice(0, 200)}`));
        }

        if (response.status >= 400 && response.status < 500) {
          return { error: lastError };
        }

        continue;
      }

      const content = await response.text();

      if (!content || content.trim().length === 0) {
        lastError = 'Empty response from source';
        console.log(picocolors.red(`[Download] Empty response for ${plugin.name}`));
        continue;
      }

      if (plugin.extension === 'lpx') {
        if (
          !content.includes('[General]') &&
          !content.includes('[Script]') &&
          !content.includes('[Rule]')
        ) {
          lastError = 'Invalid .lpx format (missing Loon plugin sections)';
          console.log(picocolors.red(`[Download] Invalid format for ${plugin.name}`));
          console.log(picocolors.gray(`  Content preview: ${content.slice(0, 200)}`));
          return { error: lastError };
        }
      } else if (
        plugin.extension === 'plugin' &&
        !content.includes('[General]') &&
        !content.includes('[Script]') &&
        !content.includes('[Rule]')
      ) {
        lastError = 'Invalid .plugin format (missing plugin sections)';
        console.log(picocolors.red(`[Download] Invalid format for ${plugin.name}`));
        console.log(picocolors.gray(`  Content preview: ${content.slice(0, 200)}`));
        return { error: lastError };
      }

      await fs.writeFile(localPath, content, 'utf-8');

      console.log(
        picocolors.green(
          `[Download] ✓ ${plugin.name} → ${filename}${attempt > 1 ? ` (attempt ${attempt})` : ''}`
        )
      );
      return localPath;
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      lastError = errorMsg;

      console.log(
        picocolors.red(
          `[Download] ✗ ${plugin.name} (attempt ${attempt}/${maxRetries}): ${errorMsg}`
        )
      );

      if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
        console.log(picocolors.yellow('  Timeout after 30s'));
      }

      if (attempt === maxRetries) {
        return { error: lastError };
      }
    }
  }

  return { error: lastError || 'Unknown error' };
}

/**
 * 批量下载插件
 *
 * @param plugins - 插件列表
 * @param concurrency - 并发数
 * @returns 下载结果数组
 */
async function _downloadPluginsBatch(
  plugins: PluginInfo[],
  concurrency = 5
): Promise<DownloadResult[]> {
  const results: DownloadResult[] = [];

  console.log(
    picocolors.cyan(`\n[Download] Starting batch download (concurrency: ${concurrency})...\n`)
  );

  for (let i = 0; i < plugins.length; i += concurrency) {
    const batch = plugins.slice(i, i + concurrency);
    const batchNumber = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(plugins.length / concurrency);

    console.log(
      picocolors.cyan(`[Download] Batch ${batchNumber}/${totalBatches} (${batch.length} plugins)`)
    );

    const batchResults: DownloadResult[] = await Promise.all(
      batch.map(async plugin => {
        const result = await downloadPlugin(plugin);
        return typeof result === 'string'
          ? { plugin, localPath: result }
          : { plugin, error: result.error };
      })
    );

    results.push(...batchResults);

    const batchSuccess = batchResults.filter(r => r.localPath).length;
    const batchFailed = batchResults.filter(r => r.error).length;
    console.log(picocolors.gray(`  ✓ ${batchSuccess} 成功, ✗ ${batchFailed} 失败\n`));
  }

  return results;
}

/**
 * 获取下载统计信息
 */
interface DownloadStats {
  total: number;
  success: number;
  failed: number;
  byExtension: {
    plugin: { success: number; failed: number };
    lpx: { success: number; failed: number };
  };
}

function getDownloadStats(results: DownloadResult[]): DownloadStats {
  const stats: DownloadStats = {
    total: results.length,
    success: 0,
    failed: 0,
    byExtension: {
      plugin: { success: 0, failed: 0 },
      lpx: { success: 0, failed: 0 },
    },
  };

  for (const result of results) {
    if (result.localPath) {
      stats.success++;
      stats.byExtension[result.plugin.extension].success++;
    } else {
      stats.failed++;
      stats.byExtension[result.plugin.extension].failed++;
    }
  }

  return stats;
}

/**
 * 打印下载统计信息
 */
function _printDownloadStats(results: DownloadResult[]): void {
  const stats = getDownloadStats(results);

  console.log(picocolors.cyan('\n[Download] Statistics:'));
  console.log(picocolors.green(`  ✓ Success: ${stats.success}/${stats.total}`));
  console.log(picocolors.red(`  ✗ Failed: ${stats.failed}/${stats.total}`));
  console.log(
    picocolors.gray(
      `  - .plugin: ${stats.byExtension.plugin.success} success, ${stats.byExtension.plugin.failed} failed`
    )
  );
  console.log(
    picocolors.gray(
      `  - .lpx: ${stats.byExtension.lpx.success} success, ${stats.byExtension.lpx.failed} failed`
    )
  );

  if (stats.failed > 0) {
    console.log(picocolors.red('\n[Download] Failed plugins:'));
    const failed = results.filter(r => r.error);
    for (const result of failed) {
      console.log(picocolors.red(`  - ${result.plugin.name}: ${result.error}`));
    }
  }
}

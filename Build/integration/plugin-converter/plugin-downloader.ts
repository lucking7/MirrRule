/**
 * 插件下载模块
 * 先下载插件到本地，再用 Script-Hub 转换
 *
 * 优势：
 * 1. 完全控制下载过程，可以使用正确的 User-Agent
 * 2. 避免 Script-Hub 容器访问外网的网络问题
 * 3. 更快更可靠（本地文件访问）
 * 4. 不依赖外部代理服务
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import picocolors from 'picocolors';
import { $$fetch } from '../../utils/network/fetch-retry';
import type { PluginInfo } from './types';

/**
 * 临时下载目录
 */
const TEMP_DIR = path.join(__dirname, '../../../.cache/plugins');

/**
 * 下载结果
 */
export interface DownloadResult {
  plugin: PluginInfo;
  localPath?: string;
  error?: string;
}

/**
 * 确保临时目录存在
 */
async function ensureTempDirectory(): Promise<void> {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  } catch {
    // 忽略错误
  }
}

/**
 * 清理临时目录
 */
export async function cleanupTempDirectory(): Promise<void> {
  try {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    console.log(picocolors.gray('[Cleanup] Removed temporary plugin directory'));
  } catch (error) {
    console.log(picocolors.yellow(`[Cleanup] Failed to remove temp directory: ${error}`));
  }
}

/**
 * 下载单个插件到本地
 *
 * @param plugin - 插件信息
 * @returns 本地文件路径或错误信息
 */
export async function downloadPlugin(plugin: PluginInfo): Promise<string | { error: string }> {
  await ensureTempDirectory();

  const filename = `${plugin.name}.${plugin.extension}`;
  const localPath = path.join(TEMP_DIR, filename);

  console.log(picocolors.gray(`[Download] ${plugin.name} (${plugin.extension})`));
  console.log(picocolors.gray(`  URL: ${plugin.url}`));

  try {
    const response = await $$fetch(plugin.url, {
      headers: {
        // 🔑 关键: 使用 Surge Mac UA，某些源站需要此 UA 才能正常访问
        'User-Agent': 'Surge Mac/2985',
        Accept: '*/*',
      },
    });

    if (!response.ok) {
      return {
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const content = await response.text();

    // 验证内容
    if (!content || content.trim().length === 0) {
      return {
        error: 'Empty response from source',
      };
    }

    // 基本验证：检查文件格式
    if (plugin.extension === 'lpx') {
      // .lpx 文件应该包含 Loon 插件标记
      if (
        !content.includes('[General]') &&
        !content.includes('[Script]') &&
        !content.includes('[Rule]')
      ) {
        return {
          error: 'Invalid .lpx format (missing Loon plugin sections)',
        };
      }
    } else if (plugin.extension === 'plugin') {
      // .plugin 文件应该包含插件标记
      if (
        !content.includes('[General]') &&
        !content.includes('[Script]') &&
        !content.includes('[Rule]')
      ) {
        return {
          error: 'Invalid .plugin format (missing plugin sections)',
        };
      }
    }

    // 保存到本地
    await fs.writeFile(localPath, content, 'utf-8');

    console.log(picocolors.green(`[Download] ✓ ${plugin.name} → ${filename}`));
    return localPath;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log(picocolors.red(`[Download] ✗ ${plugin.name}: ${errorMsg}`));
    return { error: errorMsg };
  }
}

/**
 * 批量下载插件
 *
 * @param plugins - 插件列表
 * @param concurrency - 并发数
 * @returns 下载结果数组
 */
export async function downloadPluginsBatch(
  plugins: PluginInfo[],
  concurrency = 5
): Promise<DownloadResult[]> {
  const results: DownloadResult[] = [];

  console.log(
    picocolors.cyan(`\n[Download] Starting batch download (concurrency: ${concurrency})...\n`)
  );

  // 分批处理
  for (let i = 0; i < plugins.length; i += concurrency) {
    const batch = plugins.slice(i, i + concurrency);
    const batchNumber = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(plugins.length / concurrency);

    console.log(
      picocolors.cyan(`[Download] Batch ${batchNumber}/${totalBatches} (${batch.length} plugins)`)
    );

    const batchResults = await Promise.all(
      batch.map(async plugin => {
        const result = await downloadPlugin(plugin);
        return {
          plugin,
          ...(typeof result === 'string' ? { localPath: result } : { error: result.error }),
        };
      })
    );

    results.push(...batchResults);

    // 统计当前批次结果
    const batchSuccess = batchResults.filter(r => r.localPath).length;
    const batchFailed = batchResults.filter(r => r.error).length;
    console.log(picocolors.gray(`  ✓ ${batchSuccess} 成功, ✗ ${batchFailed} 失败\n`));
  }

  return results;
}

/**
 * 获取下载统计信息
 */
export interface DownloadStats {
  total: number;
  success: number;
  failed: number;
  byExtension: {
    plugin: { success: number; failed: number };
    lpx: { success: number; failed: number };
  };
}

export function getDownloadStats(results: DownloadResult[]): DownloadStats {
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
export function printDownloadStats(results: DownloadResult[]): void {
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

  // 打印失败的插件（复用 stats 中已经过滤的结果）
  if (stats.failed > 0) {
    console.log(picocolors.red('\n[Download] Failed plugins:'));
    // 只在需要时才过滤一次
    const failed = results.filter(r => r.error);
    for (const result of failed) {
      console.log(picocolors.red(`  - ${result.plugin.name}: ${result.error}`));
    }
  }
}

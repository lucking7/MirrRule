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
    console.log(picocolors.yellow(`[Cleanup] Failed to remove temp directory: ${String(error)}`));
  }
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
}

/**
 * 下载单个插件到本地（带重试机制）
 *
 * @param plugin - 插件信息
 * @param maxRetries - 最大重试次数
 * @returns 本地文件路径或错误信息
 */
export async function downloadPlugin(
  plugin: PluginInfo,
  maxRetries = 3
): Promise<string | { error: string }> {
  await ensureTempDirectory();

  const filename = `${plugin.name}.${plugin.extension}`;
  const localPath = path.join(TEMP_DIR, filename);

  console.log(picocolors.gray(`[Download] ${plugin.name} (${plugin.extension})`));
  console.log(picocolors.gray(`  URL: ${plugin.url}`));

  let lastError = '';

  // 重试循环
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 如果是重试，添加延迟（2-5秒随机）
      if (attempt > 1) {
        const retryDelay = 2000 + Math.random() * 3000; // 2-5秒
        console.log(
          picocolors.yellow(
            `[Download] Retry ${attempt}/${maxRetries} for ${plugin.name} (waiting ${Math.round(
              retryDelay / 1000
            )}s)...`
          )
        );
        await delay(retryDelay);
      }

      const response = await $$fetch(plugin.url, {
        headers: {
          // 🔑 关键: 使用 Surge Mac UA，某些源站需要此 UA 才能正常访问
          'User-Agent': 'Surge Mac/2985',
          Accept: '*/*',
          // 添加常见的浏览器请求头，避免被防护机制拦截
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          // 添加 Referer（某些站点需要）
          Referer: new URL(plugin.url).origin,
        },
        // 添加超时设置（30秒）
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read response body');
        lastError = `HTTP ${response.status}: ${response.statusText}`;

        // 记录详细错误信息
        console.log(picocolors.red(`[Download] HTTP ${response.status} for ${plugin.name}`));
        if (errorText && errorText.length < 500) {
          console.log(picocolors.gray(`  Response: ${errorText.slice(0, 200)}`));
        }

        // 对于 4xx 错误，不重试
        if (response.status >= 400 && response.status < 500) {
          return { error: lastError };
        }

        // 对于 5xx 错误，继续重试
        continue;
      }

      const content = await response.text();

      // 验证内容
      if (!content || content.trim().length === 0) {
        lastError = 'Empty response from source';
        console.log(picocolors.red(`[Download] Empty response for ${plugin.name}`));
        continue;
      }

      // 基本验证：检查文件格式
      if (plugin.extension === 'lpx') {
        // .lpx 文件应该包含 Loon 插件标记
        if (
          !content.includes('[General]') &&
          !content.includes('[Script]') &&
          !content.includes('[Rule]')
        ) {
          lastError = 'Invalid .lpx format (missing Loon plugin sections)';
          console.log(picocolors.red(`[Download] Invalid format for ${plugin.name}`));
          console.log(picocolors.gray(`  Content preview: ${content.slice(0, 200)}`));
          // 格式错误不重试
          return { error: lastError };
        }
      } else if (
        plugin.extension === 'plugin' && // .plugin 文件应该包含插件标记
        !content.includes('[General]') &&
        !content.includes('[Script]') &&
        !content.includes('[Rule]')
      ) {
        lastError = 'Invalid .plugin format (missing plugin sections)';
        console.log(picocolors.red(`[Download] Invalid format for ${plugin.name}`));
        console.log(picocolors.gray(`  Content preview: ${content.slice(0, 200)}`));
        // 格式错误不重试
        return { error: lastError };
      }

      // 保存到本地
      await fs.writeFile(localPath, content, 'utf-8');

      console.log(
        picocolors.green(
          `[Download] ✓ ${plugin.name} → ${filename}${attempt > 1 ? ` (attempt ${attempt})` : ''}`
        )
      );
      return localPath;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      lastError = errorMsg;

      console.log(
        picocolors.red(
          `[Download] ✗ ${plugin.name} (attempt ${attempt}/${maxRetries}): ${errorMsg}`
        )
      );

      // 如果是超时错误，记录详细信息
      if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
        console.log(picocolors.yellow('  Timeout after 30s'));
      }

      // 如果是最后一次尝试，返回错误
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

    const batchResults: DownloadResult[] = await Promise.all(
      batch.map(async plugin => {
        const result = await downloadPlugin(plugin);
        return typeof result === 'string'
          ? { plugin, localPath: result }
          : { plugin, error: result.error };
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

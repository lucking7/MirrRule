/**
 * Loon 插件镜像模块
 * 下载并缓存 Loon 插件文件到本地
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import picocolors from 'picocolors';
import { $$fetch, defaultRequestInit } from '../../utils/network/fetch-retry.ts';
import type { PluginInfo } from './types.ts';
import { applyProxyIfNeeded } from '../../utils/network/proxy';
import { getErrorMessage } from '../../lib/misc';

/**
 * 镜像目录（放在 .cache 目录下，不部署到生产环境）
 */
const MIRROR_DIR = path.join(__dirname, '../../../.cache/plugins');

/**
 * 用户代理
 */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * 确保镜像目录存在
 */
async function ensureMirrorDirectory(): Promise<void> {
  try {
    await fs.mkdir(MIRROR_DIR, { recursive: true });
  } catch {
    // 忽略错误
  }
}

/**
 * 获取插件镜像路径
 */
function getPluginMirrorPath(plugin: PluginInfo): string {
  const filename = `${plugin.name}.${plugin.extension}`;
  return path.join(MIRROR_DIR, filename);
}

/**
 * 检查插件是否已镜像
 */
async function isPluginMirrored(plugin: PluginInfo): Promise<boolean> {
  try {
    const mirrorPath = getPluginMirrorPath(plugin);
    await fs.access(mirrorPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 下载并镜像 Loon 插件
 */
async function mirrorPlugin(
  plugin: PluginInfo
): Promise<{ success: boolean; content?: string; error?: string }> {
  console.log(picocolors.gray(`  [Mirror] Downloading ${plugin.name}...`));

  try {
    // 下载插件内容（必要时通过代理）
    const url = applyProxyIfNeeded(plugin.url);

    const response = await $$fetch(url, {
      ...defaultRequestInit,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: '*/*',
      },
    });

    if (!response.ok) {
      const error = `HTTP ${response.status}: ${response.statusText}`;
      console.log(picocolors.red(`  [Mirror] ✗ ${plugin.name}: ${error}`));
      return { success: false, error };
    }

    const content = await response.text();

    await ensureMirrorDirectory();
    const mirrorPath = getPluginMirrorPath(plugin);
    await fs.writeFile(mirrorPath, content, 'utf-8');

    console.log(picocolors.green(`  [Mirror] ✓ ${plugin.name} mirrored successfully`));
    return { success: true, content };
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    console.log(picocolors.red(`  [Mirror] ✗ ${plugin.name}: ${errorMsg}`));
    return { success: false, error: errorMsg };
  }
}

/**
 * 从镜像读取插件内容
 */
async function readMirroredPlugin(plugin: PluginInfo): Promise<string | null> {
  try {
    const mirrorPath = getPluginMirrorPath(plugin);
    return await fs.readFile(mirrorPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 获取或下载插件内容
 * 优先使用镜像，不存在则下载并镜像
 */
export async function getPluginContent(
  plugin: PluginInfo,
  forceUpdate = false
): Promise<{ success: boolean; content?: string; error?: string }> {
  // 检查是否已镜像（且不强制更新）
  if (!forceUpdate && (await isPluginMirrored(plugin))) {
    console.log(picocolors.gray(`  [Mirror] Using cached ${plugin.name}...`));
    const content = await readMirroredPlugin(plugin);
    if (content) {
      return { success: true, content };
    }
  }

  // 下载并镜像
  return mirrorPlugin(plugin);
}

/**
 * 批量镜像插件
 */
export async function mirrorPluginsBatch(
  plugins: PluginInfo[],
  forceUpdate = false
): Promise<{
  total: number;
  mirrored: number;
  cached: number;
  failed: number;
  failedPlugins: Array<{ name: string; error: string }>;
}> {
  console.log(picocolors.cyan(`\n[Plugin Mirror] Processing ${plugins.length} plugins...\n`));

  const stats = {
    total: plugins.length,
    mirrored: 0,
    cached: 0,
    failed: 0,
    failedPlugins: [] as Array<{ name: string; error: string }>,
  };

  for (const plugin of plugins) {
    const result = await getPluginContent(plugin, forceUpdate);

    if (result.success) {
      // 检查是新镜像还是使用缓存
      if (result.content && !forceUpdate && (await isPluginMirrored(plugin))) {
        stats.cached++;
      } else {
        stats.mirrored++;
      }
    } else {
      stats.failed++;
      stats.failedPlugins.push({
        name: plugin.name,
        error: result.error || 'Unknown error',
      });
    }
  }

  console.log(picocolors.green('\n[Plugin Mirror] Complete:'));
  console.log(picocolors.gray(`  - Total: ${stats.total}`));
  console.log(picocolors.gray(`  - Mirrored: ${stats.mirrored}`));
  console.log(picocolors.gray(`  - Cached: ${stats.cached}`));
  console.log(picocolors.gray(`  - Failed: ${stats.failed}`));

  if (stats.failedPlugins.length > 0) {
    console.log(picocolors.red('\n[Plugin Mirror] Failed plugins:'));
    for (const failed of stats.failedPlugins) {
      console.log(picocolors.red(`  - ${failed.name}: ${failed.error}`));
    }
  }

  return stats;
}

/**
 * 获取镜像统计信息
 */
async function _getMirrorStats(): Promise<{
  totalMirrored: number;
  mirrorPath: string;
}> {
  try {
    await ensureMirrorDirectory();
    const files = await fs.readdir(MIRROR_DIR);
    const pluginFiles = files.filter(f => f.endsWith('.plugin') || f.endsWith('.lpx'));

    return {
      totalMirrored: pluginFiles.length,
      mirrorPath: MIRROR_DIR,
    };
  } catch {
    return {
      totalMirrored: 0,
      mirrorPath: MIRROR_DIR,
    };
  }
}

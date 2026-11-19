/**
 * Loon 插件镜像模块
 * 下载并缓存 Loon 插件文件到本地
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import picocolors from 'picocolors';
import { UA_SURGE_MAC } from '../../constants/user-agents';
import { $$fetch, defaultRequestInit } from '../../utils/network/fetch-retry.ts';
import type { PluginInfo } from './types.ts';
import { applyProxyIfNeeded } from '../../utils/network/proxy';
import { getErrorMessage } from '../../lib/misc';
import { writeFileAtomic } from '../../lib/atomic-file';
import { identifyPluginSource } from './plugin-identity';
import { hasActiveSurgeEntry } from '../../lib/downloaded-text';
import { isUnavailableFailure, isUnavailableStatus } from './upstream-failure';

/**
 * 镜像目录（放在 .cache 目录下，不部署到生产环境）
 */
const MIRROR_DIR = path.join(__dirname, '../../../.cache/plugins');

/**
 * 获取插件镜像路径
 */
export function getPluginMirrorFilename(plugin: PluginInfo): string {
  const identity = identifyPluginSource(plugin);
  const sourceExtension = path.extname(new URL(identity.sourceUrl).pathname).toLowerCase();
  return `${identity.sourceId}${sourceExtension === '.lpx' ? '.lpx' : '.plugin'}`;
}

function getPluginMirrorPath(plugin: PluginInfo, mirrorDirectory = MIRROR_DIR): string {
  return path.join(mirrorDirectory, getPluginMirrorFilename(plugin));
}

export interface PluginMirrorOptions {
  mirrorDirectory?: string,
  fetchFn?: (
    url: string,
    init?: Parameters<typeof $$fetch>[1]
  ) => Promise<{
    ok: boolean,
    status: number,
    statusText: string,
    text: () => Promise<string>
  }>
}

export interface PluginContentResult {
  success: boolean,
  content?: string,
  error?: string,
  /** The refresh failed because the source could not be fetched (network error or HTTP 5xx). */
  unavailable?: boolean,
  fromCache?: boolean,
  degraded?: boolean
}

function validatePluginContent(content: string, useNativeSurge = false): string | null {
  if (content.trim().length === 0) return 'Empty plugin response';
  if (useNativeSurge) return hasActiveSurgeEntry(content) ? null : 'Native Surge module has no active supported functional entries';

  const hasPluginSection = /^\s*\[(?:Argument|General|Host|Map Local|MITM|Rewrite|Rule|Script)\]\s*$/imu
    .test(content);
  if (!hasPluginSection) return 'Invalid plugin format';

  return null;
}

/**
 * 下载并镜像 Loon 插件
 */
async function mirrorPlugin(
  plugin: PluginInfo,
  options: PluginMirrorOptions = {}
): Promise<PluginContentResult> {
  console.log(picocolors.gray(`  [Mirror] Downloading ${plugin.name}...`));

  let content: string;
  try {
    // 下载插件内容（必要时通过代理）
    const url = applyProxyIfNeeded(plugin.url);

    const response = await (options.fetchFn ?? $$fetch)(url, {
      ...defaultRequestInit,
      headers: {
        'User-Agent': UA_SURGE_MAC,
        Accept: '*/*',
      },
    });

    if (!response.ok) {
      const error = `HTTP ${response.status}: ${response.statusText}`;
      console.log(picocolors.red(`  [Mirror] ✗ ${plugin.name}: ${error}`));
      return { success: false, error, ...(isUnavailableStatus(response.status) && { unavailable: true }) };
    }

    content = await response.text();
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    console.log(picocolors.red(`  [Mirror] ✗ ${plugin.name}: ${errorMsg}`));
    return { success: false, error: errorMsg, ...(isUnavailableFailure(error) && { unavailable: true }) };
  }

  const validationError = validatePluginContent(content, plugin.useNativeSurge);
  if (validationError) {
    console.log(picocolors.red(`  [Mirror] ✗ ${plugin.name}: ${validationError}`));
    return { success: false, error: validationError };
  }

  try {
    await writeFileAtomic(getPluginMirrorPath(plugin, options.mirrorDirectory), content);
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    console.log(picocolors.red(`  [Mirror] ✗ ${plugin.name}: ${errorMsg}`));
    return { success: false, error: errorMsg };
  }

  console.log(picocolors.green(`  [Mirror] ✓ ${plugin.name} mirrored successfully`));
  return { success: true, content };
}

/**
 * 从镜像读取插件内容
 */
async function readMirroredPlugin(
  plugin: PluginInfo,
  mirrorDirectory = MIRROR_DIR
): Promise<string | null> {
  try {
    const mirrorPath = getPluginMirrorPath(plugin, mirrorDirectory);
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
  forceUpdate = false,
  options: PluginMirrorOptions = {}
): Promise<PluginContentResult> {
  const cachedContent = await readMirroredPlugin(plugin, options.mirrorDirectory);
  if (!forceUpdate && cachedContent !== null) {
    console.log(picocolors.gray(`  [Mirror] Using cached ${plugin.name}...`));
    return { success: true, content: cachedContent, fromCache: true };
  }

  const refreshed = await mirrorPlugin(plugin, options);
  if (cachedContent === null || refreshed.success) return refreshed;

  console.log(picocolors.yellow(`  [Mirror] Using last-known-good ${plugin.name} after refresh failure`));
  return {
    success: true,
    content: cachedContent,
    error: refreshed.error,
    ...(refreshed.unavailable && { unavailable: true }),
    fromCache: true,
    degraded: true,
  };
}

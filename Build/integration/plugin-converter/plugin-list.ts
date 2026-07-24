/**
 * 插件列表下载模块
 * 从 Script-Hub 获取插件列表
 */

import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import picocolors from 'picocolors';
import { $$fetch, defaultRequestInit } from '../../utils/network/fetch-retry';
import type { PluginInfo } from './types';
import { buildClassifiedProxyUrlCandidates } from '../../utils/network/proxy';
import type { ProxyUrlCandidate } from '../../utils/network/proxy';
import { getErrorMessage } from '../../lib/misc';
import { updatePluginMetadata } from './provenance';

/**
 * 插件列表 URL（可通过环境变量覆盖）
 */
const DEFAULT_PLUGIN_LIST_URL = 'https://hub.kelee.one/list.json';
const FORCE_PROXY_FOR_LIST = (process.env.PLUGIN_LIST_FORCE_PROXY ?? 'true') !== 'false';

function resolvePluginListSources(): ProxyUrlCandidate[] {
  const overrides: string[] = [];
  const rawOverrides = (process.env.PLUGIN_LIST_URL ?? '').split(',');
  for (const item of rawOverrides) {
    const trimmed = item.trim();
    if (trimmed) {
      overrides.push(trimmed);
    }
  }

  const bases = overrides.length > 0 ? overrides : [DEFAULT_PLUGIN_LIST_URL];
  const deduped: ProxyUrlCandidate[] = [];
  const seen = new Set<string>();

  for (const base of bases) {
    const candidates = buildClassifiedProxyUrlCandidates(base, {
      forceProxy: FORCE_PROXY_FOR_LIST,
      preferDirect: true,
    });

    for (const candidate of candidates) {
      if (seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      deduped.push(candidate);
    }
  }

  return deduped;
}

/**
 * 额外插件列表 - 不在 Script-Hub 列表中的插件
 */
const EXTRA_PLUGINS: PluginInfo[] = [
  {
    name: 'blockAds',
    url: 'https://raw.githubusercontent.com/fmz200/wool_scripts/main/Loon/plugin/blockAds.plugin',
    extension: 'plugin',
    useLocalOnly: true, // 仅使用本地转换器
  },
];

/**
 * 插件 URL 正则表达式
 */
const PLUGIN_URL_REGEX = /https?:\/\/[^"]+\.(?:plugin|lpx)/g;

/**
 * 下载插件列表
 *
 * @returns 插件列表 JSON 字符串
 */
interface PluginListDownload {
  text: string;
  source: 'direct' | 'proxy';
  bytes: number;
  sha256: string
}

async function downloadPluginList(): Promise<PluginListDownload | { error: string }> {
  const sources = resolvePluginListSources();
  const errors: string[] = [];

  for (const source of sources) {
    console.log(picocolors.cyan(`[Plugin List] Downloading via ${source.source}...`));

    try {
      const response = await $$fetch(source.url, {
        ...defaultRequestInit,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        console.log(picocolors.red(`[Plugin List] ✗ ${errorMsg}`));
        errors.push(`${source.source} -> ${errorMsg}`);
        continue;
      }

      const text = await response.text();

      if (!text || text.trim().length === 0) {
        console.log(picocolors.red('[Plugin List] ✗ Empty response'));
        errors.push(`${source.source} -> Empty response`);
        continue;
      }

      try {
        JSON.parse(text);
      } catch {
        console.log(picocolors.red('[Plugin List] ✗ Invalid JSON format'));
        errors.push(`${source.source} -> Invalid JSON`);
        continue;
      }

      const sha256 = createHash('sha256').update(text).digest('hex');
      const bytes = Buffer.byteLength(text);
      console.log(
        picocolors.green(
          `[Plugin List] ✓ asset=plugin-list source=${source.source} bytes=${bytes} sha256=${sha256}`
        )
      );
      return { text, source: source.source, bytes, sha256 };
    } catch (error) {
      const errorMsg = source.source === 'proxy' ? 'Proxy request failed' : getErrorMessage(error);
      console.log(picocolors.red(`[Plugin List] ✗ ${errorMsg}`));
      errors.push(`${source.source} -> ${errorMsg}`);
    }
  }

  return {
    error: `Failed to download plugin list after trying ${sources.length} source(s): ${errors.join(
      '; '
    )}`,
  };
}

/**
 * 从 JSON 字符串中提取插件 URL
 *
 * @param jsonText - 插件列表 JSON
 * @returns 插件 URL 数组
 */
function extractPluginUrls(jsonText: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  // 重置正则表达式
  PLUGIN_URL_REGEX.lastIndex = 0;

  let match;
  while ((match = PLUGIN_URL_REGEX.exec(jsonText)) !== null) {
    const url = match[0];

    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }

  return urls;
}

/**
 * 将 URL 转换为插件信息
 *
 * @param url - 插件 URL
 * @returns 插件信息
 */
function urlToPluginInfo(url: string): PluginInfo {
  const urlWithoutQuery = url.split('?')[0];
  const parts = urlWithoutQuery.split('/');
  const filename = parts[parts.length - 1];
  const extension = filename.endsWith('.lpx') ? 'lpx' : 'plugin';
  let name = filename;
  if (name.endsWith('.lpx')) {
    name = name.slice(0, -4);
  } else if (name.endsWith('.plugin')) {
    name = name.slice(0, -7);
  }

  return {
    name,
    url,
    extension,
  };
}

/**
 * 获取插件列表
 *
 * @returns 插件信息数组
 */
export async function getPluginList(): Promise<PluginInfo[] | { error: string }> {
  // 下载列表
  const listResult = await downloadPluginList();

  if ('error' in listResult) {
    return listResult;
  }

  // 提取 URL
  const urls = extractPluginUrls(listResult.text);

  if (urls.length === 0) {
    return {
      error: 'No plugin URLs found in list',
    };
  }

  console.log(picocolors.green(`[Plugin List] Found ${urls.length} plugins from Script-Hub`));
  await updatePluginMetadata({ listCount: urls.length });

  // 转换为插件信息
  const plugins = urls.map(url => urlToPluginInfo(url));

  // 添加额外插件
  if (EXTRA_PLUGINS.length > 0) {
    console.log(picocolors.cyan(`[Plugin List] Adding ${EXTRA_PLUGINS.length} extra plugins`));
    plugins.push(...EXTRA_PLUGINS);
  }

  console.log(picocolors.green(`[Plugin List] Total: ${plugins.length} plugins`));

  return plugins;
}

/**
 * 按扩展名分组插件
 *
 * @param plugins - 插件列表
 * @returns 分组后的 Map
 */
function groupPluginsByExtension(
  plugins: PluginInfo[]
): Map<'plugin' | 'lpx', PluginInfo[]> {
  const groups = new Map<'plugin' | 'lpx', PluginInfo[]>([
    ['plugin', []],
    ['lpx', []],
  ]);

  for (const plugin of plugins) {
    const group = groups.get(plugin.extension)!;
    group.push(plugin);
  }

  return groups;
}

/**
 * 获取插件统计信息
 */
export interface PluginStats {
  total: number;
  byExtension: {
    plugin: number;
    lpx: number;
  };
}

export function getPluginStats(plugins: PluginInfo[]): PluginStats {
  const groups = groupPluginsByExtension(plugins);

  return {
    total: plugins.length,
    byExtension: {
      plugin: groups.get('plugin')!.length,
      lpx: groups.get('lpx')!.length,
    },
  };
}

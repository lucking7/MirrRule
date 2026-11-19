/**
 * 插件列表下载模块
 * 从 Script-Hub 获取插件列表
 */

import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import picocolors from 'picocolors';
import { UA_MIRRRULE } from '../../constants/user-agents';
import { $$fetch, defaultRequestInit } from '../../utils/network/fetch-retry';
import type { PluginInfo } from './types';
import { buildClassifiedProxyUrlCandidates } from '../../utils/network/proxy';
import type { ProxyUrlCandidate } from '../../utils/network/proxy';
import { updatePluginMetadata } from './provenance';
import { getPluginRetirementReason } from './plugin-policy';

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
      preferDirect: base === DEFAULT_PLUGIN_LIST_URL,
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
    url: 'https://raw.githubusercontent.com/fmz200/wool_scripts/main/Surge/module/blockAds.module',
    extension: 'module',
    useNativeSurge: true,
  },
];

/**
 * 下载插件列表
 *
 * @returns 插件列表 JSON 字符串
 */
export interface CatalogAttempt {
  source: 'direct' | 'proxy';
  status?: number;
  outcome: 'accepted' | 'invalid-body' | 'http-error' | 'request-error';
  bytes?: number;
  sha256?: string;
}

async function downloadPluginList(observe?: (attempt: CatalogAttempt) => void): Promise<string[] | { error: string }> {
  const errors: string[] = [];
  for (const source of resolvePluginListSources()) {
    console.log(picocolors.cyan(`[Plugin List] Downloading via ${source.source}...`));
    try {
      const response = await $$fetch(source.url, {
        ...defaultRequestInit, headers: { 'User-Agent': UA_MIRRRULE, Accept: 'application/json' },
      });
      if (!response.ok) {
        observe?.({ source: source.source, status: response.status, outcome: 'http-error' });
        errors.push(`${source.source} -> HTTP ${response.status}`);
        continue;
      }
      const text = await response.text();
      let urls: string[] = [];
      try {
        urls = extractPluginUrls(text);
      } catch {
        // A response without a usable catalog must still try the remaining candidates.
      }
      const sha256 = createHash('sha256').update(text).digest('hex');
      const bytes = Buffer.byteLength(text);
      observe?.({ source: source.source, status: response.status, bytes, sha256, outcome: urls.length ? 'accepted' : 'invalid-body' });
      if (urls.length) {
        console.log(picocolors.green(`[Plugin List] ✓ asset=plugin-list source=${source.source} bytes=${bytes} sha256=${sha256}`));
        return urls;
      }
      errors.push(`${source.source} -> Invalid catalog`);
    } catch (error) {
      const status = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : undefined;
      observe?.({ source: source.source, status, outcome: status === undefined ? 'request-error' : 'http-error' });
      errors.push(`${source.source} -> ${status === undefined ? 'Request failed' : `HTTP ${status}`}`);
    }
  }
  return { error: `Failed to download plugin list: ${errors.join('; ')}` };
}

/**
 * 从 JSON 字符串中提取插件 URL
 *
 * @param jsonText - 插件列表 JSON
 * @returns 插件 URL 数组
 */
export function extractPluginUrls(jsonText: string): string[] {
  const urls = new Set<string>();
  const visited = new Set<string>();

  function visitLink(value: string): void {
    const candidate = value.trim();
    if (!candidate || visited.has(candidate)) return;
    visited.add(candidate);

    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      return;
    }
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      if (/\.(?:plugin|lpx)$/i.test(parsed.pathname) && !parsed.username && !parsed.password) {
        urls.add(candidate);
      }
      return;
    }
    if (parsed.protocol === 'loon:') {
      for (const link of parsed.searchParams.values()) visitLink(link);
      for (const part of parsed.pathname.split('/')) {
        try {
          visitLink(decodeURIComponent(part));
        } catch {
          // Malformed installation links do not identify a usable plugin.
        }
      }
    }
  }

  function visit(node: unknown): void {
    if (typeof node === 'string') {
      visitLink(node);
    } else if (node !== null && typeof node === 'object') {
      for (const value of Object.values(node)) visit(value);
    }
  }

  visit(JSON.parse(jsonText));
  return Array.from(urls);
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
export async function getPluginList(observe?: (attempt: CatalogAttempt) => void): Promise<PluginInfo[] | { error: string }> {
  const urls = await downloadPluginList(observe);
  if (!Array.isArray(urls)) return urls;

  console.log(picocolors.green(`[Plugin List] Found ${urls.length} plugins in the catalog`));
  await updatePluginMetadata({ listCount: urls.length });

  // 转换为插件信息
  const plugins: PluginInfo[] = [];
  for (const url of urls) {
    const plugin = urlToPluginInfo(url);
    const retirementReason = getPluginRetirementReason(plugin);
    if (retirementReason) {
      console.log(picocolors.gray(`[Plugin List] Retired ${plugin.name}: ${retirementReason}`));
    } else {
      plugins.push(plugin);
    }
  }

  // 添加额外插件
  if (EXTRA_PLUGINS.length > 0) {
    console.log(picocolors.cyan(`[Plugin List] Adding ${EXTRA_PLUGINS.length} extra plugins`));
    plugins.push(...EXTRA_PLUGINS);
  }

  console.log(picocolors.green(`[Plugin List] Total: ${plugins.length} plugins`));

  return plugins;
}

/**
 * 获取插件统计信息
 */
export interface PluginStats {
  total: number;
  byExtension: {
    plugin: number;
    lpx: number;
    module: number;
  };
}

export function getPluginStats(plugins: PluginInfo[]): PluginStats {
  let pluginCount = 0;
  let lpxCount = 0;
  let moduleCount = 0;

  for (const plugin of plugins) {
    switch (plugin.extension) {
      case 'plugin':
        pluginCount++;
        break;
      case 'lpx':
        lpxCount++;
        break;
      case 'module':
        moduleCount++;
        break;
      default:
        throw new TypeError(`Unsupported plugin extension: ${plugin.extension}`);
    }
  }

  return {
    total: plugins.length,
    byExtension: {
      plugin: pluginCount,
      lpx: lpxCount,
      module: moduleCount,
    },
  };
}

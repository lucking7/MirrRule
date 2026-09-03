/**
 * 本地插件转换器 - 集成 /converter 目录的转换逻辑
 * 用于当 Script-Hub 服务不可用时的备用方案
 */

import picocolors from 'picocolors';
import { getErrorMessage } from '../../lib/misc';
import { LocalPluginConverter } from './loon-to-surge-converter';
import { getPluginContent } from './plugin-mirror';
import { identifyPluginSource } from './plugin-identity';
import type { PluginConversionResult, PluginInfo } from './types';

let loadPluginContent: typeof getPluginContent = getPluginContent;

/** Override plugin content acquisition for deterministic local conversion. */
export function setLocalConverterContentLoader(loader: typeof getPluginContent | null): void {
  loadPluginContent = loader ?? getPluginContent;
}

/**
 * 本地转换结果
 */
export type LocalConversionResult = PluginConversionResult;

/**
 * 下载并本地转换插件
 * 使用镜像系统缓存插件文件
 */
async function convertPluginLocally(
  plugin: PluginInfo,
  forceUpdate = false
): Promise<LocalConversionResult> {
  console.log(picocolors.gray(`  [Local] Converting ${plugin.name}...`));
  const identity = identifyPluginSource(plugin);

  try {
    // 获取插件内容（优先使用镜像）
    const contentResult = await loadPluginContent(plugin, forceUpdate);

    if (!contentResult.success || !contentResult.content) {
      return {
        pluginName: plugin.name,
        ...identity,
        content: { error: contentResult.error || 'Failed to get plugin content' },
      };
    }

    const loonContent = contentResult.content;

    // 本地转换（使用 async 版本）
    const converter = new LocalPluginConverter();
    const surgeContent = await converter.convert(loonContent);

    console.log(picocolors.green(`  [Local] ✓ ${plugin.name} converted successfully`));

    return {
      pluginName: plugin.name,
      ...identity,
      content: surgeContent,
    };
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    console.log(picocolors.red(`  [Local] ✗ ${plugin.name}: ${errorMsg}`));
    return {
      pluginName: plugin.name,
      ...identity,
      content: { error: errorMsg },
    };
  }
}

/**
 * 批量本地转换插件
 */
export async function convertPluginsLocallyBatch(
  plugins: PluginInfo[],
  forceUpdate = false
): Promise<LocalConversionResult[]> {
  console.log(picocolors.cyan(`[Local Converter] Converting ${plugins.length} plugins locally...`));

  const results: LocalConversionResult[] = [];

  for (const plugin of plugins) {
    const result = await convertPluginLocally(plugin, forceUpdate);
    results.push(result);
  }

  const successCount = results.filter(r => typeof r.content === 'string').length;
  console.log(
    picocolors.green(`[Local Converter] Converted ${successCount}/${plugins.length} plugins`)
  );

  return results;
}

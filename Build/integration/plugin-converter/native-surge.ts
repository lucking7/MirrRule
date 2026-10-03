import { getPluginContent } from './plugin-mirror';
import { identifyPluginSource } from './plugin-identity';
import { validateScriptPreservation } from './script-extractor';
import type { PluginInfo, PluginConversionResult } from './types';

/** Preserve native upstream sections, then use the same dependency publication checks. */
export async function loadNativeSurgeModule(
  plugin: PluginInfo,
  loadContent: typeof getPluginContent = getPluginContent
): Promise<PluginConversionResult> {
  const result = await loadContent(plugin, true);
  const base = { pluginName: plugin.name, ...identifyPluginSource(plugin) };
  if (!result.success || !result.content || result.degraded) {
    return { ...base, content: { error: `Native Surge download failed: ${result.error ?? 'fresh content unavailable'}` } };
  }
  const error = validateScriptPreservation(result.content, result.content);
  return { ...base, content: error ? { error } : result.content };
}

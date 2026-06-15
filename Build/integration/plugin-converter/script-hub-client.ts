/**
 * Script-Hub 客户端
 * 调用 Script-Hub API 进行插件转换
 */

import process from 'node:process';
import { $$fetch, defaultRequestInit } from '../../utils/network/fetch-retry';
import picocolors from 'picocolors';
import { UA_SURGE_MAC } from '../../constants/user-agents';
import { applyProxyIfNeeded, shouldUseProxy } from '../../utils/network/proxy';
import type { PluginInfo, ConversionConfig } from './types.ts';
import { getErrorMessage } from '../../lib/misc';

/**
 * Script-Hub API 配置
 *
 * 本地开发：使用 localhost
 * GitHub Actions：使用 script.hub（通过 services 自动启动）
 */
const SCRIPT_HUB_CONFIG = {
  host: process.env.CI ? 'script.hub' : 'localhost',
  port: 9101,
  get baseUrl() {
    return `http://${this.host}:${this.port}`;
  },
} as const;

/**
 * URL 编码辅助函数
 */
function encodeURIComponentSafe(str: string): string {
  return encodeURIComponent(str);
}

/**
 * 构建转换 URL (从远程 URL，支持代理)
 *
 * @param sourceUrl - 插件源 URL
 * @param pluginName - 插件名称
 * @param config - 转换配置
 * @returns 转换 API URL
 */
function buildConversionUrlFromRemote(
  sourceUrl: string,
  pluginName: string,
  config: ConversionConfig
): string {
  const encodedName = encodeURIComponentSafe(pluginName);
  const encodedCategory = config.category
    ? encodeURIComponentSafe(config.category)
    : encodeURIComponentSafe('🚫 AD Block');

  const finalUrl = applyProxyIfNeeded(sourceUrl);
  const baseUrl = `${SCRIPT_HUB_CONFIG.baseUrl}/file/_start_/${finalUrl}/_end_/${encodedName}.sgmodule`;

  // 添加 User-Agent 到请求头参数
  const headerValue = encodeURIComponentSafe(`User-Agent: ${UA_SURGE_MAC}`);
  const query = `type=${config.sourceType}&target=${config.targetType}&category=${encodedCategory}&headers=${headerValue}`;

  return `${baseUrl}?${query}`;
}

/**
 * 批量转换插件 (从远程 URL，推荐使用)
 *
 * @param plugins - 插件信息数组
 * @param config - 转换配置
 * @param concurrency - 并发数
 * @returns 转换结果数组
 */
export async function convertPluginsBatchFromRemote(
  plugins: PluginInfo[],
  config?: ConversionConfig,
  concurrency = 5
): Promise<Array<{ pluginName: string; content: string | { error: string } }>> {
  const results: Array<{ pluginName: string; content: string | { error: string } }> = [];

  if (plugins.length === 0) {
    console.log(picocolors.yellow('\n[Convert] No plugins to convert'));
    return results;
  }

  console.log(
    picocolors.cyan(`\n[Convert] Starting batch conversion (concurrency: ${concurrency})...\n`)
  );

  for (let i = 0; i < plugins.length; i += concurrency) {
    const batch = plugins.slice(i, i + concurrency);
    const batchNumber = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(plugins.length / concurrency);

    console.log(
      picocolors.cyan(`[Convert] Batch ${batchNumber}/${totalBatches} (${batch.length} plugins)`)
    );

    const batchResults = await Promise.all(
      batch.map(async plugin => {
        const url = buildConversionUrlFromRemote(
          plugin.url,
          plugin.name,
          config || {
            sourceType: 'loon-plugin',
            targetType: 'surge-module',
          }
        );

        // kelee.one/rule.kelee.one 通过 PROXY_BASE 加速，并显式传入 Loon/Surge UA。
        const usesProxy = shouldUseProxy(plugin.url);
        const proxyIndicator = usesProxy ? picocolors.yellow(' [PROXY+UA]') : '';

        console.log(picocolors.gray(`[Convert] ${plugin.name}${proxyIndicator}`));
        if (usesProxy) {
          console.log(picocolors.yellow(`  Source: ${plugin.url}`));
          console.log(picocolors.yellow(`  Via proxy: ${applyProxyIfNeeded(plugin.url)}`));
          console.log(picocolors.yellow(`  Headers: User-Agent: ${UA_SURGE_MAC}`));
        }
        console.log(picocolors.gray(`  URL: ${url}`));

        let lastError = '';
        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            if (attempt > 1) {
              const retryDelay = 1000 + Math.random() * 2000;
              console.log(
                picocolors.yellow(
                  `[Convert] Retry ${attempt}/${maxRetries} for ${
                    plugin.name
                  } (waiting ${Math.round(retryDelay / 1000)}s)...`
                )
              );
              await new Promise(resolve => {
                setTimeout(resolve, retryDelay);
              });
            }

            const response = await $$fetch(url, {
              ...defaultRequestInit,
              headers: {
                'User-Agent': UA_SURGE_MAC,
                Accept: '*/*',
              },
              signal: AbortSignal.timeout(60000),
            });

            if (!response.ok) {
              const errorText = await response.text().catch(() => 'Unable to read response body');
              lastError = `HTTP ${response.status}: ${response.statusText}`;

              console.log(picocolors.red(`[Convert] HTTP ${response.status} for ${plugin.name}`));
              if (errorText && errorText.length < 500) {
                console.log(picocolors.gray(`  Response: ${errorText.slice(0, 200)}`));
              }

              if (response.status === 500) {
                console.log(picocolors.yellow('  Script-Hub internal error, will retry'));
                continue;
              }

              if (response.status >= 400 && response.status < 500) {
                return { pluginName: plugin.name, content: { error: lastError } };
              }

              continue;
            }

            const content = await response.text();

            if (!content || content.trim().length === 0) {
              lastError = 'Empty response from Script-Hub';
              console.log(picocolors.red(`[Convert] Empty response for ${plugin.name}`));
              continue;
            }

            if (content.includes('Error:') || content.includes('error:')) {
              lastError = `Script-Hub error: ${content.slice(0, 200)}`;
              console.log(picocolors.red(`[Convert] Script-Hub returned error for ${plugin.name}`));
              continue;
            }

            if (!content.includes('#!name=') && !content.includes('[Script]')) {
              lastError = 'Invalid sgmodule format';
              console.log(picocolors.red(`[Convert] Invalid format for ${plugin.name}`));
              return { pluginName: plugin.name, content: { error: lastError } };
            }

            console.log(
              picocolors.green(
                `[Convert] ✓ ${plugin.name}${attempt > 1 ? ` (attempt ${attempt})` : ''}`
              )
            );
            return { pluginName: plugin.name, content };
          } catch (error) {
            const errorMsg = getErrorMessage(error);
            lastError = errorMsg;
            console.log(
              picocolors.red(
                `[Convert] ✗ ${plugin.name} (attempt ${attempt}/${maxRetries}): ${errorMsg}`
              )
            );

            if (attempt === maxRetries) {
              return { pluginName: plugin.name, content: { error: lastError } };
            }
          }
        }

        return { pluginName: plugin.name, content: { error: lastError || 'Unknown error' } };
      })
    );

    results.push(...batchResults);

    const batchSuccess = batchResults.filter(r => typeof r.content === 'string').length;
    const batchFailed = batchResults.filter(r => typeof r.content === 'object').length;
    console.log(picocolors.gray(`  ✓ ${batchSuccess} 成功, ✗ ${batchFailed} 失败\n`));
  }

  const totalSuccess = results.filter(r => typeof r.content === 'string').length;
  const totalFailed = results.filter(r => typeof r.content === 'object').length;

  console.log(
    picocolors.green(`\n[Convert] Completed: ${totalSuccess}/${plugins.length} plugins converted`)
  );
  if (totalFailed > 0) {
    console.log(picocolors.red(`[Convert] Failed: ${totalFailed} plugins`));
  }

  return results;
}

/**
 * 检查 Script-Hub 服务是否可用
 *
 * @returns 是否可用
 */
async function checkScriptHubAvailability(): Promise<boolean> {
  try {
    const response = await fetch(`${SCRIPT_HUB_CONFIG.baseUrl}/`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 等待 Script-Hub 服务就绪
 *
 * @param maxRetries - 最大重试次数
 * @param retryDelay - 重试延迟（毫秒）
 * @returns 是否就绪
 */
export async function waitForScriptHub(maxRetries = 20, retryDelay = 5000): Promise<boolean> {
  console.log(picocolors.cyan('[Script-Hub] Waiting for service to be ready...'));

  for (let i = 0; i < maxRetries; i++) {
    const isAvailable = await checkScriptHubAvailability();

    if (isAvailable) {
      console.log(picocolors.green('[Script-Hub] ✓ Service is ready'));
      return true;
    }

    console.log(picocolors.gray(`[Script-Hub] Retry ${i + 1}/${maxRetries}...`));
    await new Promise<void>(resolve => {
      setTimeout(resolve, retryDelay);
    });
  }

  console.log(picocolors.red('[Script-Hub] ✗ Service not available'));
  return false;
}

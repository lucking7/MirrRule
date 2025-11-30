/**
 * Script-Hub 客户端
 * 调用 Script-Hub API 进行插件转换
 */

import process from 'node:process';
import { $$fetch, defaultRequestInit } from '../../utils/network/fetch-retry';
import picocolors from 'picocolors';
import type { PluginInfo, ConversionConfig } from './types';
import type { DownloadResult } from './plugin-downloader';
import { applyProxyIfNeeded, shouldUseProxy } from './proxy-utils';

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
 * 构建转换 URL (从远程 URL)
 *
 * @param plugin - 插件信息
 * @param config - 转换配置
 * @returns 转换 API URL
 * @deprecated 使用 buildConversionUrlFromLocal 代替，避免 Script-Hub 访问外网
 */
export function buildConversionUrl(plugin: PluginInfo, config: ConversionConfig): string {
  const encodedName = encodeURIComponentSafe(plugin.name);
  const encodedCategory = config.category
    ? encodeURIComponentSafe(config.category)
    : encodeURIComponentSafe('🚫 AD Block');

  const baseUrl = `${SCRIPT_HUB_CONFIG.baseUrl}/file/_start_/${plugin.url}/_end_/${encodedName}.sgmodule`;
  const query = `type=${config.sourceType}&target=${config.targetType}&category=${encodedCategory}`;

  return `${baseUrl}?${query}`;
}

/**
 * 构建转换 URL (从远程 URL，支持代理)
 *
 * 优势：
 * 1. Script-Hub 直接从源站下载，避免本地文件路径问题
 * 2. 支持代理访问 kelee.one 等受保护的域名
 * 3. 完全参考 Mirrored-main 项目的成功实践
 *
 * @param sourceUrl - 插件源 URL
 * @param pluginName - 插件名称
 * @param config - 转换配置
 * @returns 转换 API URL
 */
export function buildConversionUrlFromRemote(
  sourceUrl: string,
  pluginName: string,
  config: ConversionConfig
): string {
  const encodedName = encodeURIComponentSafe(pluginName);
  const encodedCategory = config.category
    ? encodeURIComponentSafe(config.category)
    : encodeURIComponentSafe('🚫 AD Block');

  // 应用代理（如果需要）- 参考 Mirrored-main 的实现
  const finalUrl = applyProxyIfNeeded(sourceUrl);

  // 构建 Script-Hub URL（参考 Mirrored-main 的实现）
  const baseUrl = `${SCRIPT_HUB_CONFIG.baseUrl}/file/_start_/${finalUrl}/_end_/${encodedName}.sgmodule`;

  // 添加 User-Agent 到请求头参数
  const headerValue = encodeURIComponentSafe('User-Agent: Surge Mac/2985');
  const query = `type=${config.sourceType}&target=${config.targetType}&category=${encodedCategory}&headers=${headerValue}`;

  return `${baseUrl}?${query}`;
}

/**
 * 构建转换 URL (从本地文件)
 *
 * @deprecated 使用 buildConversionUrlFromRemote 代替，避免本地文件路径问题
 *
 * @param localPath - 本地文件路径
 * @param pluginName - 插件名称
 * @param config - 转换配置
 * @returns 转换 API URL
 */
export function buildConversionUrlFromLocal(
  localPath: string,
  pluginName: string,
  config: ConversionConfig
): string {
  const encodedName = encodeURIComponentSafe(pluginName);
  const encodedCategory = config.category
    ? encodeURIComponentSafe(config.category)
    : encodeURIComponentSafe('🚫 AD Block');

  // 使用 file:// 协议指向本地文件
  // Script-Hub 支持从本地文件系统读取文件
  const fileUrl = `file://${localPath}`;
  const baseUrl = `${SCRIPT_HUB_CONFIG.baseUrl}/file/_start_/${fileUrl}/_end_/${encodedName}.sgmodule`;
  const query = `type=${config.sourceType}&target=${config.targetType}&category=${encodedCategory}`;

  return `${baseUrl}?${query}`;
}

/**
 * 调用 Script-Hub API 转换插件 (从远程 URL)
 *
 * @param plugin - 插件信息
 * @param config - 转换配置
 * @returns sgmodule 内容或错误
 * @deprecated 使用 convertPluginFromLocal 代替，避免 Script-Hub 访问外网
 */
export async function convertPlugin(
  plugin: PluginInfo,
  config?: ConversionConfig
): Promise<string | { error: string }> {
  const effectiveConfig: ConversionConfig = config ?? {
    sourceType: 'loon-plugin',
    targetType: 'surge-module',
  };

  const url = buildConversionUrl(plugin, effectiveConfig);

  console.log(picocolors.gray(`[Convert] ${plugin.name}`));
  console.log(picocolors.gray(`  URL: ${url}`));

  try {
    const response = await $$fetch(url, {
      ...defaultRequestInit,
      headers: {
        'User-Agent': 'Surge Mac/2985',
        Accept: '*/*',
      },
      // 使用 DNS 解析到本地（如果 Script-Hub 容器在本地运行）
      // 注意：fetch API 不支持 --resolve 参数，需要确保 DNS 正确配置
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
        error: 'Empty response from Script-Hub',
      };
    }

    // 基本验证：检查是否包含 sgmodule 标记
    if (!content.includes('#!name=') && !content.includes('[Script]')) {
      return {
        error: 'Invalid sgmodule format',
      };
    }

    console.log(picocolors.green(`[Convert] ✓ ${plugin.name}`));
    return content;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log(picocolors.red(`[Convert] ✗ ${plugin.name}: ${errorMsg}`));
    return { error: errorMsg };
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
 * 调用 Script-Hub API 转换插件 (从本地文件，带重试机制)
 *
 * 优势：
 * 1. 避免 Script-Hub 容器访问外网的网络问题
 * 2. 更快（本地文件访问）
 * 3. 更可靠（不依赖外部网络）
 *
 * @param localPath - 本地文件路径
 * @param pluginName - 插件名称
 * @param config - 转换配置
 * @param maxRetries - 最大重试次数
 * @returns sgmodule 内容或错误
 */
export async function convertPluginFromLocal(
  localPath: string,
  pluginName: string,
  config?: ConversionConfig,
  maxRetries = 3
): Promise<string | { error: string }> {
  const effectiveConfig: ConversionConfig = config ?? {
    sourceType: 'loon-plugin',
    targetType: 'surge-module',
  };

  const url = buildConversionUrlFromLocal(localPath, pluginName, effectiveConfig);

  console.log(picocolors.gray(`[Convert] ${pluginName} (from local)`));
  console.log(picocolors.gray(`  Local: ${localPath}`));
  console.log(picocolors.gray(`  URL: ${url}`));

  let lastError = '';

  // 重试循环
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 如果是重试，添加延迟（1-3秒随机）
      if (attempt > 1) {
        const retryDelay = 1000 + Math.random() * 2000; // 1-3秒
        console.log(
          picocolors.yellow(
            `[Convert] Retry ${attempt}/${maxRetries} for ${pluginName} (waiting ${Math.round(
              retryDelay / 1000
            )}s)...`
          )
        );
        await delay(retryDelay);
      }

      const response = await $$fetch(url, {
        ...defaultRequestInit,
        headers: {
          'User-Agent': 'Surge Mac/2985',
          Accept: '*/*',
        },
        // 添加超时设置（60秒，转换可能需要更长时间）
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        // 尝试读取错误响应内容
        const errorText = await response.text().catch(() => 'Unable to read response body');
        lastError = `HTTP ${response.status}: ${response.statusText}`;

        // 记录详细错误信息
        console.log(picocolors.red(`[Convert] HTTP ${response.status} for ${pluginName}`));
        console.log(picocolors.gray(`  Status: ${response.status} ${response.statusText}`));

        // 打印响应内容（如果有）
        if (errorText && errorText.trim().length > 0) {
          console.log(picocolors.gray('  Response body (first 500 chars):'));
          console.log(picocolors.gray(`  ${errorText.slice(0, 500)}`));

          // 检查是否是 HTML 错误页面
          if (errorText.includes('<!DOCTYPE') || errorText.includes('<html')) {
            console.log(
              picocolors.yellow('  ⚠\uFE0F  Received HTML error page instead of JSON/text')
            );
          }
        }

        // 对于 HTTP 500，继续重试
        if (response.status === 500) {
          console.log(
            picocolors.yellow(`  Script-Hub internal error, will retry (${attempt}/${maxRetries})`)
          );
          continue;
        }

        // 对于其他 4xx 错误，不重试
        if (response.status >= 400 && response.status < 500) {
          return { error: lastError };
        }

        // 对于其他 5xx 错误，继续重试
        continue;
      }

      const content = await response.text();

      // 验证内容
      if (!content || content.trim().length === 0) {
        lastError = 'Empty response from Script-Hub';
        console.log(picocolors.red(`[Convert] Empty response for ${pluginName}`));
        continue;
      }

      // 检查是否返回了错误信息（某些情况下 Script-Hub 返回 200 但内容是错误）
      if (content.includes('Error:') || content.includes('error:')) {
        lastError = `Script-Hub error: ${content.slice(0, 200)}`;
        console.log(picocolors.red(`[Convert] Script-Hub returned error for ${pluginName}`));
        console.log(picocolors.gray(`  Error: ${content.slice(0, 200)}`));
        continue;
      }

      // 基本验证：检查是否包含 sgmodule 标记
      if (!content.includes('#!name=') && !content.includes('[Script]')) {
        lastError = 'Invalid sgmodule format';
        console.log(picocolors.red(`[Convert] Invalid format for ${pluginName}`));
        console.log(picocolors.gray(`  Content preview: ${content.slice(0, 200)}`));
        // 格式错误不重试
        return { error: lastError };
      }

      console.log(
        picocolors.green(`[Convert] ✓ ${pluginName}${attempt > 1 ? ` (attempt ${attempt})` : ''}`)
      );
      return content;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      lastError = errorMsg;

      console.log(
        picocolors.red(`[Convert] ✗ ${pluginName} (attempt ${attempt}/${maxRetries}): ${errorMsg}`)
      );

      // 如果是超时错误，记录详细信息
      if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
        console.log(picocolors.yellow('  Timeout after 60s'));
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
 * 批量转换插件 (从远程 URL)
 *
 * @param plugins - 插件列表
 * @param config - 转换配置
 * @param concurrency - 并发数
 * @returns 转换结果数组
 * @deprecated 使用 convertPluginsBatchFromLocal 代替，避免 Script-Hub 访问外网
 */
export async function convertPluginsBatch(
  plugins: PluginInfo[],
  config?: ConversionConfig,
  concurrency = 5
): Promise<Array<{ plugin: PluginInfo; content: string | { error: string } }>> {
  const results: Array<{ plugin: PluginInfo; content: string | { error: string } }> = [];

  // 分批处理
  for (let i = 0; i < plugins.length; i += concurrency) {
    const batch = plugins.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async plugin => ({
        plugin,
        content: await convertPlugin(plugin, config),
      }))
    );

    results.push(...batchResults);
  }

  return results;
}

/**
 * 批量转换插件 (从远程 URL，推荐使用)
 *
 * 优势：
 * 1. 避免本地文件路径问题（GitHub Actions 环境）
 * 2. 支持代理访问 kelee.one 等域名
 * 3. 参考 Mirrored-main 项目的成功实践
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

  // 分批处理
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

        // 检查是否使用代理
        const usesProxy = shouldUseProxy(plugin.url);
        const proxyIndicator = usesProxy ? picocolors.yellow(' [PROXY]') : '';

        console.log(picocolors.gray(`[Convert] ${plugin.name}${proxyIndicator}`));
        if (usesProxy) {
          console.log(picocolors.yellow(`  Source: ${plugin.url}`));
          console.log(picocolors.yellow(`  Via proxy: ${applyProxyIfNeeded(plugin.url)}`));
        }
        console.log(picocolors.gray(`  URL: ${url}`));

        let lastError = '';
        const maxRetries = 3;

        // 重试循环
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
                'User-Agent': 'Surge Mac/2985',
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
            const errorMsg = error instanceof Error ? error.message : String(error);
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

    // 统计当前批次结果
    const batchSuccess = batchResults.filter(r => typeof r.content === 'string').length;
    const batchFailed = batchResults.filter(r => typeof r.content === 'object').length;
    console.log(picocolors.gray(`  ✓ ${batchSuccess} 成功, ✗ ${batchFailed} 失败\n`));
  }

  // 总体统计
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
 * 批量转换插件 (从本地文件)
 *
 * @deprecated 使用 convertPluginsBatchFromRemote 代替，避免本地文件路径问题
 *
 * @param downloadResults - 下载结果数组（只处理成功下载的插件）
 * @param config - 转换配置
 * @param concurrency - 并发数
 * @returns 转换结果数组
 */
export async function convertPluginsBatchFromLocal(
  downloadResults: DownloadResult[],
  config?: ConversionConfig,
  concurrency = 5
): Promise<Array<{ pluginName: string; content: string | { error: string } }>> {
  const results: Array<{ pluginName: string; content: string | { error: string } }> = [];

  // 内部过滤成功的下载
  const successfulDownloads = downloadResults.filter(r => r.localPath);

  if (successfulDownloads.length === 0) {
    console.log(picocolors.yellow('\n[Convert] No successfully downloaded plugins to convert'));
    return results;
  }

  console.log(
    picocolors.cyan(`\n[Convert] Starting batch conversion (concurrency: ${concurrency})...\n`)
  );

  // 分批处理
  for (let i = 0; i < successfulDownloads.length; i += concurrency) {
    const batch = successfulDownloads.slice(i, i + concurrency);
    const batchNumber = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(successfulDownloads.length / concurrency);

    console.log(
      picocolors.cyan(`[Convert] Batch ${batchNumber}/${totalBatches} (${batch.length} plugins)`)
    );

    const batchResults = await Promise.all(
      batch.map(async result => ({
        pluginName: result.plugin.name,
        content: await convertPluginFromLocal(result.localPath!, result.plugin.name, config),
      }))
    );

    results.push(...batchResults);

    // 统计当前批次结果
    const batchSuccess = batchResults.filter(r => typeof r.content === 'string').length;
    const batchFailed = batchResults.filter(r => typeof r.content === 'object').length;
    console.log(picocolors.gray(`  ✓ ${batchSuccess} 成功, ✗ ${batchFailed} 失败\n`));
  }

  // 总体统计
  const totalSuccess = results.filter(r => typeof r.content === 'string').length;
  const totalFailed = results.filter(r => typeof r.content === 'object').length;

  console.log(
    picocolors.green(
      `\n[Convert] Completed: ${totalSuccess}/${successfulDownloads.length} plugins converted`
    )
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
export async function checkScriptHubAvailability(): Promise<boolean> {
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

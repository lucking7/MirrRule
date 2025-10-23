/**
 * Script-Hub 客户端
 * 调用 Script-Hub API 进行插件转换
 */

import { $$fetch, defaultRequestInit } from '../../utils/network/fetch-retry';
import picocolors from 'picocolors';
import type { PluginInfo, ConversionConfig } from './types';

/**
 * Script-Hub API 配置
 *
 * ✅ 修复：始终使用 localhost，因为 undici fetch 不支持 /etc/hosts
 * Docker 容器通过端口映射到 localhost:9101
 */
const SCRIPT_HUB_CONFIG = {
  host: 'localhost',
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
 * 构建转换 URL
 *
 * @param plugin - 插件信息
 * @param config - 转换配置
 * @returns 转换 API URL
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
 * 调用 Script-Hub API 转换插件
 *
 * @param plugin - 插件信息
 * @param config - 转换配置
 * @returns sgmodule 内容或错误
 */
export async function convertPlugin(
  plugin: PluginInfo,
  config: ConversionConfig = {
    sourceType: 'loon-plugin',
    targetType: 'surge-module',
  }
): Promise<string | { error: string }> {
  const url = buildConversionUrl(plugin, config);

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
      // 尝试读取错误响应体以获取更多信息
      let errorBody = '';
      try {
        errorBody = await response.text();
        // 只在 CI 环境或首次错误时显示详细信息
        if (process.env.CI || response.status >= 500) {
          console.log(picocolors.yellow(`[Convert] ⚠️  ${plugin.name} 错误详情:`));
          console.log(picocolors.gray(`  状态码: ${response.status}`));
          console.log(
            picocolors.gray(
              `  响应体: ${errorBody.substring(0, 200)}${errorBody.length > 200 ? '...' : ''}`
            )
          );
        }
      } catch (e) {
        // 忽略读取错误体的异常
      }

      return {
        error: `HTTP ${response.status}${errorBody ? `: ${errorBody.substring(0, 100)}` : ''}`,
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
 * 批量转换插件
 *
 * @param plugins - 插件列表
 * @param config - 转换配置
 * @param concurrency - 并发数
 * @returns 转换结果数组
 */
export async function convertPluginsBatch(
  plugins: PluginInfo[],
  config?: ConversionConfig,
  concurrency = 3 // 🔧 降低并发数从 5 到 3，减轻服务压力
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

    // 🔧 在批次之间添加延迟，避免过载 Script-Hub 服务
    // 在 CI 环境中使用更长的延迟
    if (i + concurrency < plugins.length) {
      const delay = process.env.CI ? 500 : 200; // CI: 500ms, 本地: 200ms
      await new Promise(resolve => setTimeout(resolve, delay));
    }
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
    await new Promise(resolve => setTimeout(resolve, retryDelay));
  }

  console.log(picocolors.red('[Script-Hub] ✗ Service not available'));
  return false;
}

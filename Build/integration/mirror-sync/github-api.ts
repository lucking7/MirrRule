/**
 * GitHub API 交互模块
 * 处理 API 重定向、空响应、404 等异常
 */

import { $$fetch, defaultRequestInit } from '../../utils/network/fetch-retry';
import type { GitHubRelease, ApiError, ApiErrorType } from './types';
import picocolors from 'picocolors';

/**
 * GitHub API 基础 URL
 */
const GITHUB_API_BASE = 'https://api.github.com';

/**
 * 创建 API 错误对象
 */
function createApiError(
  type: ApiErrorType,
  message: string,
  url: string,
  canRetry = false
): ApiError {
  return { type, message, url, canRetry };
}

/**
 * 获取 GitHub Token（从环境变量）
 */
function getGitHubToken(): string | undefined {
  return process.env.GITHUB_TOKEN;
}

/**
 * 创建 GitHub API 请求头
 */
function createHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Surge-Ruleset-Mirror/1.0'
  };

  const token = getGitHubToken();
  if (token) {
    headers.Authorization = `token ${token}`;
  }

  return headers;
}

/**
 * 获取仓库的最新 Release
 *
 * @param repo - 仓库名称，格式: "owner/repo"
 * @returns Release 信息或错误
 *
 * @example
 * ```ts
 * const result = await fetchLatestRelease('NSRingo/WeatherKit');
 * if ('error' in result) {
 *   console.error('Failed:', result.error.message);
 * } else {
 *   console.log('Release:', result.tag_name);
 * }
 * ```
 */
export async function fetchLatestRelease(
  repo: string
): Promise<GitHubRelease | { error: ApiError }> {
  const url = `${GITHUB_API_BASE}/repos/${repo}/releases/latest`;

  console.log(picocolors.cyan(`[GitHub API] Fetching release for ${repo}`));

  try {
    const response = await $$fetch(url, {
      ...defaultRequestInit,
      headers: createHeaders()
    });

    // 检查响应状态
    if (!response.ok) {
      if (response.status === 404) {
        return {
          error: createApiError(
            '404' as ApiErrorType,
            `Repository ${repo} not found or has no releases`,
            url,
            false
          )
        };
      }
      if (response.status === 403) {
        return {
          error: createApiError(
            '403' as ApiErrorType,
            'GitHub API rate limit exceeded',
            url,
            true
          )
        };
      }
      if (response.status === 301) {
        // 处理重定向
        const redirectUrl = response.headers.get('Location');
        if (redirectUrl) {
          console.log(picocolors.yellow(`[GitHub API] Following redirect to ${redirectUrl}`));
          return fetchLatestReleaseFromUrl(redirectUrl);
        }
      }

      return {
        error: createApiError(
          'UNKNOWN' as ApiErrorType,
          `HTTP ${response.status}: ${response.statusText}`,
          url,
          response.status >= 500
        )
      };
    }

    const data = await response.json() as GitHubRelease;

    // 检查响应数据
    if (!data) {
      return {
        error: createApiError(
          'NULL_RESPONSE' as ApiErrorType,
          'Response data is null',
          url,
          true
        )
      };
    }

    // 检查是否包含错误消息
    if ('message' in data) {
      const message = (data as any).message;
      if (message === 'Moved Permanently') {
        const redirectUrl = (data as any).url;
        if (redirectUrl) {
          console.log(picocolors.yellow(`[GitHub API] Following redirect to ${redirectUrl}`));
          return fetchLatestReleaseFromUrl(redirectUrl);
        }
      }

      return {
        error: createApiError(
          'UNKNOWN' as ApiErrorType,
          message,
          url,
          false
        )
      };
    }

    // 验证 assets 数组
    if (!data.assets || !Array.isArray(data.assets) || data.assets.length === 0) {
      return {
        error: createApiError(
          'EMPTY_RESPONSE' as ApiErrorType,
          'No assets found in release',
          url,
          false
        )
      };
    }

    console.log(picocolors.green(`[GitHub API] ✓ Found ${data.assets.length} assets for ${repo}`));
    return data;
  } catch (error) {
    return {
      error: createApiError(
        'NETWORK_ERROR' as ApiErrorType,
        error instanceof Error ? error.message : String(error),
        url,
        true
      )
    };
  }
}

/**
 * 从指定 URL 获取 Release 信息（用于处理重定向）
 */
async function fetchLatestReleaseFromUrl(
  url: string
): Promise<GitHubRelease | { error: ApiError }> {
  try {
    const response = await $$fetch(url, {
      ...defaultRequestInit,
      headers: createHeaders()
    });

    if (!response.ok) {
      return {
        error: createApiError(
          'UNKNOWN' as ApiErrorType,
          `HTTP ${response.status}: ${response.statusText}`,
          url,
          response.status >= 500
        )
      };
    }

    const data = await response.json() as GitHubRelease;

    if (!data?.assets || data.assets.length === 0) {
      return {
        error: createApiError(
          'EMPTY_RESPONSE' as ApiErrorType,
          'No assets found in redirected release',
          url,
          false
        )
      };
    }

    return data;
  } catch (error) {
    return {
      error: createApiError(
        'NETWORK_ERROR' as ApiErrorType,
        error instanceof Error ? error.message : String(error),
        url,
        true
      )
    };
  }
}

/**
 * 下载 Release Asset
 *
 * @param assetUrl - Asset 的 API URL
 * @returns 文件内容的 Buffer
 */
export async function downloadAsset(assetUrl: string): Promise<Buffer | { error: ApiError }> {
  try {
    const response = await $$fetch(assetUrl, {
      ...defaultRequestInit,
      headers: {
        ...createHeaders(),
        Accept: 'application/octet-stream'
      }
    });

    if (!response.ok) {
      return {
        error: createApiError(
          'UNKNOWN' as ApiErrorType,
          `Failed to download asset: HTTP ${response.status}`,
          assetUrl,
          response.status >= 500
        )
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length === 0) {
      return {
        error: createApiError(
          'EMPTY_RESPONSE' as ApiErrorType,
          'Downloaded file is empty',
          assetUrl,
          false
        )
      };
    }

    return buffer;
  } catch (error) {
    return {
      error: createApiError(
        'NETWORK_ERROR' as ApiErrorType,
        error instanceof Error ? error.message : String(error),
        assetUrl,
        true
      )
    };
  }
}

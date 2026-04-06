/**
 * GitHub API 交互模块
 * 处理 API 重定向、空响应、404 等异常
 */

import process from 'node:process';
import { Buffer } from 'node:buffer';
import { $$fetch, defaultRequestInit } from '../../utils/network/fetch-retry';
import { UA_MIRROR } from '../../constants/user-agents';
import type { GitHubRelease, ApiError } from './types';
import { ApiErrorType as ApiErrorTypes } from './types';
import picocolors from 'picocolors';
import { getErrorMessage } from '../../utils/cli/logger';
import { createApiError, mapGitHubApiError } from './api-error-utils';

/**
 * GitHub API 基础 URL
 */
const GITHUB_API_BASE = 'https://api.github.com';

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
    'User-Agent': UA_MIRROR,
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
      headers: createHeaders(),
    });

    const data = (await response.json()) as GitHubRelease;

    if (!data) {
      return {
        error: createApiError(ApiErrorTypes.NULL_RESPONSE, 'Response data is null', url, true),
      };
    }

    if ('message' in data) {
      const message = (data as any).message;
      if (message === 'Moved Permanently') {
        const redirectUrl = (data as any).url;
        if (redirectUrl) {
          console.log(picocolors.yellow(`[GitHub API] Following redirect to ${redirectUrl}`));
          return await fetchLatestReleaseFromUrl(redirectUrl);
        }
      }

      return {
        error: createApiError(ApiErrorTypes.UNKNOWN, message, url, false),
      };
    }

    if (!data.assets || !Array.isArray(data.assets) || data.assets.length === 0) {
      return {
        error: createApiError(
          ApiErrorTypes.EMPTY_RESPONSE,
          'No assets found in release',
          url,
          false
        ),
      };
    }

    console.log(picocolors.green(`[GitHub API] ✓ Found ${data.assets.length} assets for ${repo}`));
    return data;
  } catch (error) {
    return {
      error: mapGitHubApiError(url, error, {
        notFoundMessage: `Repository ${repo} not found or has no releases`,
      }),
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
      headers: createHeaders(),
    });

    const data = (await response.json()) as GitHubRelease;

    if (!data?.assets || data.assets.length === 0) {
      return {
        error: createApiError(
          ApiErrorTypes.EMPTY_RESPONSE,
          'No assets found in redirected release',
          url,
          false
        ),
      };
    }

    return data;
  } catch (error) {
    return {
      error: mapGitHubApiError(url, error, {
        emptyResponseMessage: 'No assets found in redirected release',
      }),
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
        Accept: 'application/octet-stream',
      },
    });

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length === 0) {
      return {
        error: createApiError(
          ApiErrorTypes.EMPTY_RESPONSE,
          'Downloaded file is empty',
          assetUrl,
          false
        ),
      };
    }

    return buffer;
  } catch (error) {
    return {
      error: mapGitHubApiError(assetUrl, error),
    };
  }
}

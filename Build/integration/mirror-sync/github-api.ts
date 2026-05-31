import { Buffer } from 'node:buffer';
import process from 'node:process';

import { $$fetch, defaultRequestInit } from '../../utils/network/fetch-retry';
import { UA_MIRROR } from '../../constants/user-agents';
import picocolors from 'picocolors';
import { getErrorMessage } from '../../lib/misc';

export interface GitHubAsset {
  name: string,
  url: string,
  size: number,
  browser_download_url: string
}

export interface GitHubRelease {
  tag_name: string,
  name: string,
  assets: GitHubAsset[],
  html_url: string
}

enum ApiErrorType {
  EMPTY_RESPONSE = 'EMPTY_RESPONSE',
  NULL_RESPONSE = 'NULL_RESPONSE',
  NOT_FOUND = '404',
  MOVED_PERMANENTLY = '301',
  RATE_LIMIT = '403',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN = 'UNKNOWN'
}

export interface ApiError {
  type: ApiErrorType,
  message: string,
  url: string,
  canRetry: boolean
}

interface ApiErrorMappingOptions {
  notFoundMessage?: string;
  emptyResponseMessage?: string;
}

function createApiError(
  type: ApiErrorType,
  message: string,
  url: string,
  canRetry: boolean
): ApiError {
  return { type, message, url, canRetry };
}

function getStatusCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const statusLikeError = error as { statusCode?: number; status?: number };
  if (typeof statusLikeError.statusCode === 'number') {
    return statusLikeError.statusCode;
  }

  if (typeof statusLikeError.status === 'number') {
    return statusLikeError.status;
  }

  return null;
}

export function mapGitHubApiError(
  url: string,
  error: unknown,
  options: ApiErrorMappingOptions = {}
): ApiError {
  const statusCode = getStatusCode(error);
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message
      : String(error);

  if (statusCode === 404) {
    return createApiError(
      ApiErrorType.NOT_FOUND,
      options.notFoundMessage ?? 'Repository not found or has no releases',
      url,
      false
    );
  }

  if (statusCode === 403) {
    return createApiError(
      ApiErrorType.RATE_LIMIT,
      'GitHub API rate limit exceeded',
      url,
      true
    );
  }

  if (statusCode === 301) {
    return createApiError(
      ApiErrorType.MOVED_PERMANENTLY,
      'GitHub API endpoint moved permanently',
      url,
      true
    );
  }

  if (statusCode !== null) {
    return createApiError(
      ApiErrorType.UNKNOWN,
      `HTTP ${statusCode}: ${message}`,
      url,
      statusCode >= 500
    );
  }

  return createApiError(ApiErrorType.NETWORK_ERROR, message, url, true);
}

const GITHUB_API_BASE = 'https://api.github.com';

function getGitHubToken(): string | undefined {
  return process.env.GITHUB_TOKEN;
}

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

    const data = (await response.json()) as GitHubRelease & { message?: string; url?: string };

    if (!data) {
      return {
        error: createApiError(ApiErrorType.NULL_RESPONSE, 'Response data is null', url, true),
      };
    }

    if ('message' in data) {
      const message = data.message ?? 'Unknown error';
      if (message === 'Moved Permanently') {
        const redirectUrl = data.url;
        if (redirectUrl) {
          console.log(picocolors.yellow(`[GitHub API] Following redirect to ${redirectUrl}`));
          return await fetchLatestReleaseFromUrl(redirectUrl);
        }
      }

      return {
        error: createApiError(ApiErrorType.UNKNOWN, message, url, false),
      };
    }

    if (!data.assets || !Array.isArray(data.assets) || data.assets.length === 0) {
      return {
        error: createApiError(
          ApiErrorType.EMPTY_RESPONSE,
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
          ApiErrorType.EMPTY_RESPONSE,
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
          ApiErrorType.EMPTY_RESPONSE,
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

import { ApiErrorType } from './types';
import type { ApiError } from './types';

interface ApiErrorMappingOptions {
  notFoundMessage?: string;
  emptyResponseMessage?: string;
  nullResponseMessage?: string;
}

interface StatusLikeError {
  status?: number;
  statusCode?: number;
  message?: string;
}

export function createApiError(
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

  const statusLikeError = error as StatusLikeError;
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

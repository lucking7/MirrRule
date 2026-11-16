/**
 * Classify download failures. Only a network error or an HTTP 5xx means the upstream is
 * temporarily unavailable; a 4xx (for example a removed or renamed file) or invalid content is a
 * real defect that should fail the run.
 */
export function isUnavailableStatus(status: number): boolean {
  return status >= 500;
}

/** `$$fetch` throws ResponseError with `statusCode` for HTTP errors; anything else is a network error. */
export function isUnavailableFailure(error: unknown): boolean {
  const status = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
  return typeof status === 'number' ? isUnavailableStatus(status) : true;
}

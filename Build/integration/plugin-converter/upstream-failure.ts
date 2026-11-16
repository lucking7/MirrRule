/**
 * Classify download failures. A network error, an HTTP 5xx, or a refusal that depends on the
 * client rather than the file (401/403 from anti-bot protection, 408, 429) means the upstream is
 * unavailable to this run. Other 4xx statuses such as 404 or 410 (a removed or renamed file) and
 * invalid content are real defects that should fail the run.
 */
const CLIENT_REFUSAL_STATUSES = new Set([401, 403, 408, 429]);

export function isUnavailableStatus(status: number): boolean {
  return status >= 500 || CLIENT_REFUSAL_STATUSES.has(status);
}

/** `$$fetch` throws ResponseError with `statusCode` for HTTP errors; anything else is a network error. */
export function isUnavailableFailure(error: unknown): boolean {
  const status = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
  return typeof status === 'number' ? isUnavailableStatus(status) : true;
}

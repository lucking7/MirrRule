const SENSITIVE_QUERY_KEY = /token|key|secret|signature|credential|password|auth/i;

/** Remove credentials and redact sensitive query values before exposing a URL. */
export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
    }
    if (url.username || url.password) {
      url.username = '';
      url.password = '';
    }
    return url.toString();
  } catch {
    return value;
  }
}

const DEFAULT_TEXT_ENCODING = 'utf-8';

function stringifyHeaderValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(String).join(', ');
  }
  return undefined;
}

export function getHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;

  const maybeHeaders = headers as { get?: unknown };
  if (typeof maybeHeaders.get === 'function') {
    const value = maybeHeaders.get.call(headers, name);
    return stringifyHeaderValue(value);
  }

  const record = headers as Record<string, unknown>;
  const lowerName = name.toLowerCase();
  return stringifyHeaderValue(record[lowerName])
    ?? stringifyHeaderValue(record[name])
    ?? stringifyHeaderValue(record[name.toUpperCase()]);
}

function normalizeEncoding(label: string | undefined): string {
  if (!label) return DEFAULT_TEXT_ENCODING;

  try {
    return new TextDecoder(label).encoding;
  } catch {
    return DEFAULT_TEXT_ENCODING;
  }
}

export function getTextEncodingFromHeaders(headers: unknown): string {
  const contentType = getHeader(headers, 'content-type');
  const charset = contentType?.match(/(?:^|;)\s*charset\s*=\s*(?:"([^"]+)"|([^\s;]+))/i);

  return normalizeEncoding(charset?.[1]?.trim() ?? charset?.[2]?.trim());
}

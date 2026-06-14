import { ResponseError } from './fetch-retry';
import type { UndiciResponseData } from './fetch-retry';
import type { Response as UndiciWebResponse } from 'undici';
import { getHeader } from './charset';

const HTML_TAG_PATTERN = /^<(?:!doctype|html|head|body|meta|link|script|style|div|button|label|form)[\s/>]/i;
const HTML_MARKERS = [
  '</html>',
  '</body>',
  'bootstrap.min.css',
  'btn-porkbun',
] as const;

export function isLikelyHtmlRuleText(headers: unknown, lines: readonly string[]): boolean {
  const contentType = getHeader(headers, 'content-type');
  if (contentType && /(?:^|;)\s*text\/html\b/i.test(contentType)) {
    return true;
  }

  return lines.slice(0, 40).some(line => {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();
    return HTML_TAG_PATTERN.test(trimmed) || HTML_MARKERS.some(marker => lower.includes(marker));
  });
}

export function assertRuleTextResponse(
  response: UndiciResponseData | UndiciWebResponse,
  url: string,
  lines: readonly string[]
): void {
  if (isLikelyHtmlRuleText(response.headers, lines)) {
    throw new ResponseError(response, url, 'html response while fetching rule text');
  }
}

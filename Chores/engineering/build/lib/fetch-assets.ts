import { $$fetch, defaultRequestInit } from './fetch-retry.js';
import picocolors from 'picocolors';

/**
 * 从 URL 获取资源内容，支持备用 URL
 */
export async function fetchAssets(
  url: string,
  fallbackUrls: string[] | null = null,
  processLine = false,
  allowEmpty = false
): Promise<string[]> {
  const tryFetch = async (targetUrl: string): Promise<string[]> => {
    try {
      console.log(picocolors.gray(`[fetch] ${targetUrl}`));
      const response = await $$fetch(targetUrl, defaultRequestInit);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const text = await response.text();
      let lines = text.split('\n');

      if (processLine) {
        lines = lines
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#') && !line.startsWith('!'));
      }

      if (!allowEmpty && lines.length === 0) {
        throw new Error('Empty response');
      }

      return lines;
    } catch (error) {
      console.error(picocolors.red(`[fetch failed] ${targetUrl}`), error);
      throw error;
    }
  };

  // 尝试主 URL
  try {
    return await tryFetch(url);
  } catch (error) {
    // 如果主 URL 失败，尝试备用 URL
    if (fallbackUrls && fallbackUrls.length > 0) {
      for (const fallbackUrl of fallbackUrls) {
        try {
          return await tryFetch(fallbackUrl);
        } catch {
          // 继续尝试下一个
        }
      }
    }

    throw new Error(`Failed to fetch from ${url} and all fallback URLs`);
  }
}

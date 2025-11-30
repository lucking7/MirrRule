import process from 'node:process';

/**
 * 判断指定 URL 是否需要通过代理访问
 * 当前仅针对 kelee.one 域做兼容处理，后续可按需扩展
 */
export function shouldUseProxy(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'kelee.one' || hostname.endsWith('.kelee.one');
  } catch {
    return false;
  }
}

const DEFAULT_PROXY_BASE = 'https://proxy-one.cc.sbs?url=';

/**
 * 若匹配需要代理的域名，则返回带代理前缀的 URL
 */
export function applyProxyIfNeeded(url: string): string {
  if (!shouldUseProxy(url)) {
    return url;
  }

  const proxyBase = process.env.PROXY_BASE || DEFAULT_PROXY_BASE;
  return proxyBase + url;
}

/**
 * 返回按优先级排列的 URL 备选列表，优先使用代理，其次直连
 */
export function buildProxyUrlCandidates(url: string): string[] {
  const proxied = applyProxyIfNeeded(url);

  if (proxied === url) {
    return [url];
  }

  return [proxied, url];
}
